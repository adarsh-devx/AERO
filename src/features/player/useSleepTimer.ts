import { useSyncExternalStore } from 'react';

import { sleepTimer } from '../../services/composition';
import type { SleepTimerSnapshot } from './SleepTimer';

/**
 * Subscribes to the ONE sleep-timer store. No hydrate step on purpose: the
 * timer is transient (in-memory only) and never touches storage. The
 * snapshot reference changes only when the timer is armed, replaced,
 * cancelled, expires, or its displayed minute ticks — so consumers
 * re-render at most once per minute while counting down.
 */
export function useSleepTimer(): SleepTimerSnapshot {
  return useSyncExternalStore(sleepTimer.subscribe, sleepTimer.getSnapshot);
}
