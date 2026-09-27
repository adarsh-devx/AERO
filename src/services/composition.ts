import { DeviceMusicProvider } from '../providers/music/local/LocalMusicProvider';
import { YouTubeMusicProvider } from '../providers/music/online/YouTubeMusicProvider';
import { LocalFileStreamProvider } from '../providers/stream/local/LocalStreamProvider';
import { YouTubeStreamProvider } from '../providers/stream/online/YouTubeStreamProvider';
import { CompositeStreamResolver } from '../providers/stream/CompositeStreamResolver';
import { playbackEngine } from '../playback/ExpoAudioPlaybackEngine';
import { PlayerController } from '../playback/PlayerController';
import { preloader } from '../playback/preload';
import { nativeKeyValueStore } from '../core/storage/nativeKeyValueStore';
import { trackOrigin, type Track } from '../core/types/track';
import { PlaybackHistory } from '../features/history/PlaybackHistory';
import { LikedSongs } from '../features/liked/LikedSongs';
import { Playlists } from '../features/playlists/Playlists';
import { SearchHistory } from '../features/search/SearchHistory';
import { SettingsStore } from '../features/settings/SettingsStore';
import {
  ListeningStats,
  startListeningDurationTracking,
} from '../features/statistics/ListeningStats';
import { Downloads } from '../features/downloads/Downloads';
import { SleepTimer } from '../features/player/SleepTimer';
import { fileDownloads } from '../native/fileDownloads';
import { localAudioSource } from '../native/localMedia';
import {
  PlaybackSession,
  startPlaybackSessionPersistence,
} from '../playback/PlaybackSession';
import { startMediaControlsBridge } from '../playback/MediaControlsBridge';
import { LrclibLyricsProvider } from '../providers/lyrics/LrclibLyricsProvider';
import { MusicService } from './MusicService';
import { DownloadService } from './DownloadService';
import { LyricsService } from './LyricsService';
import { RecommendationService } from './RecommendationService';
import { InstagramSongIdentifier } from '../features/share/instagram/InstagramSongIdentifier';

/**
 * Application composition root.
 *
 * This is the ONLY place where concrete providers, the concrete
 * playback engine and the global player controller are instantiated.
 * The UI and features import `musicService` / `playerController` and
 * must stay unaware of which providers are registered or which engine
 * is playing.
 *
 * Named `composition.ts` (not `musicService.ts`) because Windows/NTFS
 * treats that as the same file as MusicService.ts.
 */
/**
 * Persistent downloads & offline storage. Created BEFORE the stream
 * resolver: the resolver's offline seam reads this store to serve
 * completed downloads as local files without ever re-resolving online.
 * Survives restarts via the KeyValueStore.
 */
export const downloads = new Downloads(nativeKeyValueStore);

export const streamResolver = new CompositeStreamResolver(
  [
    new LocalFileStreamProvider(),
    new YouTubeStreamProvider(),
  ],
  {
    // Offline-first seam: a completed download resolves straight to its
    // local file (hydrated + disk-reconciled once), so a downloaded track
    // never re-runs NewPipe and never depends on an expiring URL. The file
    // URI is deliberately not written into the stream URL cache.
    downloadedStream: async (track) => {
      await downloads.hydrate();
      const local = downloads.getLocalFile(track);
      if (!local) return null;
      const entry = downloads.getEntry(track);
      return {
        trackId: track.id,
        uri: local.uri,
        mimeType: local.mimeType,
        metadata: {
          sourceType: 'download',
          mimeType: local.mimeType,
          sizeBytes: entry?.fileSizeBytes,
          sanitizedHost: 'Downloaded Storage',
          deliveryMethod: 'Offline File',
        },
      };
    },
  },
);

/**
 * Single application-level download orchestrator:
 * UI → DownloadService → StreamResolver → file download → Downloads store.
 */
export const downloadService = new DownloadService({
  resolver: streamResolver,
  downloads,
  files: fileDownloads,
});

