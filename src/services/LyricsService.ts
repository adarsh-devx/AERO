import type { Track } from '../core/types/track';
import type { Lyrics } from '../core/types/lyrics';
import { normalizeLyricsMatch } from '../core/types/lyrics';
import type { LyricsProvider } from '../providers/lyrics/types';

export interface LyricsServiceDependencies {
  /** Lyrics backend behind the provider boundary. */
  readonly provider: LyricsProvider;
}

/** How long a "no lyrics found" answer is remembered (failures are never cached). */
const NEGATIVE_TTL_MS = 5 * 60_000;

/**
 * LyricsService: the single entry point the UI uses for lyrics.
 *
 * - Cache key is METADATA (normalized title + artist), so local,
 *   downloaded and online entries of the same song share one entry and
 *   A → B → A never refetches A. Positives live for the session;
 *   "not found" is cached briefly (spec §10) — network/provider
 *   failures are never cached, so retry always re-attempts.
 * - In-flight requests are de-duplicated per key: reopening a track
 *   while its first request is still running attaches to it instead of
 *   firing a second one.
 * - Independent of playback by construction: no stream resolution, no
 *   engine, no queue involvement; a lyrics failure can never affect
 *   what is playing (spec §2/§13).
 *
 * Stale-response protection is a UI concern (the sheet owns the
 * request-generation counter, mirroring Search/PlayerController) — this
 * service only guarantees per-key consistency and reuse.
 */
export class LyricsService {
  private readonly provider: LyricsProvider;
  private readonly positives = new Map<string, Lyrics>();
  private readonly negatives = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<Lyrics | null>>();

  constructor(dependencies: LyricsServiceDependencies) {
    this.provider = dependencies.provider;
  }

  /**
   * Lyrics for a track from metadata alone.
   * Resolves `null` when none can be found/trusted; rejects on
   * network/provider failure (never cached, so Retry works).
   */
  async getLyrics(track: Track): Promise<Lyrics | null> {
    const key = this.cacheKey(track);

    const cached = this.positives.get(key);
    if (cached) return cached;

    const negativeUntil = this.negatives.get(key);
    if (negativeUntil !== undefined && Date.now() < negativeUntil) {
      return null;
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const request = this.provider.getLyrics(track).then(
      (lyrics) => {
        this.inflight.delete(key);
        if (lyrics) {
          this.positives.set(key, lyrics);
          this.negatives.delete(key);
        } else {
          this.negatives.set(key, Date.now() + NEGATIVE_TTL_MS);
        }
        return lyrics;
      },
      (error) => {
        // Failures stay uncached: the next call (or Retry) is a real attempt.
        this.inflight.delete(key);
        throw error;
      },
    );
    this.inflight.set(key, request);
    return request;
  }

  /** Metadata identity of the lookup, not provider identity (spec §12). */
  private cacheKey(track: Track): string {
    return `${normalizeLyricsMatch(track.title)}|${normalizeLyricsMatch(track.artist)}`;
  }
}
