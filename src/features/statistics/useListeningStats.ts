import { useEffect, useSyncExternalStore } from 'react';

import { listeningStats } from '../../services/composition';
import type { ListeningStatsSnapshot } from './ListeningStats';

/**
 * Subscribes to the app-level listening statistics and triggers the
 * one-time hydration from persistent storage. The snapshot reference is
 * stable until a statistic actually changes, so consumers re-render only
 * when real playback events (or a clear) updated the record.
 */
export function useListeningStats(): ListeningStatsSnapshot {
  useEffect(() => {
    void listeningStats.hydrate();
  }, []);

  return useSyncExternalStore(listeningStats.subscribe, listeningStats.getSnapshot);
}