export const musicService = new MusicService({
  musicProviders: [
    new DeviceMusicProvider(),
    // Keyless: search and suggestions both go through YouTube's InnerTube API.
    new YouTubeMusicProvider(),
  ],
  streamResolver,
  playbackEngine,
});

/**
 * Persistent playback history (newest first). One app-level instance,
 * written only by the player controller once playback has actually
 * started. Survives restarts via the KeyValueStore.
 */
/**
 * Single persisted preferences record (ONE versioned key over the same
 * KeyValueStore). Created BEFORE the history stores — their recording
 * gates read it — and hydrated once here: local, fast, no network, and
 * fully independent of the playback-session restore below (§14).
 */
export const settings = new SettingsStore(nativeKeyValueStore);
void settings.hydrate();

export const playbackHistory = new PlaybackHistory(nativeKeyValueStore, settings);

/**
 * Listening statistics — ONE versioned record (`aero.listening_stats`) over
 * the same KeyValueStore. Hydrated once here, exactly like settings: local,
 * fast, independent of playback-session restore. Fed ONLY by real playback
 * lifecycle events (the canonical onTrackStarted callback below for plays,
 * and measured engine position progress for listening time) — never by
 * selection, prefetch, resolution or downloads.
 */
export const listeningStats = new ListeningStats(nativeKeyValueStore);
void listeningStats.hydrate();

// Wire the prefetch seam once: the preloader resolves through the same
// MusicService/stream resolver the play path uses (no duplicate logic).
preloader.setSeam(musicService);

/**
 * Persistent liked songs (newest-liked first). One app-level instance
 * over the same KeyValueStore as history; survives restarts.
 */
export const likedSongs = new LikedSongs(nativeKeyValueStore);

/**
 * Persistent user playlists (newest-created first). One app-level
 * instance over the same KeyValueStore as history/likes.
 */
export const playlists = new Playlists(nativeKeyValueStore);

/**
 * Persistent search query history (newest-searched first).
 * Survives restarts via the KeyValueStore.
 */
export const searchHistory = new SearchHistory(nativeKeyValueStore, settings);

/**
 * Sleep timer — transient player-level state: ONE in-memory store, no
 * storage key (a countdown must never resurrect after a restart). The
 * late-bound player getter mirrors the autoplay pattern: the controller
 * below is only dereferenced when a timer actually expires. In the other
 * direction, the controller's `completionGate` dep points back at this
 * store so "end of current track" gets the first look at every natural
 * completion — before repeat/queue/autoplay continuation.
 */
export const sleepTimer: SleepTimer = new SleepTimer({
  // Explicit annotation on the left breaks the initializer cycle
  // (sleepTimer → playerController → completionGate → sleepTimer).
  getPlayer: () => playerController,
});

/** Single application-level player controller (one engine subscription). */
export const playerController = new PlayerController({
  orchestrator: musicService,
  engine: playbackEngine,
  completionGate: sleepTimer,
  onTrackStarted: (track) => {
    // ONE canonical playback-start event, two independent stores: recency
    // history and aggregate statistics. No second "track started" source.
    playbackHistory.record(track);
    listeningStats.recordPlay(track);
  },
  prefetch: {
    schedule: (track) => preloader.schedule(track),
    adopt: (trackId) => preloader.adopt(trackId),
  },
  // End-of-queue continuation (autoplay). LATE-BOUND on purpose:
  // recommendationService is constructed below and depends on this
  // controller as its current-track source, so the reference is only
  // evaluated when an ended queue actually asks for a candidate — never
  // during startup, never from the playback thread's module init.
  autoplay: {
    getAutoplayTrack: (
      current: Track,
      excluded: readonly Track[],
    ): Promise<Track | null> => recommendationService.getAutoplayTrack(current, excluded),
    // Automatic Up Next top-up (30–40 diverse tracks): LATE-BOUND exactly
    // like getAutoplayTrack above — called only after a track is already
    // playing, never during startup, and never on the playback critical
    // path. Same service, same cache, no second recommendation engine.
    getRecommendationBatch: (
      current: Track,
      excluded: readonly Track[],
      target: number,
    ): Promise<readonly Track[]> =>
      recommendationService.getRecommendationBatch(current, excluded, target),
  },
});

