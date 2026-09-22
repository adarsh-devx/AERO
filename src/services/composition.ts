import { DeviceMusicProvider } from '../providers/music/local/LocalMusicProvider';
import { YouTubeMusicProvider } from '../providers/music/online/YouTubeMusicProvider';
import { LocalFileStreamProvider } from '../providers/stream/local/LocalStreamProvider';
import { YouTubeStreamProvider } from '../providers/stream/online/YouTubeStreamProvider';
import { CompositeStreamResolver } from '../providers/stream/CompositeStreamResolver';
import { playbackEngine } from '../playback/ExpoAudioPlaybackEngine';
import { PlayerController } from '../playback/PlayerController';
import { preloader } from '../playback/preload';
import { nativeKeyValueStore } from '../core/storage/nativeKeyValueStore';
import { PlaybackHistory } from '../features/history/PlaybackHistory';
import { LikedSongs } from '../features/liked/LikedSongs';
import { Playlists } from '../features/playlists/Playlists';
import { SearchHistory } from '../features/search/SearchHistory';
import { Downloads } from '../features/downloads/Downloads';
import { MusicService } from './MusicService';

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
export const streamResolver = new CompositeStreamResolver([
  new LocalFileStreamProvider(),
  new YouTubeStreamProvider(),
]);

export const musicService = new MusicService({
  musicProviders: [
    new DeviceMusicProvider(),
    new YouTubeMusicProvider(process.env.EXPO_PUBLIC_YOUTUBE_API_KEY),
  ],
  streamResolver,
  playbackEngine,
});

/**
 * Persistent playback history (newest first). One app-level instance,
 * written only by the player controller once playback has actually
 * started. Survives restarts via the KeyValueStore.
 */
export const playbackHistory = new PlaybackHistory(nativeKeyValueStore);

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
export const searchHistory = new SearchHistory(nativeKeyValueStore);

/**
 * Persistent downloads & offline storage.
 * Survives restarts via the KeyValueStore.
 */
export const downloads = new Downloads(nativeKeyValueStore);

/** Single application-level player controller (one engine subscription). */
export const playerController = new PlayerController({
  orchestrator: musicService,
  engine: playbackEngine,
  onTrackStarted: (track) => playbackHistory.record(track),
  prefetch: {
    schedule: (track) => preloader.schedule(track),
    adopt: (trackId) => preloader.adopt(trackId),
  },
});


