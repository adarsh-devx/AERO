import type { Track } from '../../core/types/track';

/**
 * Pure derivations over the device music library (MediaStore collection).
 *
 * The Library screen's Songs and Artists sections, plus the album grouping
 * still shared by the Album and Artist screens, all read ONE collection —
 * these helpers turn it into the grouped views without any
 * screen owning its own copy. Framework-free on purpose: no React, no
 * networking, no stores, so they stay trivially testable and memoizable.
 */

/** A group of library tracks sharing one (normalised) artist name. */
export interface LibraryArtist {
  /** Stable normalised identity — lowercased, whitespace-collapsed name. */
  readonly key: string;
  /** Display name: the spelling of the first track seen for this artist. */
  readonly name: string;
  readonly tracks: readonly Track[];
}

/** A group of library tracks belonging to one album. */
export interface LibraryAlbum {
  /**
   * Stable identity: the source's albumId when available (MediaStore
   * ALBUM_ID — two different albums can share a title, an id cannot),
   * otherwise a normalised title + artist key for sources without one.
   */
  readonly key: string;
  readonly title: string;
  /** Display artist: the first track's artist spelling for this album. */
  readonly artist: string;
  /** Representative track — used for artwork in the album grid. */
  readonly artworkTrack: Track;
  readonly tracks: readonly Track[];
}

/**
 * Normalises an artist name into a grouping key: Unicode NFC so composed
 * and decomposed spellings of the same name agree, trimmed, inner
 * whitespace collapsed, lowercased — so "Talwinder", " talwinder " and
 * "TALWINDER" land in one group instead of three.
 *
 * This is the ONE artist-normalisation in the app: grouping AND artist
 * membership both go through it.
 */
export function normalizeArtistKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Collaboration markers inside ONE artist field ("A feat. B"). Only the
 * segment before the FIRST marker can own a page — a featured artist must
 * not become primary just because a credit string mentions them.
 */
const FEAT_SEPARATOR = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;

/**
 * Conservative artist membership (Artist screen): a track belongs only
 * when its full normalised artist equals the requested name, or its
 * PRIMARY segment does. Case, whitespace and Unicode differences are
 * absorbed; nothing else is. "Queen" never matches "Queen Latifah",
 * a title-only hit by another artist is never claimed, and questionable
 * results are excluded by construction rather than ranked.
 */
export function trackMatchesArtist(track: Track, artistName: string): boolean {
  const target = normalizeArtistKey(artistName);
  if (target.length === 0) return false;
  const trackKey = normalizeArtistKey(track.artist);
  if (trackKey === target) return true;
  const primary = trackKey.split(FEAT_SEPARATOR)[0];
  return primary === target;
}

/**
 * Groups tracks by normalised artist, preserving first-seen order (which
 * for MediaStore means _ID order — the provider's own deterministic order).
 * Tracks with a blank artist cannot belong to any artist and are skipped
 * rather than filed under a fabricated name.
 */
export function groupTracksByArtist(tracks: readonly Track[]): LibraryArtist[] {
  const groups = new Map<string, { name: string; tracks: Track[] }>();

  for (const track of tracks) {
    const key = normalizeArtistKey(track.artist);
    if (key.length === 0) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.tracks.push(track);
    } else {
      groups.set(key, { name: track.artist.trim(), tracks: [track] });
    }
  }

  return Array.from(groups, ([key, group]) => ({
    key,
    name: group.name,
    tracks: group.tracks,
  }));
}

/**
 * Stable identity of the album a track belongs to — or null when the
 * track has no album metadata (an album identity is never invented for a
 * track that lacks one). THE album key of the app: the source's albumId
 * when available (MediaStore ALBUM_ID), otherwise a normalised
 * title + artist key. Shared by library grouping AND listening
 * statistics so both aggregate albums identically.
 */
export function albumIdentityKey(track: Track): string | null {
  const title = track.album?.trim();
  if (!title) return null;
  return track.albumId
    ? `id:${track.albumId}`
    : `title:${normalizeArtistKey(title)}|artist:${normalizeArtistKey(track.artist)}`;
}

/**
 * Groups tracks by album, preserving first-seen order. Tracks without album
 * metadata are skipped — the display title is never invented. Identity
 * prefers the source's stable albumId and falls back to a normalised
 * title + artist key only when the source has none.
 */
export function groupTracksByAlbum(tracks: readonly Track[]): LibraryAlbum[] {
  const groups = new Map<string, { title: string; artist: string; artworkTrack: Track; tracks: Track[] }>();

  for (const track of tracks) {
    const title = track.album?.trim();
    if (!title) continue;

    const key = albumIdentityKey(track);
    if (key === null) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.tracks.push(track);
    } else {
      groups.set(key, {
        title,
        artist: track.artist.trim(),
        artworkTrack: track,
        tracks: [track],
      });
    }
  }

  return Array.from(groups, ([key, group]) => ({ key, ...group }));
}