import type { KeyValueStore } from '../../core/storage/types';
import type { Track } from '../../core/types/track';
import { isTrack, trackIdentityKey, getTrackArtworkUri } from '../../core/types/track';
import { LIKED_SONGS_STORAGE_KEY } from './constants';

/**
 * Persistent liked-songs collection, newest first.
 *
 * Framework-free and React-compatible (subscribe/getSnapshot match
 * useSyncExternalStore). Toggling likes is idempotent and de-duplicates by
 * identity (track identity key).
 *
 * Every storage failure degrades gracefully — likes are never allowed to
 * break playback or crash the app.
 */
export class LikedSongs {
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

  /** Loads persisted likes once; concurrent callers share the promise. */
  hydrate(): Promise<void> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /** Whether a track is currently liked. */
  isLiked(track: Track): boolean {
    const key = trackIdentityKey(track);
    return this.tracks.some((existing) => trackIdentityKey(existing) === key);
  }

  /** Toggles the liked state of a track. */
  toggleLike(track: Track): void {
    if (this.isLiked(track)) {
      void this.unlikeInternal(track);
    } else {
      void this.likeInternal(track);
    }
  }

  private async likeInternal(track: Track): Promise<void> {
    await this.hydrate();

    const enrichedTrack: Track = {
      ...track,
      artworkUri: getTrackArtworkUri(track) ?? track.artworkUri,
    };

    const key = trackIdentityKey(enrichedTrack);
    const remaining = this.tracks.filter((existing) => trackIdentityKey(existing) !== key);
    this.replace([enrichedTrack, ...remaining]);

    await this.persist();
  }

  private async unlikeInternal(track: Track): Promise<void> {
    await this.hydrate();

    const key = trackIdentityKey(track);
    const remaining = this.tracks.filter((existing) => trackIdentityKey(existing) !== key);
    if (remaining.length === this.tracks.length) return;

    this.replace(remaining);
    await this.persist();
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(LIKED_SONGS_STORAGE_KEY);
    } catch (error) {
      console.warn('[LIKED] storage unavailable; starting with no likes.', error);
      return;
    }

    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[LIKED] stored liked songs are not an array; ignoring them.');
        return;
      }
      const loadedTracks = parsed
        .filter(isTrack)
        .map((t) => ({
          ...t,
          artworkUri: getTrackArtworkUri(t) ?? t.artworkUri,
        }));
      this.replace(loadedTracks);
    } catch (error) {
      console.warn('[LIKED] malformed stored liked songs ignored.', error);
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.store.setItem(LIKED_SONGS_STORAGE_KEY, JSON.stringify(this.tracks));
    } catch (error) {
      console.warn('[LIKED] could not persist liked songs.', error);
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