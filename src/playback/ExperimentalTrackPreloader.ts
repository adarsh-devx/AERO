import type { Track } from '../core/types/track';
import { musicService } from '../services/composition';
import { playbackEngine } from './ExpoAudioPlaybackEngine';
import { warmUpStreamResolution } from '../../modules/stream-resolution';
import { EXPERIMENTAL_COLD_START_WARMUP, EXPERIMENTAL_SEARCH_PREWARM } from '../core/constants/experimental';

/**
 * AERO EXPERIMENT — pre-tap warming for the cold online play path.
 *
 * NOT NØTE parity. NØTE's PreloadManager only ever warms ONE upcoming queue
 * track after a playback event; verified NØTE source performs no work before
 * the first tap. Everything in this module is an Aero-specific experiment.
 *
 * Three separate things are warmed, deliberately kept distinct:
 *
 *  1. playback-engine warm-up — pre-create the single native AudioPlayer so
 *     the first engine.load() does not pay native player construction (that
 *     work used to happen inside the first tap).
 *  2. extractor warm-up — native NewPipe.init + the extractor's service
 *     registry, which today run as the first statements of the first
 *     resolution (also inside the first tap).
 *  3. stream-URL pre-resolution — resolve the first playable online search
 *     result through the EXISTING resolver, so its cache and in-flight
 *     de-duplication are reused. No second cache is created.
 *
 * All three are best effort: none can start playback, mutate the queue or the
 * current track, or navigate, and none can fail a flow that would otherwise
 * work.
 */
let stackWarmed = false;

/**
 * Pay the fixed cold-start costs of the play path once.
 *
 * Idempotent: the first call wins, later calls return immediately. Both
 * targets are themselves safe to reach repeatedly (NewPipe.init is
 * AtomicBoolean-guarded, requirePlayer returns the existing player), so the
 * guard is an optimisation rather than a correctness requirement.
 */
export function warmUpPlaybackStack(): void {
  if (!EXPERIMENTAL_COLD_START_WARMUP) return;
  if (stackWarmed) return;
  stackWarmed = true;

  try {
    playbackEngine.warmUp();
  } catch {
    // Warm-up must never break a flow that would otherwise work.
  }

  void warmStreamOnce();
}

/**
 * Best-effort native extractor warm-up, invoked exactly once.
 *
 * warmUpPlaybackStack() fires this at app load (module-scope, App.tsx) so it
 * races ahead of any prewarm; startPrewarm() then AWAITS it before the first
 * `prefetchStream`, guaranteeing the native NewPipe.init / service-registry
 * work is completed before the first real online resolution begins — i.e. the
 * very chain a prompt tap adopts never pays inline init cost.
 *
 * - Initialized once: `streamWarmPromise` is created on first call and reused.
 * - Concurrency-safe: concurrent callers all await the same promise; native
 *   warmUpAsync itself is AtomicBoolean-guarded, so an extra call is harmless
 *   but we avoid even that by sharing the promise.
 * - Never repeated for every track: the cached promise resolves once.
 * - Non-blocking to the JS thread: it is awaited only inside the fire-and-
 *   forget prewarm flow; App.tsx and render never await it.
 */
let streamWarmPromise: Promise<void> | null = null;
function warmStreamOnce(): Promise<void> {
  if (!streamWarmPromise) {
    streamWarmPromise = warmUpStreamResolution().catch(() => {
      // Warm-up is best-effort and must never block a prewarm path that would
      // otherwise resolve fine on its own.
    });
  }
  return streamWarmPromise;
}

/**
 * Offer a track to the resolver before it is tapped.
 *
 * Concurrency for prewarm targets is managed by the resolver itself
 * (CompositeStreamResolver keeps one in-flight promise per track-identity-key),
 * so the preloader does not serialize pre-warming of *different* tracks here.
 */

export function prewarmTrack(track: Track): void {
  // Flag off => this module is inert.
  if (!EXPERIMENTAL_SEARCH_PREWARM) return;

  // Whatever else happens, the first tap should not pay the fixed costs.
  warmUpPlaybackStack();

  // Phase 1 is online-only: local files need no network resolution and
  // must not be pushed through the remote resolver by this experiment.
  if (track.origin !== 'online') {
    return;
  }

  // Already resolved and unexpired: nothing to do. Same guard the
  // NØTE-parity preloader uses (preload.ts), so a repeated search costs
  // nothing and does not log a phantom "start".
  if (musicService.peekStream(track)) {
    return;
  }

  // Let the resolver be the single source of truth for what is in flight.
  // CompositeStreamResolver.resolve() is one promise per track-identity-key
  // (NØTE-style inflight de-duplication): the SAME key re-offered (e.g. a
  // re-render) joins the existing promise — no second NewPipe chain. A DISTINCT
  // key is allowed to run alongside, which is what lets a tap ADOPT an
  // already-running warm instead of starting a fresh resolve. The previous
  // preloader-local `pendingTrack` deferral parked distinct tracks OUTSIDE
  // this inflight map, so their keys were invisible to the resolver and a tap
  // on them issued a fresh NewPipe resolution; dispatching here fixes that.
  startPrewarm(track);
}

function startPrewarm(track: Track): void {
  // `prefetchStream` is the existing prefetch seam: it calls
  // StreamResolver.resolve(), so it populates the resolver cache and registers
  // in the in-flight map exactly like the play path would — so a tap on this
  // exact track adopts this same promise (NØTE preload.adopt parity).
  //
  // Await the shared native warm-up first: guarantees NewPipe.init + the
  // extractor's service registry are completed before this (and every later)
  // prewarm, so the chain a prompt tap adopts never pays inline init cost.
  //
  // Best effort: the resolver itself de-duplicates by track-identity-key and
  // surfaces errors at the tap boundary, so a prewarm miss must never surface.
  void warmStreamOnce()
    .then(() => musicService.prefetchStream(track))
    .catch(() => {
      // Swallow: a prewarm resolution failure is not a user-visible error.
    });
}
