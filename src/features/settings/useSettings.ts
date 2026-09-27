import { useEffect, useSyncExternalStore } from 'react';

import { settings } from '../../services/composition';
import type { SettingsRecord } from './SettingsStore';

/**
 * Hook for subscribing to the ONE persisted settings record.
 * Ensures hydration starts on first mount; the snapshot reference is
 * stable until a value actually changes, so consumers re-render only
 * when a preference changes.
 */
export function useSettings(): SettingsRecord {
  useEffect(() => {
    void settings.hydrate();
  }, []);

  return useSyncExternalStore(
    settings.subscribe,
    settings.getSnapshot,
  );
}
