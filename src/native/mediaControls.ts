import {
  getMediaControlsModule,
  type MediaCommandEvent,
} from '../../modules/media-controls';

export type { MediaCommandEvent };

/** Transport-state mirror pushed to the Android media notification. */
export type MediaPlaybackMirrorState = 'playing' | 'paused' | 'loading' | 'stopped';

/**
 * Everything the notification/lock screen renders for the current track.
 * All fields are optional-null: artwork/title may be genuinely absent
 * (local files without cover art) and the native side must cope.
 */
export interface MediaNowPlaying {
  readonly state: MediaPlaybackMirrorState;
  readonly positionMs: number;
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly artworkUri: string | null;
  /** Total duration in ms; 0 when unknown. */
  readonly durationMs: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/**
 * Typed native boundary for Aero's Android media notification /
 * lock-screen controls.
 *
 * This is the ONLY file in src/ allowed to touch the MediaControls
 * native module. It is a pure mirror/command pipe: `push` forwards the
 * latest PlayerController snapshot rendering, `subscribeCommands` /
 * `subscribeAudioNoisy` deliver external transport events. Every call
 * degrades to a no-op when the native module is absent (Expo Go / iOS):
 * playback is unaffected, only the notification surface is missing.
 */
export interface MediaControlsBoundary {
  /** Whether the native module is present in this runtime. */
  isAvailable(): boolean;
  /** Forwards one snapshot mirror (fire-and-forget, ordered). */
  push(nowPlaying: MediaNowPlaying): void;
  /** Subscribes to external transport commands; returns unsubscribe. */
  subscribeCommands(listener: (event: MediaCommandEvent) => void): () => void;
  /** Subscribes to audio-output removal (unplug / BT drop); returns unsubscribe. */
  subscribeAudioNoisy(listener: () => void): () => void;
}

class MediaControls implements MediaControlsBoundary {
  isAvailable(): boolean {
    return getMediaControlsModule() !== null;
  }

  push(nowPlaying: MediaNowPlaying): void {
    const module = getMediaControlsModule();
    if (!module) return;
    try {
      module.update(nowPlaying.state, JSON.stringify(nowPlaying));
    } catch (error) {
      // A notification failure must never surface into the playback path.
      console.warn('[MEDIA_CONTROLS] could not push playback mirror.', error);
    }
  }

  subscribeCommands(listener: (event: MediaCommandEvent) => void): () => void {
    const module = getMediaControlsModule();
    if (!module) return () => {};
    const subscription = module.addListener('onCommand', listener);
    return () => subscription.remove();
  }

  subscribeAudioNoisy(listener: () => void): () => void {
    const module = getMediaControlsModule();
    if (!module) return () => {};
    const subscription = module.addListener('onAudioBecomingNoisy', listener);
    return () => subscription.remove();
  }
}

/** Singleton boundary instance used by the media-controls bridge. */
export const mediaControls: MediaControlsBoundary = new MediaControls();
