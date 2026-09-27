/**
 * Lyrics domain types — provider-independent plain data, exactly like
 * Track: the UI and the lyrics service speak only these types, never a
 * provider's response shape.
 *
 * Lyrics are deliberately NOT part of the playback pipeline: they are
 * looked up purely from track METADATA (title/artist/album/duration) by
 * LyricsService → LyricsProvider, never from stream URLs, NewPipe, or
 * any audio resolution. Playback and lyrics are independent concerns.
 */

/** Whether line timings are present and meaningful. */
export type LyricsType = 'synced' | 'plain';

export interface LyricsLine {
  text: string;
  /** Start of the line in milliseconds; absent for plain lyrics. */
  startMs?: number;
  /** End of the line (derived from the next line's start when known). */
  endMs?: number;
}

export interface Lyrics {
  type: LyricsType;
  lines: LyricsLine[];
  /** Identifier of the provider that produced this result ('lrclib', ...). */
  providerId: string;
}

/**
 * Conservative normalization used for MATCHING track metadata against
 * provider candidates: NFKC-fold, lowercase, join apostrophes into the
 * word ("don't" == "dont"), turn remaining punctuation/symbols into
 * single spaces, collapse whitespace. Deliberately NOT fuzzy — a
 * candidate must still match exactly after this fold to be trusted.
 */
export function normalizeLyricsMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’ʼ\u2018\u2019\u02bc]/g, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Title fold used only in the SECOND matching pass: bracketed segments
 * ("(Official Video)", "[Live]") are dropped on BOTH sides before the
 * normal fold, so a clean title still matches a decorated one. Applied
 * strictly after exact matching failed, never instead of it.
 */
export function normalizeLyricsTitleLoose(title: string): string {
  return normalizeLyricsMatch(title.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' '));
}

/**
 * Index of the line active at `positionMs` for synced lyrics: the LAST
 * line whose start has passed (-1 before the first line). Pure function
 * over the existing playback position — no timers of its own.
 */
export function activeLyricsLineIndex(
  lines: readonly LyricsLine[],
  positionMs: number,
): number {
  let active = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const start = lines[i].startMs;
    if (start === undefined || start > positionMs) break;
    active = i;
  }
  return active;
}
