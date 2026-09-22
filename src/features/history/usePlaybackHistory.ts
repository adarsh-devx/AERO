import { useEffect, useSyncExternalStore } from 'react';

import type { Track } from '../../core/types/track';
import { playbackHistory } from '../../services/composition';

/**
 * Subscribes to the app-level playback history (newest first) and
 * triggers the one-time hydration from persistent storage.
 */
export function usePlaybackHistory(): readonly Track[] {
  useEffect(() => {
    void playbackHistory.hydrate();
  }, []);

  return useSyncExternalStore(playbackHistory.subscribe, playbackHistory.getSnapshot);
}
