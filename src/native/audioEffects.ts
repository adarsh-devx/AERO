import { getAudioEffectsModule } from '../../modules/audio-effects';

/**
 * Typed native boundary for Aero's loudness-normalization layer.
 *
 * This is the ONLY file in src/ allowed to touch the AudioEffects native
 * module. It is a pure attach/detach pipe around the engine's ONE
 * long-lived expo-audio player: `attach` keeps an Android LoudnessEnhancer
 * at THIS track's bounded normalization gain (-1500..+300 mB, applied
 * inside AudioFlinger — never via player volume) on the player's real
 * audio session; `detach` releases it whenever there is nothing to
 * normalize (no loudness metadata, normalization off, explicit teardown).
 *
 * Every call degrades to a no-op when the native module is absent
 * (Expo Go / non-Android): playback is unaffected, only the loudness
 * boost is missing. Failures here must never surface into playback —
 * the native side logs and playback continues at plain 1.0 loudness.
 */
export interface AudioEffectsBoundary {
  /** Whether the native module is present in this runtime. */
  isAvailable(): boolean;
  /**
   * Starts (idempotently) keeping the loudness effect on this player at
   * [gainMB] millibels of normalization gain. Re-attaching with a different
   * gain replaces the previous one in place; a non-finite value is ignored
   * (no effect) rather than coerced into a boost.
   */
  attach(player: unknown, gainMB: number): void;
  /** Releases the loudness effect held for this player. */
  detach(player: unknown): void;
}

class AudioEffects implements AudioEffectsBoundary {
  isAvailable(): boolean {
    return getAudioEffectsModule() !== null;
  }

  attach(player: unknown, gainMB: number): void {
    if (player === null || typeof player !== 'object') return;
    // No finite gain → no effect. Silence about gain must never become a
    // default boost: the caller decides, and "no value" means "no effect".
    if (!Number.isFinite(gainMB)) return;
    const module = getAudioEffectsModule();
    if (!module) return;
    try {
      module.attachLoudness(player, Math.round(gainMB));
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
