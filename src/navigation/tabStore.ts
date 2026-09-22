import { useSyncExternalStore } from 'react';

export type ActiveTab = 'home' | 'search' | 'library';

let currentTab: ActiveTab = 'home';
const listeners = new Set<() => void>();

export const tabStore = {
  getTab(): ActiveTab {
    return currentTab;
  },
  setTab(tab: ActiveTab) {
    if (currentTab !== tab) {
      currentTab = tab;
      listeners.forEach((listener) => listener());
    }
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useActiveTab(): ActiveTab {
  return useSyncExternalStore(tabStore.subscribe, tabStore.getTab);
}
