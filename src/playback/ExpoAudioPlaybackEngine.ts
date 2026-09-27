import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { Platform } from 'react-native';
import type { PlaybackEngine, PlaybackState, PlaybackStatus } from './types';
import type { ResolvedStream, StreamMetadata } from '../providers/stream/types';
import type { Track } from '../core/types/track';
import { getTrackArtworkUri } from '../core/types/track';
import { audioEffects } from '../native/audioEffects';
import { computeNormalizationGainMB } from './loudnessNormalization';

// Initialize the global audio session: background playback + how
// interruptions (calls, other apps) are handled. On Android this is only
// the audio half — the media NOTIFICATION / lock-screen surface is owned
// by MediaControlsBridge → MediaPlaybackService, because expo-audio's own
// lock-screen integration cannot expose next/previous transport buttons
// (its session explicitly removes track-navigation commands), and Aero's
// queue lives in PlayerController, not in Kotlin.
setAudioModeAsync({
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
}).catch((err) => {
  console.warn('[AUDIO_MODE] Failed to configure audio mode for background playback', err);
});

/**
 * PlaybackEngine implementation backed by expo-audio (ExoPlayer on
 * Android). The rest of the application depends only on the
 * PlaybackEngine boundary — no expo-audio/ExoPlayer types may leak
 * beyond this file.
 *
 * Lifecycle: exactly ONE AudioPlayer instance is created lazily and
 * reused across loads (player.replace()), so repeated play actions
 * never spawn unmanaged player instances. Remove/release happens in
 * dispose() for explicit teardown.
 */
export class ExpoAudioPlaybackEngine implements PlaybackEngine {
  private player: AudioPlayer | null = null;
  private currentTrackId: string | null = null;
  /**
   * Monotonic generation for seek requests. Every seek() call bumps it and
   * carries its own generation through the await: a seek resolved after a
   * NEWER one was issued is stale, and must not resurrect the OLD position
   * via its post-seek play() (see seek() — the await returns to a request
   * that has already been superseded).
   */
  private seekGeneration = 0;
  /** Metadata for the exact stream most recently accepted by AudioPlayer. */
  private activeStream: StreamMetadata | null = null;
  private lastStatus: AudioStatus | null = null;
  /**
   * The audible volume this engine is applying (0–1): ExoPlayer's
   * mixer-level volume, i.e. REAL playback gain — not React state and not
   * the device stream volume. 1.0 = full scale; this engine never writes a
   * value above it (the volume path has no boost/EQ/limiter — maximum
   * loudness comes from a separate, per-track native LoudnessEnhancer
   * layer driven by REAL track loudness metadata (applyNormalization),
   * never from a volume above 1.0). Kept as
   * engine-local state so it survives track changes, pause/resume,
   * background and lock-screen operation without touching position, queue
   * or metadata, and re-asserted on creation and after every load.
   */
  private volume = 1;
  /**
   * Whether loudness normalization may attach its effect at all — the
   * Audio Normalization setting (ON by default). It gates ONLY the effect:
   * it never reads or writes player volume.
   */
  private normalizationEnabled = true;
  /**
   * REAL loudness of the track currently loaded, exactly as the source
   * supplied it (null = none known / not loaded). Never invented here:
   * it is only ever assigned from `track.loudnessDb`.
   */
  private currentLoudnessDb: number | null = null;
  private readonly listeners = new Set<(state: PlaybackState) => void>();

