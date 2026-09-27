import type { Track } from '../../../core/types/track';
import type { OnlineMusicProvider } from './types';

/**
 * Decodes basic HTML entities commonly returned by search APIs.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Recursively extracts all videoRenderer / compactVideoRenderer objects from YouTube InnerTube JSON tree.
 */
function extractVideoRenderers(node: any, results: any[] = []): any[] {
  if (!node || typeof node !== 'object') return results;

  const vr = node.videoRenderer || node.compactVideoRenderer;
  if (vr && typeof vr.videoId === 'string') {
    results.push(vr);
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      extractVideoRenderers(item, results);
    }
  } else {
    for (const key of Object.keys(node)) {
      if (key !== 'videoRenderer' && key !== 'compactVideoRenderer') {
        extractVideoRenderers(node[key], results);
      }
    }
  }

  return results;
}

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.privacy.com.de',
  'https://pipedapi.tokhmi.xyz',
  'https://piped-api.lunar.icu',
];

/**
 * How long a suggestion set is reused before the RPC is asked again.
 * Suggestions are metadata, they are requested on nearly every pause in typing,
 * and a stale-but-plausible list costs the user nothing. In-memory only.
 */
const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;

/** Bounded so a long typing session cannot grow the cache without limit. */
const SUGGESTION_CACHE_LIMIT = 50;

/** The only accepted shape of a provider video id (direct id lookup). */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Suggestion rows the UI is given at most, in the order InnerTube returned them. */
const SUGGESTION_LIMIT = 10;

/** Flattens InnerTube's `runs` text structure (`[{ text }]`) into a string. */
function runsText(value: any): string {
  const runs = value?.runs;
  if (!Array.isArray(runs)) return '';
  return runs
    .map((run: any) => (typeof run?.text === 'string' ? run.text : ''))
    .join('')
    .trim();
}

/**
 * Parses a duration clock the provider ALREADY returned in this response
 * ("3:45", "1:02:03") into milliseconds. Pure text→number mapping of
 * supplied data — no extra request, no guessing. Returns null for anything
 * that is not a 2–3 segment clock, so an absent/odd value simply leaves
 * `durationMs` unset instead of becoming a fabricated length.
 */
function parseClockDurationMs(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const segments = text.trim().split(':');
  if (segments.length < 2 || segments.length > 3) return null;
  let totalSeconds = 0;
  for (const segment of segments) {
    if (!/^\d{1,5}$/.test(segment)) return null;
    totalSeconds = totalSeconds * 60 + Number(segment);
  }
  return totalSeconds > 0 ? totalSeconds * 1000 : null;
}

/**
 * The suggestion as the YouTube Music client renders it, with the canonical
 * query it would send as a fallback.
 */
function suggestionText(renderer: any): string {
  const displayed = runsText(renderer?.suggestion);
  if (displayed) return displayed;
  const canonical = renderer?.navigationEndpoint?.searchEndpoint?.query;
  return typeof canonical === 'string' ? canonical.trim() : '';
}

/**
 * The YouTube Music web client names itself `1.<yyyyMMdd>.01.00` and rebuilds
 * that version string daily, so it is derived here instead of pinned to a date
 * that would silently age out.
 */
