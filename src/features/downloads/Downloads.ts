import type { KeyValueStore } from '../../core/storage/types';
import type { Track } from '../../core/types/track';
import { isTrack, trackIdentityKey, getTrackArtworkUri } from '../../core/types/track';
import { fileDownloads, type FileDownloadsSource } from '../../native/fileDownloads';

export const DOWNLOADS_STORAGE_KEY = 'aero:downloads';

/**
 * A completed download: the original Track (identity, title, artist,
 * artwork preserved) plus its persistent local audio file.
 *
 * `localFilePath` is what makes the entry real — entries without one are
 * dropped on load (they pre-date actual file downloads and never had a
 * file on disk).
 */
export interface DownloadedTrack extends Track {
  /** Absolute path of the downloaded audio file in app-private storage. */
  localFilePath: string;
  downloadedAt: number;
  fileSizeBytes?: number;
  /** MIME type reported by the stream resolver at download time. */
  mimeType?: string;
}

/**
 * Transient, non-persisted state of a download job.
 *
 * Exactly one status per track at a time — never 'downloading' +
 * 'queued' together, never progress on a queued row:
 *  - 'queued': waiting for a scheduler slot (or backing off before an
 *    automatic retry). No network progress is claimed — and, like every
 *    transient state, it does NOT survive process death (see class doc);
 *  - 'downloading': a native transfer is running (real progress);
 *  - 'failed': the job gave up (kept for Retry/Remove until dismissed).
 *
 * Carries the Track itself so any screen can list CURRENTLY ACTIVE work
 * (e.g. Library's offline section showing a download started from Search)
 * without keeping a private copy of the track — the activity map is still
 * the one source of truth, keyed by track identity.
 */
export type DownloadActivity =
  | {
      readonly status: 'queued';
      /** The track waiting for a slot (identity: origin + id). */
      readonly track: Track;
    }
  | {
      readonly status: 'downloading';
      /** The track being downloaded (identity: origin + id). */
      readonly track: Track;
      /** 0..1; 0 while the total size is still unknown. */
      readonly progress: number;
      /** Server-reported total bytes; -1/0 when unknown. */
      readonly totalBytes: number;
    }
  | {
      readonly status: 'failed';
      /** The track whose download failed (preserved metadata for Retry). */
      readonly track: Track;
      readonly error: string;
    };

/** Map of track identity key → transient activity. */
export type DownloadActivities = Readonly<Record<string, DownloadActivity>>;

const EMPTY_ACTIVITIES: DownloadActivities = {};

/**
 * Age guards for startup reconciliation. A file younger than this can
 * belong to a download that just completed (its entry write may still be
 * in flight), so it is never treated as an orphan.
 */
const ORPHAN_MIN_AGE_MS = 60_000;
/** Partial `.part` leftovers younger than this may belong to an active job. */
const PART_MIN_AGE_MS = 15 * 60_000;

/**
 * Persistent Downloads & Offline Storage manager.
 *
 * Follows the same external-store pattern as PlaybackHistory, LikedSongs
 * and Playlists: framework-free (subscribe/getSnapshot match
 * useSyncExternalStore), one app-level instance, persisted via the shared
 * KeyValueStore. Contains exactly two kinds of state:
 *
 * 1. COMPLETED downloads (persisted): the Track + its local file path.
 *    This is the single source of truth the stream resolver consults for
 *    offline playback.
 * 2. TRANSIENT activity (in-memory only): queued / downloading progress /
 *    failure. Progress lives here so every screen reacts to the same
 *    values instead of keeping private download state. Deliberately NOT
 *    persisted: a restart finds no stale queued/downloading jobs at all
 *    (nothing is mis-recovered as "actively downloading"), while
 *    completed entries and files reconcile exactly as before.
 *
 * The store performs no downloads and no stream resolution itself — the
 * DownloadService owns that orchestration. On hydrate it runs ONE
 * lightweight reconciliation pass over the downloads directory: entries
 * whose file vanished are dropped (and persisted), orphaned files and
 * stale `.part` leftovers older than the age guards are cleaned up.
 */
export class Downloads {
  private readonly store: KeyValueStore;
  private readonly files: FileDownloadsSource;
  private readonly listeners = new Set<() => void>();
  private tracks: readonly DownloadedTrack[] = [];
  private activities: DownloadActivities = EMPTY_ACTIVITIES;
  private readyPromise: Promise<void> | null = null;

  constructor(store: KeyValueStore, files: FileDownloadsSource = fileDownloads) {
    this.store = store;
    this.files = files;
  }

  /** React external-store subscription (shared by both snapshots). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Completed downloads, newest first. */
  getSnapshot = (): readonly DownloadedTrack[] => this.tracks;

  /** Transient download activity keyed by track identity. */
  getActivitySnapshot = (): DownloadActivities => this.activities;

  /** Loads persisted downloads once (plus reconciliation); shared promise. */
  hydrate(): Promise<void> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /** Whether a track has a completed download. */
  isDownloaded(track: Track): boolean {
    return this.getEntry(track) !== null;
  }

