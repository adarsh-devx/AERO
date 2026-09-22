import { useEffect, useSyncExternalStore } from 'react';

import { searchHistory } from '../../services/composition';

/**
 * Hook for subscribing to persistent search history.
 * Ensures hydration starts on first mount.
 */
export function useSearchHistory(): readonly string[] {
  useEffect(() => {
    void searchHistory.hydrate();
  }, []);

  return useSyncExternalStore(
    searchHistory.subscribe,
    searchHistory.getSnapshot,
  );
}
