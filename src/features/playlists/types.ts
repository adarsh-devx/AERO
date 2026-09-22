import type { Track } from '../../core/types/track';
import { isTrack } from '../../core/types/track';

/**
 * A user-created playlist. The id — never the name — is the identity,
 * because names are editable. Tracks reuse the existing provider-neutral
 * Track type; local and online tracks are distinguished by Track.origin.
 */
export interface Playlist {
  /** Stable unique id, assigned at creation and never changed. */
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

/** Structural check for Playlist entries read back from storage. */
export function isPlaylist(value: unknown): value is Playlist {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<'id' | 'name' | 'tracks', unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.tracks) &&
    candidate.tracks.every((entry) => isTrack(entry))
  );
}

