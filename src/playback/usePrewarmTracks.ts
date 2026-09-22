import { useEffect, useRef } from 'react';

import type { Track } from '../core/types/track';
import { prewarmTrack } from './ExperimentalTrackPreloader';

/**
 * THE shared prewarm seam for every list that can start playback.
 *
 * Why this exists: Next/Previous are instant because the rolling one-track-ahead
 * preloader warms `queue.peekNext()` once a track has started. A tap on the
 * FIRST track of a freshly rendered list has no such warm, so it pays the full
 * cold NewPipe resolution. This hook gives every list the same head start —
 * through the same resolver and the same cache. There is deliberately no second
 * resolver, no second cache and no per-screen preloader.
 *
 * Contract:
 * - offers the FIRST playable online track of the list — the most likely tap —
 *   and nothing else, so rendering a list can never start a burst of
 *   resolutions;
 * - online only: a list of local files or downloads is a no-op, because a
 *   downloaded track keeps the origin it was stored with;
 * - idempotent and de-duplicated: `prewarmTrack` returns immediately when the
 *   stream is already cached, and joins the running promise when the same
 *   track is already resolving, so several lists rendering at once cannot
 *   resolve the same track twice or run two NewPipe chains concurrently;
 * - fire-and-forget: never awaited, so it cannot delay render, navigation or
 *   playback;
 * - the hook never touches the queue, the current track or playback order.
 *
 * Callers pass a list they already render. This is a single shared seam rather
 * than one preloader per screen.
 */
export function usePrewarmTracks(tracks: readonly Track[] | null | undefined): void {
  const firstOnline = tracks?.find((track) => track.origin === 'online') ?? null;
  const firstOnlineId = firstOnline?.id ?? null;

  // What this hook has already offered. Without it, a list rebuilt on every
  // render would re-offer the same track on every render.
  const offeredId = useRef<string | null>(null);

  useEffect(() => {
    if (!firstOnlineId || offeredId.current === firstOnlineId) return;
    offeredId.current = firstOnlineId;
    // `firstOnline` is intentionally not a dependency: this effect runs only
    // when the identity of the first online track changes, and the value
    // captured here comes from that same render. Depending on the list itself
    // would re-run the effect on every render for lists rebuilt each time.
    if (firstOnline) prewarmTrack(firstOnline);
  }, [firstOnlineId]);
}
