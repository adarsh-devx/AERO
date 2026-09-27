import { useEffect, useState, useSyncExternalStore } from 'react';

import { playlists } from '../../services/composition';
import type { Track } from '../../core/types/track';
import type { Playlist } from './types';

export interface UsePlaylistsResult {
  /** All playlists, newest-created first. */
  readonly playlists: readonly Playlist[];
  /**
   * Whether persisted playlists have finished loading. Lets screens
   * distinguish "not hydrated yet" from "really deleted/missing" before
   * reacting (e.g. navigating away from a deleted playlist).
   */
  readonly hydrated: boolean;
  /** Returns a playlist by id, or null when it does not exist. */
  readonly getPlaylist: (id: string) => Playlist | null;
  /** Creates a playlist; returns the new id, or null for a blank name. */
  readonly createPlaylist: (name: string) => string | null;
  /** Renames a playlist (blank names are ignored). */
  readonly renamePlaylist: (id: string, name: string) => void;
  /** Deletes a playlist. */
  readonly deletePlaylist: (id: string) => void;
  /** Adds a track to a playlist (never duplicated). */
  readonly addTrack: (playlistId: string, track: Track) => void;
  /** Removes a track from a playlist. */
  readonly removeTrack: (playlistId: string, track: Track) => void;
  /** Reorders a track within a playlist (move from one index to another). */
  readonly moveTrack: (playlistId: string, fromIndex: number, toIndex: number) => void;
}

/**
 * Subscribes to the app-level playlists and triggers the one-time
 * hydration from persistent storage.
 */
export function usePlaylists(): UsePlaylistsResult {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    void playlists.hydrate().then(() => setHydrated(true));
  }, []);

  const items = useSyncExternalStore(playlists.subscribe, playlists.getSnapshot);

  return {
    playlists: items,
    hydrated,
    getPlaylist: (id: string) => playlists.getPlaylist(id),
    createPlaylist: (name: string) => playlists.createPlaylist(name),
    renamePlaylist: (id: string, name: string) => playlists.renamePlaylist(id, name),
    deletePlaylist: (id: string) => playlists.deletePlaylist(id),
    addTrack: (playlistId: string, track: Track) => playlists.addTrack(playlistId, track),
    removeTrack: (playlistId: string, track: Track) => playlists.removeTrack(playlistId, track),
    moveTrack: (playlistId: string, fromIndex: number, toIndex: number) =>
      playlists.moveTrack(playlistId, fromIndex, toIndex),
  };
}