  /** The completed-download entry for a track, or null. */
  getEntry(track: Track): DownloadedTrack | null {
    const key = trackIdentityKey(track);
    return this.tracks.find((item) => trackIdentityKey(item) === key) ?? null;
  }

  /**
   * Playback seam for the stream resolver: the local file behind a
   * completed download as a file:// URI, or null when not downloaded.
   * Pure JS over persisted state — no native calls on the resolve path.
   */
  getLocalFile(track: Track): { uri: string; mimeType?: string } | null {
    const entry = this.getEntry(track);
    if (!entry) return null;
    const uri = entry.localFilePath.startsWith('file://')
      ? entry.localFilePath
      : `file://${entry.localFilePath}`;
    return { uri, mimeType: entry.mimeType };
  }

  /** Transient activity for one track (null when idle/completed). */
  getActivity(track: Track): DownloadActivity | null {
    return this.activities[trackIdentityKey(track)] ?? null;
  }

  // ── Transient state (no hydration required; notifies subscribers) ──────

  /**
   * Marks a track as queued: waiting for a scheduler slot (or for an
   * automatic retry's backoff). Claims NO network progress — the row
   * simply reads as "Waiting…" until an attempt actually starts.
   */
  queueDownload(track: Track): void {
    this.applyActivity(trackIdentityKey(track), { status: 'queued', track });
  }

  /** Marks a track as downloading (progress 0, total unknown). */
  beginDownload(track: Track): void {
    this.applyActivity(trackIdentityKey(track), {
      status: 'downloading',
      track,
      progress: 0,
      totalBytes: -1,
    });
  }

  /**
   * Records throttled progress for an active download. Updates apply only
   * while the track is still in the downloading state (a cancelled or
   * failed download ignores late events) and are coalesced to whole
   * percent steps so the UI never re-renders per byte.
   */
  updateDownloadProgress(track: Track, progress: number, totalBytes: number): void {
    const key = trackIdentityKey(track);
    const current = this.activities[key];
    if (!current || current.status !== 'downloading') return;

    const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    const knownTotal = totalBytes > 0 ? totalBytes : -1;
    const quantized = knownTotal > 0 ? Math.floor(clamped * 100) / 100 : current.progress;
    if (quantized === current.progress && knownTotal === current.totalBytes) return;

    this.applyActivity(key, {
      status: 'downloading',
      track: current.track,
      progress: quantized,
      totalBytes: knownTotal,
    });
  }

  /** Marks a download as failed with its error (shown as Retry in the UI). */
  failDownload(track: Track, error: string): void {
    this.applyActivity(trackIdentityKey(track), { status: 'failed', track, error });
  }

  /** Clears transient activity (cancel, success, or simply idle). */
  clearDownloadActivity(track: Track): void {
    this.applyActivity(trackIdentityKey(track), null);
  }

  // ── Completed downloads (persisted) ────────────────────────────────────

  /**
   * Persists a successful download as the track's completed entry and
   * clears its transient activity. Identity keeps the original origin/id,
   * so the same track elsewhere in the app instantly reads as downloaded.
   */
  async completeDownload(
    track: Track,
    file: {
      readonly localFilePath: string;
      readonly fileSizeBytes?: number;
      readonly mimeType?: string;
    },
  ): Promise<void> {
    await this.hydrate();

    const entry: DownloadedTrack = {
      ...track,
      artworkUri: getTrackArtworkUri(track) ?? track.artworkUri,
      localFilePath: file.localFilePath,
      downloadedAt: Date.now(),
      fileSizeBytes: file.fileSizeBytes,
      mimeType: file.mimeType,
    };
    const key = trackIdentityKey(entry);
    const remaining = this.tracks.filter((item) => trackIdentityKey(item) !== key);

    this.tracks = [entry, ...remaining];
    // Transient activity ends the moment the download completes — one
    // notify covers entry + activity so subscribers render once.
    this.deleteActivity(key);
    this.notify();
    await this.persist();
  }

