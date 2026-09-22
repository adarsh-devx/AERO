import type { KeyValueStore } from '../../core/storage/types';
import type { Track } from '../../core/types/track';
import { isTrack, trackIdentityKey, getTrackArtworkUri } from '../../core/types/track';
import { isPlaylist, type Playlist } from './types';
import { PLAYLISTS_STORAGE_KEY } from './constants';

/** Generates a stable unique playlist id (time + random suffix). */
function generatePlaylistId(): string {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Normalizes a user-supplied playlist name: trimmed, non-empty. */
export function normalizePlaylistName(rawName: string): string | null {
  const name = rawName.trim();
  return name.length > 0 ? name : null;
}

/**
 * Persistent user playlists, newest-created first.
 *
 * Follows the same external-store pattern as PlaybackHistory and
 * LikedSongs: framework-free (subscribe/getSnapshot match
 * useSyncExternalStore), one app-level instance, persisted via the
 * shared KeyValueStore. Playlist identity is the generated id, never
 * the editable name. Every storage failure degrades gracefully —
 * playlists are never allowed to break playback or crash the app.
 */
export class Playlists {
  private readonly store: KeyValueStore;
  private readonly listeners = new Set<() => void>();
  private items: readonly Playlist[] = [];
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

  /** React external-store snapshot: newest-created first. */
  getSnapshot = (): readonly Playlist[] => this.items;

  /** Loads persisted playlists once; concurrent callers share the promise. */
  hydrate(): Promise<void> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /** Returns a playlist by id, or null when it does not (or no longer) exist. */
  getPlaylist(id: string): Playlist | null {
    return this.items.find((playlist) => playlist.id === id) ?? null;
  }

  /** Creates an empty playlist with a normalized name; returns its id. */
  createPlaylist(rawName: string): string | null {
    const name = normalizePlaylistName(rawName);
    if (name === null) return null;

    const now = Date.now();
    const playlist: Playlist = {
      id: generatePlaylistId(),
      name,
      tracks: [],
      createdAt: now,
      updatedAt: now,
    };
    this.replace([playlist, ...this.items]);
    void this.persist();
    return playlist.id;
  }

  /** Renames a playlist; blank names are ignored. */
  renamePlaylist(id: string, rawName: string): void {
    const name = normalizePlaylistName(rawName);
    if (name === null) return;
    this.mutatePlaylist(id, (playlist) => ({ ...playlist, name, updatedAt: Date.now() }));
  }

  /** Deletes a playlist and all of its track references. */
  deletePlaylist(id: string): void {
    const remaining = this.items.filter((playlist) => playlist.id !== id);
    if (remaining.length === this.items.length) return;
    this.replace(remaining);
    void this.persist();
  }

  /**
   * Adds a track to a playlist. A track (identity: origin + id) never
   * appears twice in the same playlist; adding an existing track is a
   * no-op.
   */
  addTrack(playlistId: string, track: Track): void {
    const enrichedTrack: Track = {
      ...track,
      artworkUri: getTrackArtworkUri(track) ?? track.artworkUri,
    };
    this.mutatePlaylist(playlistId, (playlist) => {
      const key = trackIdentityKey(enrichedTrack);
      if (playlist.tracks.some((existing) => trackIdentityKey(existing) === key)) {
        return null; // unchanged — no duplicates
      }
      return { ...playlist, tracks: [...playlist.tracks, enrichedTrack], updatedAt: Date.now() };
    });
  }

  /** Removes a track (by identity) from a playlist; absent tracks are a no-op. */
  removeTrack(playlistId: string, track: Track): void {
    this.mutatePlaylist(playlistId, (playlist) => {
      const key = trackIdentityKey(track);
      const tracks = playlist.tracks.filter((existing) => trackIdentityKey(existing) !== key);
      if (tracks.length === playlist.tracks.length) return null; // unchanged
      return { ...playlist, tracks, updatedAt: Date.now() };
    });
  }

  /** Applies a change to one playlist; null from the mutator means no change. */
  private mutatePlaylist(
    id: string,
    mutate: (playlist: Playlist) => Playlist | null,
  ): void {
    const index = this.items.findIndex((playlist) => playlist.id === id);
    if (index < 0) return;
    const next = mutate(this.items[index]);
    if (next === null) return;
    const items = [...this.items];
    items[index] = next;
    this.replace(items);
    void this.persist();
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(PLAYLISTS_STORAGE_KEY);
    } catch (error) {
      console.warn('[PLAYLISTS] storage unavailable; starting with no playlists.', error);
      return;
    }

    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[PLAYLISTS] stored playlists are not an array; ignoring them.');
        return;
      }
      // Drop malformed entries; validate persisted tracks defensively.
      this.replace(
        parsed
          .filter(isPlaylist)
          .map((playlist) => ({
            ...playlist,
            tracks: playlist.tracks
              .filter(isTrack)
              .map((t) => ({
                ...t,
                artworkUri: getTrackArtworkUri(t) ?? t.artworkUri,
              })),
          })),
      );
    } catch (error) {
      console.warn('[PLAYLISTS] malformed stored playlists ignored.', error);
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.store.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(this.items));
    } catch (error) {
      console.warn('[PLAYLISTS] could not persist playlists.', error);
    }
  }

  private replace(next: readonly Playlist[]): void {
    // New array reference so external-store subscribers re-render.
    this.items = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
