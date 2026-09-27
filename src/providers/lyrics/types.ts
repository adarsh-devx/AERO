import type { Track } from '../../core/types/track';
import type { Lyrics } from '../../core/types/lyrics';

/**
 * Provider boundary for lyrics lookup.
 *
 * Implementations receive the full Track (title, artist, album,
 * durationMs — the metadata a lyrics search actually needs; a YouTube
 * video id alone is never sufficient) and return structured Lyrics or
 * null when no trustworthy match exists.
 *
 * Contract:
 * - Resolve `null` for "no lyrics found" / "not confident enough" —
 *   a legitimate answer, not an error.
 * - REJECT only for genuine failures (network, provider HTTP error,
 *   malformed response) so callers can offer a retry.
 * - Never resolve partial or guessed lyrics: an incorrect match is
 *   worse than no match.
 */
export interface LyricsProvider {
  readonly id: string;
  getLyrics(track: Track): Promise<Lyrics | null>;
}
