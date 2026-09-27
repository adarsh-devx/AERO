import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { Track } from '../../core/types/track';
import { trackIdentityKey } from '../../core/types/track';
import { downloads, downloadService } from '../../services/composition';
import type { DownloadActivity, DownloadedTrack } from './Downloads';

export interface UseDownloadsResult {
  /** Completed downloads, newest first. */
  readonly downloads: readonly DownloadedTrack[];
  /** Whether a track has a completed download. */
  readonly isDownloaded: (track: Track) => boolean;
  /**
   * Transient state for a track: queued (waiting for a slot or a retry
   * backoff), downloading (with throttled progress) or failed (with its
   * error); null when idle or completed. Backed by the one app-level
   * store — screens keep no private download state.
   */
  readonly getActivity: (track: Track) => DownloadActivity | null;
  /**
   * Every track with transient activity (queued / downloading / failed),
   * each with its Track — lets the offline library list in-flight work
   * started from ANY screen. Disjoint from `downloads` (completion clears
   * activity).
   */
  readonly activityList: readonly { readonly track: Track; readonly activity: DownloadActivity }[];
  /** Enqueues a download; a second call joins the same job (single-flight). */
  readonly downloadTrack: (track: Track) => void;
  /** Cancels any transient job (queued dropped, active natively stopped). */
  readonly cancelDownload: (track: Track) => void;
  /** Deletes the local file, then the store entry; UI updates via store. */
  readonly removeDownload: (track: Track) => void;
  /**
   * Bulk delete: cancels every live job and removes every completed
   * entry (file first, entry second). Never touches MediaStore music or
   * any other store. Resolves with per-entry counts for error reporting.
   */
  readonly clearAllDownloads: () => Promise<{ readonly removed: number; readonly failed: number }>;
}

/**
 * Subscribes to the app-level downloads store (completed entries AND
 * transient activity) and triggers the one-time hydration/reconciliation.
 * Every screen shares these snapshots, so download state stays consistent
 * across Search → Home → Library → Now Playing without any screen
 * re-fetching or holding its own copy.
 */
export function useDownloads(): UseDownloadsResult {
  useEffect(() => {
    void downloads.hydrate();
  }, []);

  const items = useSyncExternalStore(downloads.subscribe, downloads.getSnapshot);
  const activities = useSyncExternalStore(
    downloads.subscribe,
    downloads.getActivitySnapshot,
  );

  // Derived view over the snapshot — recomputed only when the store's
  // activity snapshot changes, never per render.
  const activityList = useMemo(
    () => Object.values(activities).map((activity) => ({ track: activity.track, activity })),
    [activities],
  );

  return {
    downloads: items,
    isDownloaded: (track: Track) => downloads.isDownloaded(track),
    getActivity: (track: Track) => activities[trackIdentityKey(track)] ?? null,
    activityList,
    downloadTrack: (track: Track) => void downloadService.startDownload(track),
    cancelDownload: (track: Track) => downloadService.cancelDownload(track),
    removeDownload: (track: Track) => void downloadService.removeDownload(track),
    clearAllDownloads: () => downloadService.clearAll(),
  };
}