  onStateChange(listener: (state: PlaybackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async load(stream: ResolvedStream, track?: Track): Promise<void> {
    const player = this.requirePlayer();
    player.replace({
      uri: stream.uri,
      // Remote sources may require replaying the headers that resolved them.
      ...(stream.headers ? { headers: { ...stream.headers } } : {}),
    });
    // Belt-and-braces for volume: mixer-level, but re-asserted so no
    // load can ever start audio at a level other than the user's chosen one.
    this.applyVolume(player);
    // Loudness normalization for THIS track: attached only when the setting
    // is on and this track carries REAL loudness; otherwise the effect is
    // released, so the previous track's gain can never leak into this one.
    this.currentLoudnessDb =
      typeof track?.loudnessDb === 'number' && Number.isFinite(track.loudnessDb)
        ? track.loudnessDb
        : null;
    this.applyNormalization(player);
    this.currentTrackId = stream.trackId;
    this.activeStream = stream.metadata ?? null;
    this.lastStatus = null;

    if (track && Platform.OS !== 'android') {
      // Non-Android platforms keep the existing expo-audio lock-screen
      // integration unchanged. On Android this call is deliberately NOT
      // made: it would start expo-audio's own foreground service and
      // notification (which has no next/previous actions and cannot be
      // extended from JS), colliding with Aero's media notification. The
      // Android media surface is driven from MediaControlsBridge instead.
      const artwork = getTrackArtworkUri(track);
      try {
        player.setActiveForLockScreen(
          true,
          {
            title: track.title,
            artist: track.artist,
            albumTitle: track.album || 'Aero Music',
            artworkUrl: artwork,
          },
          {
            showSeekBackward: true,
            showSeekForward: true,
          },
        );
      } catch (err) {
        console.warn('[LOCK_SCREEN] could not set active for lockscreen', err);
      }
    }

    this.emit('loading');
  }

  async play(): Promise<void> {
    this.requirePlayer().play();
  }

  /**
   * Pre-create the single native player.
   *
   * requirePlayer() is otherwise reached lazily from inside the first
   * load(), i.e. on the first tap's critical path, and it constructs the
   * native ExoPlayer instance (plus renderer/audio-track setup). Warming it
   * moves that allocation off that path.
   *
   * Idempotent and inert: it returns the existing instance when the player
   * already exists (so the "exactly one AudioPlayer" invariant is unchanged),
   * loads no media, starts no playback and changes no audio-mode setting.
   */
  warmUp(): void {
    this.requirePlayer();
  }

  async pause(): Promise<void> {
    this.requirePlayer().pause();
  }

  async seek(positionMs: number): Promise<void> {
    const validMs = Math.max(0, Number.isFinite(positionMs) ? positionMs : 0);
    const player = this.requirePlayer();
    const generation = ++this.seekGeneration;
    await player.seekTo(validMs / 1000);
    // Latest-seek-wins: if a newer seek started while this one was in
    // flight, this request is stale — it must not resurrect its own
    // (older) position via the post-seek play() below.
    if (generation !== this.seekGeneration) return;
    if (this.lastStatus?.playing) {
      player.play();
    }
  }

  /**
   * REAL player volume — writes the native mixer level so audible playback
   * changes immediately. NaN/∞ are ignored (no state change); finite values
   * are clamped to 0–1, matching the native side's own coercion. A no-op for
   * an unchanged value, so drag events at 1% granularity never flood the
   * bridge. The value is stored first, so a setVolume() that arrives before
   * the lazy player exists is applied at creation instead of being lost.
   */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const clamped = Math.min(1, Math.max(0, volume));
    if (clamped === this.volume) return;
    this.volume = clamped;
    if (this.player) this.applyVolume(this.player);
    // Subscribers (controller snapshot, the Now Playing slider) observe
    // the ACTUAL value on this call.
    this.emitState(this.snapshot());
  }

  /** Pushes the stored volume into the native player (one idempotent write). */
  private applyVolume(player: AudioPlayer): void {
    try {
      player.volume = this.volume;
    } catch (err) {
      console.warn('[AUDIO_VOLUME] could not apply player volume', err);
    }
  }

  /**
   * Meld-style normalization for the CURRENT track, applied on every load
   * and on every settings change:
   *
   *   - setting OFF → no effect (release whatever is attached);
   *   - no REAL loudness for this track → no effect (release it), so a
   *     track with a gain (A) followed by a track without (B) leaves B
   *     playing clean — A's gain never survives the transition;
   *   - both present → attach with THIS track's bounded gain
   *     (-1500..+300 mB), replacing any previous gain in place.
   *
   * Player volume is untouched: user volume (0..1) × sleep fade × focus
   * duck stay the only volume factors, and the effect is a separate
   * AudioFlinger insert on the player's own audio session.
   */
  private applyNormalization(player: AudioPlayer): void {
    const gainMB = this.normalizationEnabled
      ? computeNormalizationGainMB(this.currentLoudnessDb)
      : null;
    if (gainMB === null) {
      // No usable normalization for this track: release, never carry over.
      audioEffects.detach(player);
      return;
    }
    audioEffects.attach(player, gainMB);
  }

  /**
   * Master switch for loudness normalization (the Audio Normalization
   * setting). Off → the effect is released immediately and no future load
   * attaches one; on → the CURRENT track's normalization is re-applied at
   * once (or stays absent when that track has no loudness). Never touches
   * player volume, position, queue or the loaded media.
   */
  setNormalizationEnabled(enabled: boolean): void {
    const next = enabled === true;
    if (next === this.normalizationEnabled) return;
    this.normalizationEnabled = next;
    if (this.player) this.applyNormalization(this.player);
  }

  /**
   * expo-audio has no hard "stop"; stopping means pausing and seeking
   * to the start. The player instance stays alive for the next load.
   */
  async stop(): Promise<void> {
    const player = this.requirePlayer();
    player.pause();
    await player.seekTo(0);
    try {
      player.setActiveForLockScreen(false);
    } catch {
      // ignore
    }
    this.activeStream = null;
    this.emit('stopped');
  }

  /** Full teardown of the native player (app-level shutdown only). */
  dispose(): void {
    try {
      this.player?.setActiveForLockScreen(false);
    } catch {
      // ignore
    }
    if (this.player) {
      // Release the loudness effect BEFORE the player dies so no enabled
      // AudioFlinger effect outlives its audio session.
      audioEffects.detach(this.player);
    }
    this.player?.remove();
    this.player = null;
    this.currentTrackId = null;
    this.activeStream = null;
    this.lastStatus = null;
    this.listeners.clear();
  }

  private requirePlayer(): AudioPlayer {
    if (!this.player) {
      const player = createAudioPlayer(null, { updateInterval: 500 });
      // NOTE: no effect is attached here. Loudness normalization is
      // per-track (applyNormalization, on every load), so a freshly created
      // player starts with NO effect rather than a fixed boost.
      // A volume chosen before the player existed applies here; at creation this
      // matches the native default (1.0), making the invariant explicit.
      this.applyVolume(player);
      player.addListener('playbackStatusUpdate', (status) => {
        this.lastStatus = status;
        // Emit the FULL mapped state: routing this through
        // emit(override)/snapshot(override) would rebuild it WITHOUT the
        // didJustFinish flag, and the controller could never observe a
        // natural completion (auto-next/autoplay would silently never run).
        this.emitState(this.mapStatus(status));
      });
      this.player = player;
    }
    return this.player;
  }

  private mapStatus(status: AudioStatus): PlaybackState {
    const base = {
      engineTrackId: this.currentTrackId,
      positionMs: Math.round(status.currentTime * 1000),
      durationMs: status.duration > 0 ? Math.round(status.duration * 1000) : null,
      didJustFinish: status.didJustFinish === true,
      activeStream: this.activeStream,
      volume: this.volume,
    };

    if (status.error) {
      return { ...base, status: 'error', errorMessage: status.error };
    }
    if (status.didJustFinish) {
      return { ...base, status: 'stopped', errorMessage: null };
    }
    if (status.playing) {
      return { ...base, status: 'playing', errorMessage: null };
    }
    if (status.isBuffering || status.timeControlStatus === 'waiting') {
      return { ...base, status: 'loading', errorMessage: null };
    }
    if (status.isLoaded) {
      return { ...base, status: 'paused', errorMessage: null };
    }
    return { ...base, status: 'idle', errorMessage: null };
  }

  /** Programmatic emissions (load/stop): derived, never a natural finish. */
  private emit(overrideStatus?: PlaybackStatus): void {
    this.emitState(this.snapshot(overrideStatus));
  }

  /** Emits one fully-built state to every subscriber. */
  private emitState(state: PlaybackState): void {
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private snapshot(overrideStatus?: PlaybackStatus): PlaybackState {
    if (overrideStatus) {
      const status = this.lastStatus;
      return {
        status: overrideStatus,
        engineTrackId: this.currentTrackId,
        positionMs: status ? Math.round(status.currentTime * 1000) : null,
        durationMs: status && status.duration > 0 ? Math.round(status.duration * 1000) : null,
        errorMessage: null,
        // These emissions are programmatic (load/stop), NEVER a natural
        // finish: the fresh status — including the real finish edge —
        // flows through emitState(mapStatus()) from the status listener.
        didJustFinish: false,
        activeStream: this.activeStream,
        volume: this.volume,
      };
    }
    if (!this.lastStatus) {
      return {
        status: 'idle',
        engineTrackId: this.currentTrackId,
        positionMs: null,
        durationMs: null,
        errorMessage: null,
        activeStream: this.activeStream,
        volume: this.volume,
      };
    }
    return this.mapStatus(this.lastStatus);
  }
}

/** Application-wide playback engine instance (single player lifecycle). */
export const playbackEngine = new ExpoAudioPlaybackEngine();
