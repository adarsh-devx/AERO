import { useSyncExternalStore } from 'react';
import { youtubeAuthStore, type YouTubeAuthSnapshot } from './YouTubeAuthStore';

export function useYouTubeAuth(): YouTubeAuthSnapshot {
  return useSyncExternalStore(
    youtubeAuthStore.subscribe,
    youtubeAuthStore.getSnapshot,
  );
}
