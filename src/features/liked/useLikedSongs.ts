import { useEffect, useSyncExternalStore } from 'react';

import type { Track } from '../../core/types/track';
import { likedSongs } from '../../services/composition';

export interface UseLikedSongsResult {
  /** Liked tracks, newest-liked first. */
  readonly likedTracks: readonly Track[];
  /** Whether the given track is currently liked. */
  readonly isLiked: (track: Track) => boolean;
  /** Toggles liked state for a track (like ⇄ unlike). */
  readonly toggleLike: (track: Track) => void;
}

/**
 * Subscribes to the app-level liked songs (newest-liked first) and
 * triggers the one-time hydration from persistent storage.
 */
export function useLikedSongs(): UseLikedSongsResult {
  useEffect(() => {
    void likedSongs.hydrate();
  }, []);

  const likedTracks = useSyncExternalStore(
    likedSongs.subscribe,
    likedSongs.getSnapshot,
  );

  return {
    likedTracks,
    isLiked: (track: Track) => likedSongs.isLiked(track),
    toggleLike: (track: Track) => likedSongs.toggleLike(track),
  };
}