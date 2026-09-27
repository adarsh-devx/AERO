import { useCallback, useEffect, useRef, useState } from 'react';

import type { Track } from '../../core/types/track';
import { musicService } from '../../services/composition';

export interface LibraryTracksResult {
  /** The device music catalogue (origin 'local'), in provider order. */
  readonly tracks: readonly Track[];
  /** True while a load/reload is in flight. */
  readonly loading: boolean;
  /** Load failure (e.g. audio permission denied); null when healthy. */
  readonly error: string | null;
  /** Re-queries MediaStore (used by pull-to-refresh). */
  readonly reload: () => void;
}

/**
 * Loads the device music library once and keeps it for the lifetime of the
 * screen — the tab host mounts Library up-front, so the fetch is gated on
 * the Library tab actually being open instead of running at app start.
 *
 * Source of truth is the existing provider contract, not a new API:
 * `musicService.search('')` with an empty query returns the FULL local
 * catalogue from DeviceMusicProvider (MediaStore) while the online provider
 * returns zero results without any network traffic. A provider failure
 * (permission denied, native module missing) surfaces through the errors
 * map as `error` — an honest error state, never a fake empty library.
 *
 * Reactivity contract: one fetch per session (+ explicit `reload`), latest
 * request wins, and nothing here is a store — Songs/Local/Artists (and the
 * album grouping other screens share) are pure memoized derivations of
 * `tracks` (see ./grouping.ts).
 */
export function useLibraryTracks(enabled: boolean): LibraryTracksResult {
  const [tracks, setTracks] = useState<readonly Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  /** One-shot gate: first activation loads, later renders do not re-fetch. */
  const startedRef = useRef(false);
  /** Latest-wins guard: a stale response must never overwrite a newer one. */
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (reloadCount === 0 && startedRef.current) return; // already loaded once
    startedRef.current = true;

    const requestId = (requestIdRef.current += 1);
    setLoading(true);
    setError(null);

    void musicService.search('').then(
      ({ tracks: result, errors }) => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setTracks(result);
        const localError = errors.get('local');
        setError(result.length === 0 && localError ? localError.message : null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setTracks([]);
        setError(err instanceof Error ? err.message : 'Could not load music on this device.');
        setLoading(false);
      },
    );
  }, [enabled, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  return { tracks, loading, error, reload };
}