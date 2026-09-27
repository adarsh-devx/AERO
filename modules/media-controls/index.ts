import { requireNativeModule } from 'expo-modules-core';

/**
 * Transport/media command forwarded from the Android notification,
 * lock screen, Bluetooth headset or any other media-button surface.
 * `positionMs` is only present for `seekTo`.
 */
export interface MediaCommandEvent {
  command:
    | 'play'
    | 'pause'
    | 'toggle'
    | 'next'
    | 'previous'
    | 'seekTo'
    | 'seekForward'
    | 'seekBackward'
    | 'stop';
  positionMs?: number;
}

/**
 * Raw entry shape exposed by the native MediaControls module.
 *
 * `update` is a fire-and-forget state mirror: `state` is a separate
 * argument (the module needs it to decide how to start the service)
 * and everything else rides in one JSON payload so each snapshot
 * change is a single ordered intent.
 */
export interface MediaControlsNativeModule {
  update(state: string, payloadJson: string): void;
  addListener(
    event: 'onCommand',
    listener: (event: MediaCommandEvent) => void,
  ): { remove(): void };
  addListener(
    event: 'onAudioBecomingNoisy',
    listener: () => void,
  ): { remove(): void };
}

let cachedModule: MediaControlsNativeModule | null | undefined;

/**
 * Lazily resolves the native module. Returns null when it is not linked
 * (e.g. running in Expo Go) so callers can degrade explicitly instead of
 * crashing — the same contract as getFileDownloadsModule().
 */
export function getMediaControlsModule(): MediaControlsNativeModule | null {
  if (cachedModule === undefined) {
    try {
      cachedModule = requireNativeModule<MediaControlsNativeModule>('MediaControls');
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}
