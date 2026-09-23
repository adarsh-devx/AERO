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
 * Concrete OnlineMusicProvider implementation with Multi-Tier Zero-Key Search:
 *
 * Tier 1: Direct YouTube InnerTube Web API (100% free, unlimited, zero API key required)
 * Tier 2: Piped Multi-Instance Public Music Search API (Fallback)
 * Tier 3: YouTube Data API v3 (Optional, if apiKey is provided)
 */
export class YouTubeMusicProvider implements OnlineMusicProvider {
  readonly id = 'online' as const;

  constructor(
    private readonly apiKey?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

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

    // 2. Try Piped Multi-Instance Public Search API Fallback
    try {
      const pipedTracks = await this.searchPiped(needle);
      if (pipedTracks.length > 0) {
        return pipedTracks;
      }
    } catch (err) {
      console.warn('[YouTubeMusicProvider] Piped search failed, trying Data API:', err);
    }

    // 3. Try YouTube Data API v3 if key exists
    if (this.apiKey) {
      try {
        return await this.searchDataApi(needle);
      } catch (err) {
        console.error('[YouTubeMusicProvider] Data API search failed:', err);
      }
    }

    return [];
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

      tracks.push({
        id: videoId,
        title: decodeHtmlEntities(title),
        artist: decodeHtmlEntities(artist),
        artworkUri: artworkUri.startsWith('//') ? `https:${artworkUri}` : artworkUri,
        origin: 'online',
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

          tracks.push({
            id: videoId,
            title: decodeHtmlEntities(item.title ?? 'Unknown Title'),
            artist: decodeHtmlEntities(item.uploaderName ?? item.artist ?? 'Unknown Artist'),
            artworkUri: item.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            origin: 'online',
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

  /**
   * Tier 3: YouTube Data API v3 (Used only if key is configured).
   */
  private async searchDataApi(query: string): Promise<Track[]> {
    if (!this.apiKey) return [];

    const endpoint = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=20&q=${encodeURIComponent(
      query,
    )}&key=${encodeURIComponent(this.apiKey)}`;

    const response = await this.fetchFn(endpoint);
    if (!response.ok) {
      throw new Error(`Data API HTTP ${response.status}`);
    }

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const tracks: Track[] = [];
    const seenIds = new Set<string>();

    for (const item of items) {
      const videoId = item.id?.videoId;
      if (item.id?.kind === 'youtube#video' && videoId && !seenIds.has(videoId)) {
        seenIds.add(videoId);
        const snippet = item.snippet;
        const rawTitle = snippet?.title ?? 'Unknown Title';
        const rawArtist = snippet?.channelTitle ?? 'Unknown Artist';
        const artworkUri =
          snippet?.thumbnails?.high?.url ??
          snippet?.thumbnails?.medium?.url ??
          snippet?.thumbnails?.default?.url;

        tracks.push({
          id: videoId,
          title: decodeHtmlEntities(rawTitle),
          artist: decodeHtmlEntities(rawArtist),
          artworkUri: artworkUri || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          origin: 'online',
        });
      }
    }

    return tracks;
  }
}
