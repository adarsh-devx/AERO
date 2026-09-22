import type { Track } from '../../../core/types/track';
import type { OnlineMusicProvider } from './types';

/**
 * Decodes basic HTML entities commonly returned by the YouTube Data API.
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

interface YouTubeSearchItem {
  id?: {
    kind?: string;
    videoId?: string;
  };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[];
  error?: {
    code?: number;
    message?: string;
  };
}

/**
 * Concrete OnlineMusicProvider implementation using YouTube Data API v3
 * for metadata discovery and search only.
 *
 * Metadata-only discovery:
 * - Does NOT perform audio stream extraction.
 * - Does NOT create playable audio streams.
 * - Maps videoId directly as the unique track ID.
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

    if (!this.apiKey) {
      throw new Error(
        'YouTube API key is not configured. Provide a valid YouTube Data API v3 key to enable online search.',
      );
    }

    const endpoint =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=20&q=${encodeURIComponent(
        needle,
      )}&key=${encodeURIComponent(this.apiKey)}`;

    const response = await this.fetchFn(endpoint);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorBody = (await response.json()) as YouTubeSearchResponse;
        if (errorBody?.error?.message) {
          errorMessage = errorBody.error.message;
        }
      } catch {
        // Fall back to HTTP status message if body is not JSON
      }
      throw new Error(`YouTube search failed: ${errorMessage}`);
    }

    const data = (await response.json()) as YouTubeSearchResponse;
    const items = Array.isArray(data.items) ? data.items : [];

    const tracks: Track[] = [];

    for (const item of items) {
      const videoId = item.id?.videoId;
      if (item.id?.kind === 'youtube#video' && videoId) {
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

