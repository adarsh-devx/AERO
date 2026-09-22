/**
 * Experimental, opt-in behaviour flags.
 *
 * These are AERO-SPECIFIC experiments used to study cold-start latency.
 * They are explicitly NOT NØTE behaviour: verified NØTE source contains no
 * search-result pre-resolution, no pre-tap warming, and no Home render
 * warming of any kind.
 *
 * Conventions for flags in this file:
 * - the flag gates ONE self-contained component, never scattered logic;
 * - the value is read at the call site, so the behaviour can be turned
 *   off without touching the component itself;
 * - turning a flag off must leave the app fully working (best-effort
 *   experiments never become a required code path).
 */

/**
 * AERO EXPERIMENT (not NØTE parity):
 * when a search returns online results, warm the first playable online
 * track in the background BEFORE the user taps it.
 *
 * It warms through the existing prefetch seam
 * (MusicService.prefetchStream -> CompositeStreamResolver.resolve), so it
 * reuses that resolver's cache and its in-flight Promise de-duplication.
 * It creates no cache of its own. It never starts playback, never mutates
 * the queue or the current track, and never navigates.
 */
export const EXPERIMENTAL_SEARCH_PREWARM = true;

/**
 * AERO EXPERIMENT (not NØTE parity):
 * pay the fixed cold-start costs of the play path before the user's first
 * tap, instead of inside it.
 *
 * Two costs are provably on the first tap's critical path (see
 * StreamResolutionModule.warmUpAsync and ExpoAudioPlaybackEngine.warmUp):
 *  - NewPipe.init(...) + the extractor's service registry, which today run as
 *    the first statements of the first resolution;
 *  - construction of the single native AudioPlayer (ExoPlayer), which today
 *    happens lazily inside the first engine.load().
 *
 * Warming issues no network request, resolves no stream, starts no playback,
 * and leaves every lazy path intact: each warm-up target either returns the
 * already-created singleton or is guarded by NewPipe's own AtomicBoolean, so
 * calling it more than once is a no-op. Set to false and the app behaves
 * exactly as before.
 */
export const EXPERIMENTAL_COLD_START_WARMUP = true;
