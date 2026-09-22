import type { KeyValueStore } from '../../core/storage/types';
import type { Track } from '../../core/types/track';
import { isTrack, trackIdentityKey, getTrackArtworkUri } from '../../core/types/track';
import { PLAYBACK_HISTORY_LIMIT, PLAYBACK_HISTORY_STORAGE_KEY } from './constants';

/**
 * Persistent playback history, newest first.
 *
 * Framework-free and React-compatible (subscribe/getSnapshot match
 * useSyncExternalStore). Records only what the playback layer reports as
 * successfully started; the playback layer knows nothing about history.
 *
 * Every storage failure degrades to an empty history plus a warning —
 * history is never allowed to break playback or crash the app.
 */
export class PlaybackHistory {
  private readonly store: KeyValueStore;
  private readonly listeners = new Set<() => void>();
  private tracks: readonly Track[] = [];
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
  getSnapshot = (): readonly Track[] => this.tracks;

  /** Loads persisted history once; concurrent callers share the promise. */
  hydrate(): Promise<void> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /**
   * Records a track whose playback has actually started. De-duplicates by
   * identity (existing entry moves to the top) and caps the list.
   */
  record(track: Track): void {
    void this.recordInternal(track);
  }

  private async recordInternal(track: Track): Promise<void> {
    // Never write before the existing entries are loaded, or the first
    // recorded track would overwrite stored history.
    await this.hydrate();

    const enrichedTrack: Track = {
      ...track,
      artworkUri: getTrackArtworkUri(track) ?? track.artworkUri,
    };

    const key = trackIdentityKey(enrichedTrack);
    const remaining = this.tracks.filter((existing) => trackIdentityKey(existing) !== key);
    this.replace([enrichedTrack, ...remaining].slice(0, PLAYBACK_HISTORY_LIMIT));

    await this.persist();
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(PLAYBACK_HISTORY_STORAGE_KEY);
    } catch (error) {
      console.warn('[HISTORY] storage unavailable; starting with empty history.', error);
      return;
    }

    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[HISTORY] stored history is not an array; ignoring it.');
        return;
      }
      const loadedTracks = parsed
        .filter(isTrack)
        .map((t) => ({
          ...t,
          artworkUri: getTrackArtworkUri(t) ?? t.artworkUri,
        }))
        .slice(0, PLAYBACK_HISTORY_LIMIT);
      this.replace(loadedTracks);
    } catch (error) {
      console.warn('[HISTORY] malformed stored history ignored.', error);
    }
  }


  private async persist(): Promise<void> {
    try {
      await this.store.setItem(PLAYBACK_HISTORY_STORAGE_KEY, JSON.stringify(this.tracks));
    } catch (error) {
      console.warn('[HISTORY] could not persist history.', error);
    }
  }

  private replace(next: readonly Track[]): void {
    // New array reference so external-store subscribers re-render.
    this.tracks = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
