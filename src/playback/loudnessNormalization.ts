/**
 * Meld-style loudness normalization — the ONE place a normalization gain is
 * derived from real track loudness metadata.
 *
 * Pure and deterministic: no network, no player, no settings, no side
 * effects. It never invents a value — a missing or unusable loudness
 * answers `null`, which every caller must treat as "apply NO normalization
 * effect for this track".
 *
 * Source convention (verified against real InnerTube `youtubei/v1/player`
 * responses): `Track.loudnessDb` is YouTube's
 * `playerConfig.audioConfig.loudnessDb`, i.e. the track's loudness
 * DEVIATION from YouTube's -14 LUFS loudness target
 * (`loudnessDb = perceptualLoudnessDb + 14`):
 *
 *   - POSITIVE value → the track is LOUDER than target → needs attenuation
 *   - NEGATIVE value → the track is quieter than target → may receive
 *                      (bounded) make-up gain
 *   - 0              → already at target → exactly 0 mB
 *
 * Local files carry no such metadata, so they never normalize.
 *
 * Gain: `round(-loudnessDb * 100)` millibels, clamped to Meld's bounds —
 * at most +3 dB of boost, at most -15 dB of attenuation. The player's own
 * volume (the 0..1 mixer level) is a SEPARATE control and is never read or
 * written here.
 */

/** Minimum normalization gain: -3 dB (-300 mB) to preserve clarity, fullness, and dynamic punch. */
export const MIN_GAIN_MB = -300;

/**
 * Maximum normalization gain: +3 dB (the most boost allowed). Deliberately
 * small: a fixed, always-on boost is exactly what normalization must NOT be.
 */
export const MAX_GAIN_MB = 300;

/**
 * Normalization gain in millibels for one track's real loudness, or `null`
 * when no usable loudness exists (undefined, null, non-number, NaN,
 * ±Infinity) — "no loudness → no effect", never a fallback gain.
 *
 * Behaviours:
 *   - quiet track (e.g. -4.26 dB deviation) → +426 mB, capped at +300 mB
 *   - loud track (e.g. +9.49 dB deviation)  → -949 mB of attenuation
 *   - very loud track                       → floored at -1500 mB (-15 dB)
 *   - neutral (0)                           → exactly 0 mB
 *   - missing / invalid                     → null (effect must not attach)
 */
export function computeNormalizationGainMB(
  loudnessDb: number | null | undefined,
): number | null {
  if (typeof loudnessDb !== 'number' || !Number.isFinite(loudnessDb)) return null;
  const gain = Math.round(-loudnessDb * 100);
  const clamped = Math.min(MAX_GAIN_MB, Math.max(MIN_GAIN_MB, gain));
  // Round first, clamp second; then normalize -0 → 0 so an exactly neutral
  // track reads as plain 0 mB rather than "-0 mB".
  return clamped === 0 ? 0 : clamped;
}
