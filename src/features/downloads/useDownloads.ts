import { useEffect, useSyncExternalStore } from 'react';

import type { Track } from '../../core/types/track';
import { downloads } from '../../services/composition';
import type { DownloadedTrack } from './Downloads';

export interface UseDownloadsResult {
  readonly downloads: readonly DownloadedTrack[];
  readonly isDownloaded: (track: Track) => boolean;
  readonly downloadTrack: (track: Track) => void;
  readonly removeDownload: (track: Track) => void;
}

/**
 * Hook for subscribing to persistent downloads state.
 */
export function useDownloads(): UseDownloadsResult {
  useEffect(() => {
    void downloads.hydrate();
  }, []);

  const items = useSyncExternalStore(
    downloads.subscribe,
    downloads.getSnapshot,
  );

  return {
    downloads: items,
    isDownloaded: (track: Track) => downloads.isDownloaded(track),
    downloadTrack: (track: Track) => downloads.downloadTrack(track),
    removeDownload: (track: Track) => downloads.removeDownload(track),
  };
}