function webRemixClientVersion(): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`;
  return `1.${stamp}.01.00`;
}

/**
 * Concrete OnlineMusicProvider implementation.
 *
 * Search and suggestions are BOTH served by YouTube's own InnerTube JSON API,
 * keyless, with no Google Cloud project and no quota:
 *
 * Tier 1: InnerTube `youtubei/v1/search` (WEB client) — primary search path.
 * Tier 2: Piped multi-instance public mirror — fallback for search only, used
 *         when InnerTube itself is unreachable.
 *
 * Discovery stops here: this provider only ever produces Tracks and query
 * strings. Turning a Track into audio is the stream resolver's job, and the
 * stream resolver uses the native NewPipe extractor (see
 * `providers/stream/sources/NativeStreamSource.ts`) — no InnerTube stream
 * extraction happens in this file.
 *
 * The YouTube Data API is deliberately NOT used: its only advantage was
 * official metadata, at the cost of a required API key, per-project quota and
 * Google API terms, while InnerTube (the client API the YouTube/YouTube Music
 * web players themselves use) covers the same discovery need keylessly.
 */
export class YouTubeMusicProvider implements OnlineMusicProvider {
  readonly id = 'online' as const;

  private readonly fetchFn: typeof fetch;

  /**
   * Resolved suggestion sets, keyed by lower-cased trimmed query. Bounded by
   * insertion order and expiring, so a stale list can never be served forever.
   */
  private readonly suggestionCache = new Map<string, { items: readonly string[]; expiresAt: number }>();

  /** In-flight suggestion requests, keyed the same way (no duplicate RPCs). */
  private readonly suggestionInflight = new Map<string, Promise<string[]>>();

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  async search(query: string): Promise<Track[]> {
    const needle = query.trim();
    if (!needle) {
      return [];
    }

    // 1. Try Zero-Key Direct YouTube InnerTube Search First (Fastest & 100% Unlimited)
    try {
      const innerTubeTracks = await this.searchInnerTube(needle);
      if (innerTubeTracks.length > 0) {
        return innerTubeTracks;
      }
    } catch (err) {
      console.warn('[YouTubeMusicProvider] InnerTube search failed, trying fallback:', err);
    }

    // 2. Piped Multi-Instance Public Search API Fallback
    try {
      const pipedTracks = await this.searchPiped(needle);
      if (pipedTracks.length > 0) {
        return pipedTracks;
      }
    } catch (err) {
      console.warn('[YouTubeMusicProvider] Piped search failed:', err);
    }

    return [];
  }

  /**
   * Search-bar suggestions from the YouTube Music InnerTube RPC
   * (`music/get_search_suggestions`) — the exact endpoint and client the
   * YouTube Music web search bar talks to. Keyless, like search.
   *
   * Cached and de-duplicated: typing costs one RPC per distinct query, and a
   * repeat of a recent query is answered from memory. Never resolves with
   * "empty" for a real query; it rejects instead, so the caller can tell a
   * transient failure from a genuinely suggestion-less query.
   */
  async suggestions(query: string): Promise<string[]> {
    const needle = query.trim();
    if (!needle) return [];

    const key = needle.toLowerCase();
    const cached = this.suggestionCache.get(key);
    if (cached) {
      if (cached.expiresAt > Date.now()) return [...cached.items];
      this.suggestionCache.delete(key);
    }

    const inflight = this.suggestionInflight.get(key);
    if (inflight) return inflight;

    const request = this.fetchSuggestions(needle)
      .then((items) => {
        this.cacheSuggestions(key, items);
        return items;
      })
      .finally(() => {
        this.suggestionInflight.delete(key);
      });

    this.suggestionInflight.set(key, request);
    return request;
  }

  /**
   * Direct id → Track resolution for shared links (MusicProvider.getTrack).
   *
   * Two conservative tiers, both on the EXISTING provider infrastructure —
   * no new HTTP client, no page/HTML scraping, no auth, no stream extraction:
   *
   *  Tier 1: InnerTube `youtubei/v1/player`, the same keyless client API the
   *          web player uses, asked for exactly this video's metadata
   *          (title/author/thumbnail). The response is accepted only when it
   *          echoes THIS video id — identity is never assumed.
   *  Tier 2: the provider's own search() with the id as query, accepting ONLY
   *          a result whose id equals the requested one. An unrelated search
   *          hit is never returned; if no exact match exists, the answer is
   *          "not found".
   *
   * Resolves null when the id is well-formed but cannot be identified
   * (unreachable identification in both tiers with no error, or no exact
   * match); rejects only when both tiers failed on provider/network errors,
   * so callers can distinguish "couldn't find" from "couldn't load".
   */
  async getTrack(id: string): Promise<Track | null> {
    if (!VIDEO_ID_PATTERN.test(id)) return null;

    let lastError: unknown = null;
    try {
      const track = await this.fetchTrackByPlayer(id);
      if (track !== null) return track;
    } catch (err) {
      lastError = err;
    }

    // Conservative fallback: exact-id match inside this provider's search.
    try {
      const results = await this.search(id);
      const match = results.find((track) => track.id === id);
      if (match) return match;
    } catch (err) {
      lastError = err;
    }

    if (lastError !== null) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    return null;
  }

  /**
   * Tier 1: InnerTube `youtubei/v1/player` metadata for ONE video. Keyless
   * and metadata-only — it returns facts about the video (title, author,
   * thumbnail, duration), never a stream URL; audio still comes from the
   * NewPipe-based resolver when the user actually plays the track.
   */
  private async fetchTrackByPlayer(videoId: string): Promise<Track | null> {
    const endpoint = 'https://www.youtube.com/youtubei/v1/player';
    const payload = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.01.00',
          hl: 'en',
          gl: 'IN',
        },
      },
      videoId,
    };

    const response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`InnerTube player HTTP ${response.status}`);
    }

    const data = await response.json();
    const details = data?.videoDetails;
    if (!details || typeof details !== 'object') return null;
    // Identity check: a response about ANY other video identifies nothing.
    if (details.videoId !== videoId) return null;

    const title = typeof details.title === 'string' ? decodeHtmlEntities(details.title).trim() : '';
    const artist = typeof details.author === 'string' ? decodeHtmlEntities(details.author).trim() : '';
    if (!title || !artist) return null;

    const thumbs = details.thumbnail?.thumbnails;
    const artworkUri =
      Array.isArray(thumbs) && thumbs.length > 0 && typeof thumbs[thumbs.length - 1]?.url === 'string'
        ? thumbs[thumbs.length - 1].url
        : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const lengthSeconds = Number(details.lengthSeconds);

    return {
      id: videoId,
      title,
      artist,
      artworkUri: artworkUri.startsWith('//') ? `https:${artworkUri}` : artworkUri,
      origin: 'online',
      ...(Number.isFinite(lengthSeconds) && lengthSeconds > 0
        ? { durationMs: Math.round(lengthSeconds * 1000) }
        : {}),
    };
  }

  private cacheSuggestions(key: string, items: readonly string[]): void {
    this.suggestionCache.set(key, { items, expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS });
    while (this.suggestionCache.size > SUGGESTION_CACHE_LIMIT) {
      const oldest = this.suggestionCache.keys().next();
      if (oldest.done) break;
      this.suggestionCache.delete(oldest.value);
    }
  }

  /**
   * The InnerTube suggestion RPC itself.
   *
   * Request: POST `music/get_search_suggestions` on the YouTube Music host with
   * a WEB_REMIX client context and the user's text in `input`.
   *
   * Response: suggestion sets live under
   * `contents[].searchSuggestionsSectionRenderer.contents[]`, one entry per
   * suggestion, as either
   *   - `searchSuggestionRenderer` — a catalogue suggestion (what is wanted
   *     here), whose text is `suggestion.runs[].text` (the suggestion as
   *     rendered) or `navigationEndpoint.searchEndpoint.query` (the canonical
   *     query), or
   *   - `historySuggestionRenderer` — the signed-in user's own YouTube history,
   *     which Aero is not signed in for; ignored.
   */
  private async fetchSuggestions(query: string): Promise<string[]> {
    const endpoint = 'https://music.youtube.com/youtubei/v1/music/get_search_suggestions?alt=json';
    const payload = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: webRemixClientVersion(),
          hl: 'en',
          gl: 'IN',
        },
        user: {},
      },
      input: query,
    };

    const response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`InnerTube suggestions HTTP ${response.status}`);
    }

    const data = await response.json();
    const sections = Array.isArray(data?.contents) ? data.contents : [];
    const suggestions: string[] = [];
    const seen = new Set<string>();

    for (const section of sections) {
      const entries = section?.searchSuggestionsSectionRenderer?.contents;
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        const renderer = entry?.searchSuggestionRenderer;
        if (!renderer) continue;

        const text = suggestionText(renderer);
        const key = text.toLowerCase();
        if (!text || seen.has(key)) continue;
        seen.add(key);
        suggestions.push(text);
        if (suggestions.length >= SUGGESTION_LIMIT) return suggestions;
      }
    }

    return suggestions;
  }

  /**
   * Tier 1: YouTube InnerTube Web Search API (Zero API key required).
   */
  private async searchInnerTube(query: string): Promise<Track[]> {
    const endpoint = 'https://www.youtube.com/youtubei/v1/search';
    const payload = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.01.00',
          hl: 'en',
          gl: 'IN',
        },
      },
      query,
      params: 'Eg-KAQwIABAAGAAgACgB', // Filter for video results
    };

    const response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`InnerTube HTTP ${response.status}`);
    }

    const data = await response.json();
    const renderers = extractVideoRenderers(data);
    const tracks: Track[] = [];
    const seenIds = new Set<string>();

    for (const v of renderers) {
      const videoId = v.videoId;
      if (!videoId || seenIds.has(videoId)) continue;
      seenIds.add(videoId);

      const title =
        v.title?.runs?.map((r: any) => r.text).join('') ||
        v.title?.simpleText ||
        'Unknown Title';

      const artist =
        v.ownerText?.runs?.map((r: any) => r.text).join('') ||
        v.shortBylineText?.runs?.map((r: any) => r.text).join('') ||
        v.longBylineText?.runs?.map((r: any) => r.text).join('') ||
        'Unknown Artist';

      const thumbs = v.thumbnail?.thumbnails;
      const artworkUri = Array.isArray(thumbs) && thumbs.length > 0
        ? thumbs[thumbs.length - 1].url
        : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // Real duration already present in THIS search response
      // (lengthText.simpleText). Absent/malformed → field omitted.
      const durationMs = parseClockDurationMs(v.lengthText?.simpleText);

      tracks.push({
        id: videoId,
        title: decodeHtmlEntities(title),
        artist: decodeHtmlEntities(artist),
        artworkUri: artworkUri.startsWith('//') ? `https:${artworkUri}` : artworkUri,
        origin: 'online',
        ...(durationMs !== null ? { durationMs } : {}),
      });
    }

    return tracks;
  }

  /**
   * Tier 2: Piped Multi-Instance Music Search API Fallback (Zero API key required).
   */
  private async searchPiped(query: string): Promise<Track[]> {
    for (const base of PIPED_INSTANCES) {
      try {
        const endpoint = `${base}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
        const response = await this.fetchFn(endpoint, {
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) continue;

        const data = await response.json();
        const items = data?.items ?? (Array.isArray(data) ? data : []);
        const tracks: Track[] = [];
        const seenIds = new Set<string>();

        for (const item of items) {
          const rawUrl: string = item.url ?? '';
          const videoId = rawUrl.replace('/watch?v=', '').trim();
          if (!videoId || seenIds.has(videoId)) continue;
          seenIds.add(videoId);

          // Duration in seconds already present in this search response
          // (-1/absent/malformed → field omitted, never a fabricated length).
          const durationSeconds = Number(item.duration);
          const durationMs =
            Number.isFinite(durationSeconds) && durationSeconds > 0
              ? Math.round(durationSeconds * 1000)
              : null;

          tracks.push({
            id: videoId,
            title: decodeHtmlEntities(item.title ?? 'Unknown Title'),
            artist: decodeHtmlEntities(item.uploaderName ?? item.artist ?? 'Unknown Artist'),
            artworkUri: item.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            origin: 'online',
            ...(durationMs !== null ? { durationMs } : {}),
          });
        }

        if (tracks.length > 0) {
          return tracks;
        }
      } catch {
        // Try next Piped instance
      }
    }

    return [];
  }
}
