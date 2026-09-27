import { useCallback, useRef, useSyncExternalStore } from 'react';

import { playerController } from '../services/composition';
import type { PlayerSnapshot } from './PlayerController';

/**
 * Selector-based subscription to the ONE PlayerController snapshot.
 *
 * The controller republishes a NEW snapshot object on every position tick
 * (~2x/s while playing). A plain `useSyncExternalStore(subscribe,
 * getSnapshot)` therefore re-renders its component on every tick even when
 * the component never reads `positionMs` — which is exactly what happened
 * to Home, Playlist and the player layer (whole trees rebuilt twice a
 * second for a value they don't display).
 *
 * This hook gives React a STABLE selected value instead:
 * - the selected value is cached per snapshot identity, and
 * - when a selector's value is `Object.is`-equal to the previous one, the
 *   cached value is returned unchanged, so React's external-store bail-out
 *   skips the re-render entirely.
 *
 * One notification still wakes every subscriber (single listener set by
 * design — no per-component store variants), but only components whose
 * SELECTED state actually changed re-render. Position-sensitive surfaces
 * (seekbar, time readouts, progress hairline, notification mirror) select
 * `positionMs` and keep updating exactly as before.
 *
 * Rules for callers:
 * - selectors should return primitives or stable references (fields of the
 *   snapshot), not freshly-built objects, unless paired with `isEqual`;
 * - `isEqual` (e.g. `shallowEqual`) lets a selector return a small grouped
 *   object without re-rendering on every tick.
 */
export function usePlayerSelector<T>(
  select: (snapshot: PlayerSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const selectRef = useRef(select);
  const isEqualRef = useRef(isEqual);
  selectRef.current = select;
  isEqualRef.current = isEqual;
  const cacheRef = useRef<{ snapshot: PlayerSnapshot; value: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const snapshot = playerController.getSnapshot();
    const cache = cacheRef.current;
    if (cache !== null && cache.snapshot === snapshot) return cache.value;
    const next = selectRef.current(snapshot);
    if (cache !== null && isEqualRef.current(cache.value, next)) {
      // Same value by contract: re-point the cache at the new snapshot so
      // the next tick starts fresh, but hand React the OLD value identity
      // — that identity is what lets React bail out of this notification.
      cache.snapshot = snapshot;
      return cache.value;
    }
    const fresh = { snapshot, value: next };
    cacheRef.current = fresh;
    return fresh.value;
  }, []);

  return useSyncExternalStore(playerController.subscribe, getSnapshot);
}

/** Key-count equality over own enumerable keys — pairs with usePlayerSelector. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' || a === null ||
    typeof b !== 'object' || b === null
  ) {
    return false;
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  const bRecord = b as Record<string, unknown>;
  for (const key of aKeys) {
    if (!Object.is((a as Record<string, unknown>)[key], bRecord[key])) {
      return false;
    }
  }
  return true;
}
