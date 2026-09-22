/**
 * Where a track originates. Kept as plain data (not a class, not a
 * provider reference) so a Track can cross feature boundaries without
 * dragging provider implementations with it.
 *
 * The playback pipeline must stay neutral to this value: online and
 * local tracks converge on the same StreamProvider → ResolvedStream →
 * PlaybackEngine path.
 */
export type TrackOrigin = 'local' | 'online';

/**
 * Provider-independent domain type for a playable music track.
 *
 * Minimal by design: only fields the product currently requires.
 * Optional fields cover both online and local tracks without forcing
 * either source to populate values it does not have. No
 * provider-specific fields (video IDs, provider URLs, etc.) belong
 * here — those stay inside provider implementations.
 */
export interface Track {
  /** Stable unique identifier within the source provider. */
  id: string;
  title: string;
  artist: string;

  /** Which kind of source this track came from, when known. */
  origin?: TrackOrigin;
  /** Album name, when the source provides one. */
  album?: string;
  /** Artwork URI, when the source provides one. */
  artworkUri?: string;
  /** Duration in milliseconds, when the source provides one. */
  durationMs?: number;
}

/**
 * Stable identity of a track for de-duplication across features
 * (playback history, liked songs). Ids are only unique within a
 * provider, so the origin is part of the key (a local MediaStore id
 * and an online video id could otherwise collide).
 */
export function trackIdentityKey(track: Track): string {
  return `${track.origin ?? 'unknown'}:${track.id}`;
}

/** Structural check for Track entries read back from storage. */
export function isTrack(value: unknown): value is Track {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<'id' | 'title' | 'artist', unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.artist === 'string'
  );
}

/**
 * Universal resolver for track artwork URI.
 * If track has artworkUri, returns it.
 * If track has origin 'online' or has an 11-char YouTube ID, derives the high-res YouTube thumbnail URL.
 */
export function getTrackArtworkUri(track?: Track | null): string | undefined {
  if (!track) return undefined;
  if (track.artworkUri && typeof track.artworkUri === 'string' && track.artworkUri.trim().length > 0) {
    return track.artworkUri.trim();
  }
  // Check if track is online or has YouTube video ID format
  const rawId = track.id ? track.id.replace(/^(online:|local:|yt:)/, '') : '';
  if (track.origin === 'online' || (rawId.length === 11 && !rawId.includes('/'))) {
    return `https://i.ytimg.com/vi/${rawId}/hqdefault.jpg`;
  }
  return undefined;
}