  /**
   * Removes a completed-download ENTRY (the service deletes the file
   * first). Clears any transient activity alongside it. Idempotent.
   */
  async removeDownload(track: Track): Promise<void> {
    await this.hydrate();

    const key = trackIdentityKey(track);
    const remaining = this.tracks.filter((item) => trackIdentityKey(item) !== key);
    const hadEntry = remaining.length !== this.tracks.length;
    const hadActivity = this.deleteActivity(key);
    if (!hadEntry && !hadActivity) return;

    this.tracks = remaining;
    this.notify();
    await this.persist();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** Applies one activity change (or null) and notifies when changed. */
  private applyActivity(key: string, activity: DownloadActivity | null): void {
    const current = this.activities[key];
    if (activity === null) {
      if (!current) return;
      this.deleteActivity(key);
      this.notify();
      return;
    }
    if (
      current &&
      current.status === activity.status &&
      current.status === 'downloading' &&
      activity.status === 'downloading' &&
      current.progress === activity.progress &&
      current.totalBytes === activity.totalBytes
    ) {
      return;
    }
    // Re-queueing an already-queued track is a no-op (single job per
    // identity — the status carries nothing else to update).
    if (current && current.status === 'queued' && activity.status === 'queued') {
      return;
    }
    if (current && current.status === 'failed' && activity.status === 'failed' && current.error === activity.error) {
      return;
    }
    const next = { ...this.activities, [key]: activity };
    this.activities = next;
    this.notify();
  }

  /** Removes one activity entry; returns whether anything changed. */
  private deleteActivity(key: string): boolean {
    if (!(key in this.activities)) return false;
    const next = { ...this.activities };
    delete next[key];
    this.activities = Object.keys(next).length > 0 ? next : EMPTY_ACTIVITIES;
    return true;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(DOWNLOADS_STORAGE_KEY);
    } catch (error) {
      console.warn('[DOWNLOADS] storage unavailable; starting empty.', error);
      return;
    }

    let droppedLegacy = 0;

    let loaded: DownloadedTrack[] = [];
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (this.isDownloadedTrackEntry(item)) {
              loaded.push({
                ...item,
                artworkUri: getTrackArtworkUri(item) ?? item.artworkUri,
              });
            } else if (isTrack(item)) {
              // A Track without a local file: pre-download-era fake entry.
              droppedLegacy += 1;
            }
          }
        } else {
          console.warn('[DOWNLOADS] stored downloads are not an array; ignoring them.');
        }
      } catch (error) {
        console.warn('[DOWNLOADS] malformed stored downloads ignored.', error);
      }
    }

    const reconciled = await this.reconcileWithDisk(loaded);

    const totalDropped = droppedLegacy + (loaded.length - reconciled.length);
    this.replace(reconciled);
    if (totalDropped > 0) {
      console.warn(`[DOWNLOADS] dropped ${totalDropped} entries without a file on disk.`);
      await this.persist();
    }
  }

  /**
   * ONE lightweight reconciliation pass against the downloads directory
   * (a single native listing — no per-render or per-entry scans):
   *
   * - entries whose file no longer exists are dropped (the track simply
   *   reads as "not downloaded" again and can be re-downloaded);
   * - files no entry references are deleted once older than the age
   *   guards, which also clears stale `.part` leftovers from a killed
   *   session without ever racing a download that just finished.
   *
   * Skipped entirely when the native module is absent — there is nothing
   * to verify against, and entries must not be dropped blind.
   *
   * Never races an active job BY CONSTRUCTION: this pass runs only inside
   * hydrate(), and DownloadService awaits hydrate() before ANY job is
   * enqueued — so no `.part` file on disk can belong to a running
   * download at this moment (the age guards are a second line of defense,
   * not the only one).
   */
  private async reconcileWithDisk(entries: readonly DownloadedTrack[]): Promise<readonly DownloadedTrack[]> {
    if (!this.files.isAvailable()) return entries;

    try {
      const filesOnDisk = await this.files.listFiles();
      const onDisk = new Set(filesOnDisk.map((file) => file.filePath));
      const kept = entries.filter((entry) => onDisk.has(entry.localFilePath));

      const referenced = new Set(kept.map((entry) => entry.localFilePath));
      const now = Date.now();
      const staleCleanups: Promise<boolean>[] = [];
      for (const file of filesOnDisk) {
        if (referenced.has(file.filePath)) continue;
        const age = now - (file.lastModified || 0);
        if (file.filePath.endsWith('.part')) {
          if (age >= PART_MIN_AGE_MS) staleCleanups.push(this.files.deleteFile(file.filePath));
        } else if (age >= ORPHAN_MIN_AGE_MS) {
          staleCleanups.push(this.files.deleteFile(file.filePath));
        }
      }
      // Best-effort cleanup: never blocks hydration.
      if (staleCleanups.length > 0) void Promise.all(staleCleanups);

      return kept;
    } catch (error) {
      console.warn('[DOWNLOADS] reconciliation skipped (listing failed).', error);
      return entries;
    }
  }

  /** Structural check for a persisted completed-download entry. */
  private isDownloadedTrackEntry(value: unknown): value is DownloadedTrack {
    if (!isTrack(value)) return false;
    const candidate = value as Partial<DownloadedTrack>;
    return (
      typeof candidate.localFilePath === 'string' &&
      candidate.localFilePath.length > 0 &&
      (candidate.downloadedAt === undefined || typeof candidate.downloadedAt === 'number')
    );
  }

  private async persist(): Promise<void> {
    try {
      await this.store.setItem(DOWNLOADS_STORAGE_KEY, JSON.stringify(this.tracks));
    } catch (error) {
      console.warn('[DOWNLOADS] could not persist downloads.', error);
    }
  }

  private replace(next: readonly DownloadedTrack[]): void {
    this.tracks = next;
    this.notify();
  }
}
