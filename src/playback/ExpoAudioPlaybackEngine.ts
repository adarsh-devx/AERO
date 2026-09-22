import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import type { PlaybackEngine, PlaybackState, PlaybackStatus } from './types';
import type { ResolvedStream } from '../providers/stream/types';
import type { Track } from '../core/types/track';
import { getTrackArtworkUri } from '../core/types/track';

// Initialize global audio session for background playback & lock screen controls
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
  private lastStatus: AudioStatus | null = null;
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
    this.currentTrackId = stream.trackId;
    this.lastStatus = null;

    if (track) {
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
    await player.seekTo(validMs / 1000);
    if (this.lastStatus?.playing) {
      player.play();
    }
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
    this.emit('stopped');
  }

  /** Full teardown of the native player (app-level shutdown only). */
  dispose(): void {
    try {
      this.player?.setActiveForLockScreen(false);
    } catch {
      // ignore
    }
    this.player?.remove();
    this.player = null;
    this.currentTrackId = null;
    this.lastStatus = null;
    this.listeners.clear();
  }

  private requirePlayer(): AudioPlayer {
    if (!this.player) {
      const player = createAudioPlayer(null, { updateInterval: 500 });
      player.addListener('playbackStatusUpdate', (status) => {
        this.lastStatus = status;
        this.emit(this.mapStatus(status).status);
      });
      this.player = player;
    }
    return this.player;
  }

  private mapStatus(status: AudioStatus): PlaybackState {
    const base = {
      trackId: this.currentTrackId,
      positionMs: Math.round(status.currentTime * 1000),
      durationMs: status.duration > 0 ? Math.round(status.duration * 1000) : null,
      didJustFinish: status.didJustFinish === true,
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

  private emit(overrideStatus?: PlaybackStatus): void {
    const state = this.snapshot(overrideStatus);
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private snapshot(overrideStatus?: PlaybackStatus): PlaybackState {
    if (overrideStatus) {
      const status = this.lastStatus;
      return {
        status: overrideStatus,
        trackId: this.currentTrackId,
        positionMs: status ? Math.round(status.currentTime * 1000) : null,
        durationMs: status && status.duration > 0 ? Math.round(status.duration * 1000) : null,
        errorMessage: null,
      };
    }
    if (!this.lastStatus) {
      return {
        status: 'idle',
        trackId: this.currentTrackId,
        positionMs: null,
        durationMs: null,
        errorMessage: null,
      };
    }
    return this.mapStatus(this.lastStatus);
  }
}

/** Application-wide playback engine instance (single player lifecycle). */
export const playbackEngine = new ExpoAudioPlaybackEngine();
