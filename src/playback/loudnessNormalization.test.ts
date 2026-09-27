/**
 * Focused assertions for the pure loudness→gain calculation.
 * No test framework is added: node's built-in `node:test` + `node:assert`,
 * runnable with
 * `node --test src/playback/loudnessNormalization.test.ts`.
 *
 * `loudnessDb` is YouTube's deviation from its -14 LUFS target:
 * positive = louder than target (needs attenuation), negative = quieter
 * (may receive bounded make-up gain).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeNormalizationGainMB, MIN_GAIN_MB, MAX_GAIN_MB } from './loudnessNormalization.ts';

test('missing loudness → null (no normalization effect)', () => {
  assert.equal(computeNormalizationGainMB(undefined), null);
  assert.equal(computeNormalizationGainMB(null), null);
});

test('invalid / non-finite loudness → null (never a fabricated gain)', () => {
  assert.equal(computeNormalizationGainMB(Number.NaN), null);
  assert.equal(computeNormalizationGainMB(Number.POSITIVE_INFINITY), null);
  assert.equal(computeNormalizationGainMB(Number.NEGATIVE_INFINITY), null);
});

test('zero / neutral loudness → exactly 0 mB (never -0)', () => {
  const gain = computeNormalizationGainMB(0);
  assert.equal(gain, 0);
  assert.ok(Object.is(gain, 0), 'neutral gain must be +0, not -0');
});

test('quiet track → positive make-up gain, still inside the cap', () => {
  // 1 dB below target → +100 mB of make-up gain (unclamped territory).
  assert.equal(computeNormalizationGainMB(-1), 100);
});

test('loud track → attenuation of the same magnitude', () => {
  // +9.49 dB above target → -949 mB.
  assert.equal(computeNormalizationGainMB(9.49), -949);
});

test('gain above +3 dB is capped at MAX_GAIN_MB (+300 mB)', () => {
  // A genuinely quiet track (-4.26 dB below target → +426 mB), a very
  // quiet one (-10 dB → +1000 mB) and an extreme one all clamp to +300.
  assert.equal(computeNormalizationGainMB(-4.2566547), MAX_GAIN_MB);
  assert.equal(computeNormalizationGainMB(-10), MAX_GAIN_MB);
  assert.equal(computeNormalizationGainMB(-50), MAX_GAIN_MB);
  assert.equal(MAX_GAIN_MB, 300);
});

test('gain below -15 dB is floored at MIN_GAIN_MB (-1500 mB)', () => {
  // +20 dB above target would be -2000 mB → clamped to -1500 mB.
  assert.equal(computeNormalizationGainMB(20), MIN_GAIN_MB);
  assert.equal(MIN_GAIN_MB, -1500);
});

test('boundaries are inclusive: ±3 dB deviation lands exactly on the caps', () => {
  assert.equal(computeNormalizationGainMB(-3), MAX_GAIN_MB); // +300 mB
  assert.equal(computeNormalizationGainMB(15), MIN_GAIN_MB); // -1500 mB
});

test('ordinary values pass through unscaled-but-negated', () => {
  assert.equal(computeNormalizationGainMB(1.5), -150);
  assert.equal(computeNormalizationGainMB(-0.5), 50);
});
