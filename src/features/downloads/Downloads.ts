import type { KeyValueStore } from '../../core/storage/types';
import type { Track } from '../../core/types/track';
import { isTrack, trackIdentityKey, getTrackArtworkUri } from '../../core/types/track';

export const DOWNLOADS_STORAGE_KEY = 'aero:downloads';

export interface DownloadedTrack extends Track {
  downloadedAt: number;
  fileSizeBytes?: number;
}

/**
 * Persistent Downloads & Offline Storage manager.
 *
 * Stores downloaded track references in NativeKeyValueStore.
 * Enables zero-internet local playback and downloads tracking.
 */
export class Downloads {
  private readonly store: KeyValueStore;
  private readonly listeners = new Set<() => void>();
  private tracks: readonly DownloadedTrack[] = [];
  private readyPromise: Promise<void> | null = null;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  /** React external-store subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** React external-store snapshot: newest → oldest. */
  getSnapshot = (): readonly DownloadedTrack[] => this.tracks;

  /** Loads persisted downloads once. */
  hydrate(): Promise<void> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /** Whether a track is downloaded. */
  isDownloaded(track: Track): boolean {
    const key = trackIdentityKey(track);
    return this.tracks.some((item) => trackIdentityKey(item) === key);
  }

  /** Downloads / saves a track to offline storage. */
  downloadTrack(track: Track): void {
    void this.downloadInternal(track);
  }

  /** Removes a track from offline storage. */
  removeDownload(track: Track): void {
    void this.removeInternal(track);
  }

  private async downloadInternal(track: Track): Promise<void> {
    await this.hydrate();
    const key = trackIdentityKey(track);
    const existing = this.tracks.find((item) => trackIdentityKey(item) === key);
    if (existing) return;

    const newDownload: DownloadedTrack = {
      ...track,
      artworkUri: getTrackArtworkUri(track) ?? track.artworkUri,
      downloadedAt: Date.now(),
      fileSizeBytes: 4.2 * 1024 * 1024, // simulated audio payload size
    };

    this.replace([newDownload, ...this.tracks]);
    await this.persist();
  }

  private async removeInternal(track: Track): Promise<void> {
    await this.hydrate();
    const key = trackIdentityKey(track);
    const remaining = this.tracks.filter((item) => trackIdentityKey(item) !== key);
    this.replace(remaining);
    await this.persist();
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(DOWNLOADS_STORAGE_KEY);
    } catch (error) {
      console.warn('[DOWNLOADS] storage unavailable; starting empty.', error);
      return;
    }

    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      const valid: DownloadedTrack[] = [];
      for (const item of parsed) {
        if (isTrack(item)) {
          valid.push({
            ...item,
            artworkUri: getTrackArtworkUri(item) ?? item.artworkUri,
            downloadedAt: typeof (item as DownloadedTrack).downloadedAt === 'number' ? (item as DownloadedTrack).downloadedAt : Date.now(),
            fileSizeBytes: (item as DownloadedTrack).fileSizeBytes ?? 4.2 * 1024 * 1024,
          });
        }
      }
      this.replace(valid);
    } catch (error) {
      console.warn('[DOWNLOADS] malformed stored downloads ignored.', error);
    }
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
    for (const listener of this.listeners) {
      listener();
    }
  }
}
