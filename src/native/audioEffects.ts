import { getAudioEffectsModule } from '../../modules/audio-effects';

/**
 * Typed native boundary for Aero's maximum-loudness layer.
 *
 * This is the ONLY file in src/ allowed to touch the AudioEffects native
 * module. It is a pure attach/detach pipe around the engine's ONE
 * long-lived expo-audio player: `attach` keeps a bounded Android
 * LoudnessEnhancer (+600 mB, applied inside AudioFlinger — never via
 * player volume) on the player's real audio session for as long as the
 * player lives; `detach` releases it during explicit teardown.
 *
 * Every call degrades to a no-op when the native module is absent
 * (Expo Go / non-Android): playback is unaffected, only the loudness
 * boost is missing. Failures here must never surface into playback —
 * the native side logs and playback continues at plain 1.0 loudness.
 */
export interface AudioEffectsBoundary {
  /** Whether the native module is present in this runtime. */
  isAvailable(): boolean;
  /** Starts (idempotently) keeping the loudness effect on this player. */
  attach(player: unknown): void;
  /** Releases the loudness effect held for this player. */
  detach(player: unknown): void;
}

class AudioEffects implements AudioEffectsBoundary {
  isAvailable(): boolean {
    return getAudioEffectsModule() !== null;
  }

  attach(player: unknown): void {
    if (player === null || typeof player !== 'object') return;
    const module = getAudioEffectsModule();
    if (!module) return;
    try {
      module.attachLoudness(player);
    } catch (error) {
      // A loudness failure must never surface into the playback path.
      console.warn('[AUDIO_LOUDNESS] could not attach loudness effect.', error);
    }
  }

  detach(player: unknown): void {
    if (player === null || typeof player !== 'object') return;
    const module = getAudioEffectsModule();
    if (!module) return;
    try {
      module.detachLoudness(player);
    } catch (error) {
      console.warn('[AUDIO_LOUDNESS] could not detach loudness effect.', error);
    }
  }
}

/** Singleton boundary instance used by the playback engine. */
export const audioEffects: AudioEffectsBoundary = new AudioEffects();
