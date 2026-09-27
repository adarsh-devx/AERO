import type { Track } from '../../core/types/track';
import type { Lyrics } from '../../core/types/lyrics';
import {
  normalizeLyricsMatch,
  normalizeLyricsTitleLoose,
} from '../../core/types/lyrics';
import { parseLrc } from './lrc';
import type { LyricsProvider } from './types';

/**
 * Raw LRCLIB record shape (verified against the live API):
 * both https://lrclib.net/api/get and /api/search return this JSON.
 */
interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  /** Duration in SECONDS, when reported. */
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/**
 * LrclibLyricsProvider — lyrics from LRCLIB (https://lrclib.net), an open
 * lyrics database with a documented JSON API that needs NO API key and
 * NO quota (fitting Aero's keyless-by-design network layer). No scraping,
 * no stream extraction, no audio downloads.
 *
 * Lookup flow, entirely from track METADATA (never from stream URLs):
 *
 *  1. `GET /api/get?track_name&artist_name&duration` — LRCLIB's exact
 *     match endpoint; its response is re-validated by our own matcher
 *     before being trusted.
 *  2. `GET /api/search?track_name&artist_name` — candidates are filtered
 *     by the same matcher and ranked (album match, then closest duration).
 *
 * Confidence rules (spec §5 — wrong lyrics are worse than none):
 *  - Pass 1: exact match after conservative normalization of title and
 *    artist (artist compared per part, so "Rick Astley, Rick Astley"
 *    matches "Rick Astley" but "Queen Latifah" never matches "Queen"),
 *    with a ±5s duration window when both sides report a duration.
 *  - Pass 2 (only if pass 1 found nothing): bracketed segments are
 *    dropped from BOTH titles ("(Official Video)" etc.) and the window
 *    widens to ±10s to absorb live/remix versions' drift.
 *  - Album is used only as a RANKING signal (never as a hard filter —
 *    provider album names legitimately differ from track metadata).
 *  - No candidate passing both passes ⇒ `null` (reported as
 *    "No lyrics available", never as guessed lyrics).
 *
 * Failures (network, HTTP ≠ 404, malformed JSON) REJECT so the UI can
 * offer a retry; a 404 / no-match resolves `null`. Nothing here touches
 * playback, stream resolution, or NewPipe.
 */
export class LrclibLyricsProvider implements LyricsProvider {
  readonly id = 'lrclib';

  /** Keyless open API; override for self-hosted LRCLIB instances. */
  private readonly baseUrl: string;

  constructor(baseUrl = 'https://lrclib.net') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async getLyrics(track: Track): Promise<Lyrics | null> {
    const query = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist,
    });
    if (track.durationMs && track.durationMs > 0) {
      // LRCLIB measures duration in whole seconds.
      query.set('duration', String(Math.round(track.durationMs / 1000)));
    }

    const exact = await this.requestJson<LrclibRecord | null>(
      `${this.baseUrl}/api/get?${query.toString()}`,
      { allowNotFound: true },
    );
    if (exact) {
      const candidate = this.select(track, [exact], false);
      if (candidate) return this.toLyrics(candidate);
    }

    const searchQuery = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist,
    });
    const candidates = await this.requestJson<LrclibRecord[]>(
      `${this.baseUrl}/api/search?${searchQuery.toString()}`,
      { allowNotFound: false },
    );
    if (!Array.isArray(candidates)) {
      throw new Error('Lyrics provider returned an invalid search response.');
    }

    const strict = this.select(track, candidates, false);
    const loose = strict ?? this.select(track, candidates, true);
    return loose ? this.toLyrics(loose) : null;
  }

  // ── Matching ─────────────────────────────────────────────────────────

  /** Picks the best passing candidate: album match first, then closest duration. */
  private select(
    track: Track,
    records: readonly LrclibRecord[],
    looseTitles: boolean,
  ): LrclibRecord | null {
    const trackAlbum = track.album ? normalizeLyricsMatch(track.album) : null;
    const durationWindowMs = looseTitles ? 10_000 : 5_000;

    const passing = records.filter((record) =>
      this.matches(track, record, looseTitles, durationWindowMs),
    );
    if (passing.length === 0) return null;

    let best: LrclibRecord | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const record of passing) {
      let score = 0;
      if (trackAlbum && record.albumName && normalizeLyricsMatch(record.albumName) === trackAlbum) {
        score += 2;
      }
      if (track.durationMs && record.duration) {
        // Closer duration scores higher; bounded so ranking stays a tie-break.
        const delta = Math.abs(record.duration * 1000 - track.durationMs);
        score += Math.max(0, 1 - delta / (durationWindowMs * 2));
      }
      if (score > bestScore) {
        bestScore = score;
        best = record;
      }
    }
    return best;
  }

  private matches(
    track: Track,
    record: LrclibRecord,
    looseTitles: boolean,
    durationWindowMs: number,
  ): boolean {
    if (!record.trackName || !record.artistName) return false;

    const foldTitle = looseTitles ? normalizeLyricsTitleLoose : normalizeLyricsMatch;
    if (foldTitle(record.trackName) !== foldTitle(track.title)) return false;

    // Artist: exact match of the FULL normalized string, or of any single
    // part of the provider's artist list ("A, B" → ["a", "b"]). No
    // substring/containment matching — that is where wrong-song matches
    // come from.
    const trackArtist = normalizeLyricsMatch(track.artist);
    const candidateArtists = record.artistName
      .split(/[,;+/&]+/)
      .map((part) => normalizeLyricsMatch(part))
      .filter((part) => part.length > 0);
    if (normalizeLyricsMatch(record.artistName) !== trackArtist && !candidateArtists.includes(trackArtist)) {
      return false;
    }

    if (track.durationMs && track.durationMs > 0 && record.duration && record.duration > 0) {
      const deltaMs = Math.abs(record.duration * 1000 - track.durationMs);
      if (deltaMs > durationWindowMs) return false;
    }
    return true;
  }

  private toLyrics(record: LrclibRecord): Lyrics | null {
    if (record.instrumental === true) return null;

    const synced = record.syncedLyrics?.trim();
    if (synced) {
      const lines = parseLrc(synced);
      if (lines.length > 0) {
        return { type: 'synced', lines, providerId: this.id };
      }
      // Synced text that carries no parseable timestamps degrades to the
      // plain body (or is dropped) instead of being shown as broken sync.
    }

    const plain = record.plainLyrics?.trim();
    if (plain) {
      const lines = plain
        .split(/\r?\n/)
        .map((text) => ({ text: text.trim() }))
        .filter((line) => line.text.length > 0);
      if (lines.length > 0) {
        return { type: 'plain', lines, providerId: this.id };
      }
    }
    return null;
  }

  // ── Networking ───────────────────────────────────────────────────────

  /**
   * One GET with a hard timeout. `allowNotFound` maps HTTP 404 to `null`
   * (a legitimate "no exact match"); every other non-OK status and any
   * transport/parse failure rejects, so the caller can offer a retry.
   */
  private async requestJson<T>(
    url: string,
    options: { allowNotFound: boolean },
  ): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status === 404 && options.allowNotFound) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Lyrics provider failed: HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Lyrics request timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