// Android media notification / lock-screen bridge. Started HERE, right
// after the controller exists, so exactly one bridge mirrors this one
// controller (and only one) for the app's lifetime: snapshot → native
// MediaSession, native transport commands → PlayerController methods.
startMediaControlsBridge(playerController);

// Measured listening-duration accounting for statistics: derives deltas from
// the controller's published snapshots (never the track's duration), credits
// only real 'playing' position progress, and persists via checkpoint edges +
// a bounded coalesced flush — never a write per position tick.
startListeningDurationTracking(playerController, listeningStats);

/**
 * Durable playback session — ONE record over the same KeyValueStore as
 * history/likes/downloads. Not a second queue: the controller stays the
 * only owner of playback state; this only reads/writes its minimal durable
 * snapshot (source order, index, shuffle/repeat, position — never a
 * stream URL).
 *
 * Local-track validation NEVER prompts for permission (check-only) and an
 * unknown result keeps tracks: only a confirmed MediaStore miss drops one.
 */
export const playbackSession = new PlaybackSession({
  store: nativeKeyValueStore,
  dropMissingLocalTracks: async (tracks) => {
    if (!tracks.some((track) => trackOrigin(track) === 'local')) return tracks;
    try {
      if (!(await localAudioSource.hasAudioPermission())) return tracks;
      const entries = await localAudioSource.getAudioEntries();
      const ids = new Set(entries.map((entry) => String(entry.trackId)));
      return tracks.filter(
        (track) => trackOrigin(track) !== 'local' || ids.has(String(track.id)),
      );
    } catch (error) {
      console.warn('[PLAYBACK_SESSION] local existence unknown; keeping tracks.', error);
      return tracks;
    }
  },
});

// Persist meaningful session changes with BOUNDED frequency (structural
// edges, pause/play edges, deliberate paused seeks, 15s progress writes).
startPlaybackSessionPersistence(playerController, playbackSession);

// Startup restore: hydrate (local, non-blocking) → rebuild the controller
// as an honest PAUSED session. No stream is resolved, no NewPipe runs, no
// history is written, nothing warms — audio starts only when the user
// presses Play, which re-resolves normally and applies the saved position.
void playbackSession.hydrate().then((state) => {
  if (state === null) return;
  playerController.restoreSession(state);
});

/**
 * Lyrics lookup (Now Playing → LyricsService → LyricsProvider). Fully
 * independent of playback: metadata-only requests, own in-memory cache,
 * keyless LRCLIB backend — nothing here can affect stream resolution or
 * the queue.
 */
export const lyricsService = new LyricsService({
  provider: new LrclibLyricsProvider(),
});

/**
 * Local personalized Home feed. Consumes ONLY the existing stores
 * (history, likes, search history) as signals and the existing
 * MusicService.search for candidates — no InnerTube calls, no stream
 * resolution, no new state system. Home renders its published sections
 * and never ranks anything itself.
 */
export const recommendationService = new RecommendationService({
  search: (query) => musicService.search(query),
  history: playbackHistory,
  likedSongs: likedSongs,
  searchHistory: searchHistory,
  player: playerController,
  settings,
});

/**
 * Instagram Reel → song identification (shared/deep links). Consumes ONLY
 * the existing MusicService.search for candidate matching: one bounded
 * public-page metadata read lives inside the identifier, and identification
 * ends at Track selection — playback, history and search history are
 * untouched here (the shared-link handler decides what plays).
 */
export const instagramSongIdentifier = new InstagramSongIdentifier({
  search: (query) => musicService.search(query),
});


