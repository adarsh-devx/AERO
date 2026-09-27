import { requireNativeModule } from 'expo-modules-core';

/**
 * Raw entry shape exposed by the native AudioEffects module.
 *
 * Both functions take the expo-audio `AudioPlayer` object itself: natively
 * it is a `SharedRef<ExoPlayer>`, so expo-modules-core resolves it to the
 * live ExoPlayer instance and verifies the ref type. The value is opaque
 * here — nothing on the JS side ever reads or constructs it.
 */
export interface AudioEffectsNativeModule {
  /**
   * Attaches/updates the loudness effect at a normalization gain in
   * millibels (-1500..+300). The native side clamps the same bounds, so no
   * caller can turn this into a fixed or oversized boost.
   */
  attachLoudness(player: object, gainMB: number): void;
  /** Releases the effect for this player (no effect → no-op). */
  detachLoudness(player: object): void;
}

let cachedModule: AudioEffectsNativeModule | null | undefined;

/**
 * Lazily resolves the native module. Returns null when it is not linked
 * (e.g. running in Expo Go or a non-Android platform) so callers can
 * degrade to plain 1.0-loudness playback instead of crashing — the same
 * contract as getMediaControlsModule().
 */
export function getAudioEffectsModule(): AudioEffectsNativeModule | null {
  if (cachedModule === undefined) {
    try {
      cachedModule = requireNativeModule<AudioEffectsNativeModule>('AudioEffects');
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}
