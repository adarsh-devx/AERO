import type { Track } from '../../core/types/track';
import { playlists, likedSongs, musicService } from '../../services/composition';
import { youtubeAuthStore, type YouTubeUserProfile } from './YouTubeAuthStore';

export interface YouTubePlaylistSummary {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly trackCount?: number;
  readonly thumbnailUrl?: string;
  readonly isLikedMusic?: boolean;
}

export interface YouTubeMixCard {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly thumbnailUrl?: string;
  readonly videoId?: string;
  readonly seedArtist?: string;
}

// YouTube Music InnerTube client for personalized home feed & mix playback
const YTM_INNERTUBE_CLIENT = {
  clientName: 'WEB_REMIX',
  clientVersion: '1.20240101.01.00',
  hl: 'en',
  gl: 'IN',
};

export class YouTubeAccountService {
  /**
   * Fetches the connected user's profile information.
   */
  async fetchUserProfile(): Promise<YouTubeUserProfile | null> {
    const authState = youtubeAuthStore.getSnapshot();
    if (!authState.isConnected) return null;

    if (authState.accessToken) {
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${authState.accessToken}` },
        });
        const data = await res.json();
        const profile: YouTubeUserProfile = {
          name: data.name || 'YouTube User',
          email: data.email,
          avatarUrl: data.picture,
        };
        await youtubeAuthStore.updateProfile(profile);
        return profile;
      } catch (err) {
        console.warn('[YouTubeAccountService] OAuth userinfo fetch failed:', err);
      }
    }

    return null;
  }

  /**
   * Fetches all user playlists from the connected YouTube account with multi-channel discovery.
   */
  async fetchUserPlaylists(): Promise<readonly YouTubePlaylistSummary[]> {
    const authState = youtubeAuthStore.getSnapshot();
    if (!authState.isConnected) return [];

    try {
      youtubeAuthStore.setSyncing(true);
      const items: YouTubePlaylistSummary[] = [];

      // Refresh token if expired before making API calls
      const freshToken = await youtubeAuthStore.ensureFreshAccessToken();

      // 1. Google YouTube Data API v3 for created/owned playlists
      if (freshToken) {
        try {
          const res = await fetch(
            'https://www.googleapis.com/youtube/v3/playlists?mine=true&part=snippet,contentDetails&maxResults=50',
            {
              headers: { Authorization: `Bearer ${freshToken}` },
            },
          );

          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.items)) {
              for (const item of data.items) {
                // Exclude auto liked music/videos
                if (item.id === 'LM' || item.id === 'LL') continue;

                const snippet = item.snippet || {};
                const contentDetails = item.contentDetails || {};
                const thumbs = snippet.thumbnails || {};
                const thumbUrl =
                  thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url;

                items.push({
                  id: item.id,
                  title: snippet.title || 'Untitled Playlist',
                  subtitle: `${contentDetails.itemCount || 0} tracks`,
                  trackCount: contentDetails.itemCount || 0,
                  thumbnailUrl: thumbUrl,
                });
              }
            }
          } else {
            console.warn('[YouTubeAccountService] Playlists API error:', res.status);
          }
        } catch (oauthErr) {
          console.warn('[YouTubeAccountService] OAuth playlists fetch failed:', oauthErr);
        }

        // 2. Discover channel ID & channel playlists
        try {
          const chRes = await fetch(
            'https://www.googleapis.com/youtube/v3/channels?mine=true&part=contentDetails,snippet,id',
            {
              headers: { Authorization: `Bearer ${freshToken}` },
            },
          );
          if (chRes.ok) {
            const chData = await chRes.json();
            const channelId = chData.items?.[0]?.id;

            if (channelId) {
              const chPlRes = await fetch(
                `https://www.googleapis.com/youtube/v3/playlists?channelId=${encodeURIComponent(channelId)}&part=snippet,contentDetails&maxResults=50`,
                {
                  headers: { Authorization: `Bearer ${freshToken}` },
                },
              );
              if (chPlRes.ok) {
                const chPlData = await chPlRes.json();
                if (Array.isArray(chPlData.items)) {
                  for (const item of chPlData.items) {
                    if (item.id === 'LM' || item.id === 'LL') continue;

                    const snippet = item.snippet || {};
                    const contentDetails = item.contentDetails || {};
                    const thumbs = snippet.thumbnails || {};
                    const thumbUrl =
                      thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url;

                    items.push({
                      id: item.id,
                      title: snippet.title || 'Channel Playlist',
                      subtitle: `${contentDetails.itemCount || 0} tracks`,
                      trackCount: contentDetails.itemCount || 0,
                      thumbnailUrl: thumbUrl,
                    });
                  }
                }
              }
            }
          }
        } catch {
          // Ignore channel fetch error
        }
      }

      // Deduplicate by playlist id
      const seen = new Set<string>();
      const result = items.filter((pl) => {
        if (seen.has(pl.id)) return false;
        seen.add(pl.id);
        return true;
      });
      console.log('[YouTubeAccountService] Playlists found:', result.length);
      return result;
    } catch (error) {
      console.warn('[YouTubeAccountService] Failed to fetch playlists:', error);
      return [];
    } finally {
      youtubeAuthStore.setSyncing(false);
    }
  }

  /**
   * Fetches all tracks inside a specific YouTube playlist with strict Music-Only filtering.
   */
  async fetchPlaylistTracks(playlistId: string): Promise<readonly Track[]> {
    // Refresh token if expired before making API calls
    const freshToken = await youtubeAuthStore.ensureFreshAccessToken();

    // Handle real YouTube Music mix/radio playlists (RD*, OLAK*, VL* prefixes)
    const isYTMusicPlaylist =
      playlistId.startsWith('RD') ||
      playlistId.startsWith('OLAK') ||
      playlistId.startsWith('VL');

    if (isYTMusicPlaylist) {
      try {
        const authHeaders = freshToken
          ? { Authorization: `Bearer ${freshToken}` }
          : youtubeAuthStore.getAuthHeaders();

        // Use InnerTube next endpoint to get the playlist's watch queue
        const nextRes = await fetch(
          'https://music.youtube.com/youtubei/v1/next?prettyPrint=false',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Referer: 'https://music.youtube.com/',
              Origin: 'https://music.youtube.com',
              ...authHeaders,
            },
            body: JSON.stringify({
              playlistId,
              isAudioOnly: true,
              context: {
                client: YTM_INNERTUBE_CLIENT,
              },
            }),
          },
        );

        if (nextRes.ok) {
          const nextData = await nextRes.json();
          const tracks = this.parseTracksFromNext(nextData);
          if (tracks.length > 0) return tracks;
        }
      } catch (err) {
        console.warn('[YouTubeAccountService] InnerTube next fetch error:', err);
      }

      // Fallback: try browse endpoint for VL/OLAK playlists
      if (playlistId.startsWith('VL') || playlistId.startsWith('OLAK')) {
        try {
          const browseId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`;
          const authHeaders = freshToken
            ? { Authorization: `Bearer ${freshToken}` }
            : youtubeAuthStore.getAuthHeaders();

          const browseRes = await fetch(
            'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Referer: 'https://music.youtube.com/',
                Origin: 'https://music.youtube.com',
                ...authHeaders,
              },
              body: JSON.stringify({
                browseId,
                context: {
                  client: YTM_INNERTUBE_CLIENT,
                },
              }),
            },
          );

          if (browseRes.ok) {
            const browseData = await browseRes.json();
            const tracks = this.parseTracksFromBrowsePlaylist(browseData);
            if (tracks.length > 0) return tracks;
          }
        } catch (err) {
          console.warn('[YouTubeAccountService] InnerTube browse playlist error:', err);
        }
      }
    }

    // 1. Liked Music / Liked Videos query with STRICT Category 10 (Music) filter
    if (playlistId === 'LM' || playlistId === 'LL') {
      if (freshToken) {
        try {
          const res = await fetch(
            'https://www.googleapis.com/youtube/v3/videos?myRating=like&part=snippet,contentDetails,topicDetails&maxResults=50',
            {
              headers: { Authorization: `Bearer ${freshToken}` },
            },
          );

          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.items) && data.items.length > 0) {
              const tracks: Track[] = [];
              for (const item of data.items) {
                const snippet = item.snippet || {};
                const categoryId = String(snippet.categoryId || '');

                const topicCategories = item.topicDetails?.topicCategories || [];
                const hasMusicTopic = topicCategories.some((t: string) =>
                  t.toLowerCase().includes('music') || t.toLowerCase().includes('song'),
                );

                const isStrictMusic =
                  categoryId === '10' ||
                  hasMusicTopic ||
                  /\b(song|music|soundtrack|audio|acoustic|lo-fi|remix|feat\.|ft\.)\b/i.test(
                    snippet.title || '',
                  );

                const isNonMusic =
                  /\b(javascript|python|coding|unboxing|tutorial|review|vlog|podcast|lecture|episode|gameplay)\b/i.test(
                    snippet.title || '',
                  ) ||
                  /\b(school|tech|gaming|news|academy)\b/i.test(
                    snippet.channelTitle || '',
                  );

                if (!isStrictMusic || isNonMusic) continue;

                const videoId = item.id;
                const title = snippet.title;
                const artist =
                  snippet.videoOwnerChannelTitle ||
                  snippet.channelTitle ||
                  'YouTube Music';
                const thumbs = snippet.thumbnails || {};
                const artworkUri =
                  thumbs.high?.url ||
                  thumbs.medium?.url ||
                  (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined);

                if (
                  videoId &&
                  title &&
                  title !== 'Private video' &&
                  title !== 'Deleted video'
                ) {
                  tracks.push({
                    id: videoId,
                    title,
                    artist,
                    artworkUri,
                    origin: 'online',
                  });
                }
              }
              if (tracks.length > 0) return tracks;
            }
          }
        } catch (err) {
          console.warn('[YouTubeAccountService] Liked videos fetch error:', err);
        }
      }
    } else if (freshToken) {
      // 2. Custom created playlist items from Google YouTube Data API
      try {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${encodeURIComponent(playlistId)}&part=snippet,contentDetails&maxResults=50`,
          {
            headers: { Authorization: `Bearer ${freshToken}` },
          },
        );

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items) && data.items.length > 0) {
            const tracks: Track[] = [];
            for (const item of data.items) {
              const snippet = item.snippet || {};
              const videoId = snippet.resourceId?.videoId || item.id;
              const title = snippet.title;
              const artist =
                snippet.videoOwnerChannelTitle ||
                snippet.channelTitle ||
                'YouTube Artist';
              const thumbs = snippet.thumbnails || {};
              const artworkUri =
                thumbs.high?.url ||
                thumbs.medium?.url ||
                (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined);

              if (
                videoId &&
                title &&
                title !== 'Private video' &&
                title !== 'Deleted video'
              ) {
                tracks.push({
                  id: videoId,
                  title,
                  artist,
                  artworkUri,
                  origin: 'online',
                });
              }
            }
            if (tracks.length > 0) return tracks;
          }
        }
      } catch (err) {
        console.warn('[YouTubeAccountService] API playlistItems fetch error:', err);
      }
    }

    // 3. Fallback: Search for playlist title
    try {
      const searchRes = await musicService.search(playlistId);
      return searchRes.tracks;
    } catch {
      return [];
    }
  }

  /**
   * Fetches genuine personalized YouTube Music mixes from the user's home feed
   * via InnerTube browse API (FEmusic_home).
   */
  async fetchPersonalizedMixes(): Promise<readonly YouTubeMixCard[]> {
    try {
      console.log('[DEBUG-MIXES] === fetchPersonalizedMixes START ===');

      // InnerTube's browse endpoint does NOT accept OAuth Bearer tokens
      // (returns 403 "insufficient scopes"). It needs either:
      // 1. SAPISID cookie auth → personalized mixes
      // 2. No auth → generic YouTube Music home feed mixes (still real)
      const authState = youtubeAuthStore.getSnapshot();
      const hasCookieAuth = !!(authState.sapisid && authState.cookieString);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://music.youtube.com/',
        Origin: 'https://music.youtube.com',
      };

      // Only use cookie-based auth (SAPISID) for personalized results
      if (hasCookieAuth) {
        const cookieHeaders = youtubeAuthStore.getAuthHeaders();
        // getAuthHeaders with SAPISID returns Authorization, Cookie, X-Origin, etc.
        Object.assign(headers, cookieHeaders);
        console.log('[DEBUG-MIXES] Using SAPISID cookie auth (personalized)');
      } else {
        console.log('[DEBUG-MIXES] No SAPISID — calling without auth (generic mixes)');
      }

      const res = await fetch(
        'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            browseId: 'FEmusic_home',
            context: {
              client: YTM_INNERTUBE_CLIENT,
            },
          }),
        },
      );

      console.log('[DEBUG-MIXES] HTTP status:', res.status);
      if (!res.ok) {
        const errorText = await res.text().catch(() => '(could not read)');
        console.warn('[DEBUG-MIXES] InnerTube browse FAILED:', res.status, errorText.slice(0, 500));
        return [];
      }

      const data = await res.json();
      console.log('[DEBUG-MIXES] Response top-level keys:', Object.keys(data || {}));
      const mixes = this.parseMixesFromBrowse(data);
      console.log('[DEBUG-MIXES] === Final mixes count:', mixes.length, '===');
      return mixes;
    } catch (err) {
      console.warn('[DEBUG-MIXES] fetchPersonalizedMixes EXCEPTION:', err);
      return [];
    }
  }

  /**
   * Parses mix/radio playlists from InnerTube browse response.
   * Looks for musicCarouselShelfRenderer items that contain playlist-like entries.
   */
  private parseMixesFromBrowse(data: any): YouTubeMixCard[] {
    const mixes: YouTubeMixCard[] = [];
    const seen = new Set<string>();

    try {
      // Navigate to the shelf contents
      const tabs = data?.contents?.singleColumnBrowseResultsRenderer?.tabs;
      console.log('[DEBUG-MIXES] has contents:', !!data?.contents);
      console.log('[DEBUG-MIXES] has singleColumnBrowseResultsRenderer:', !!data?.contents?.singleColumnBrowseResultsRenderer);
      console.log('[DEBUG-MIXES] tabs is array:', Array.isArray(tabs), 'length:', tabs?.length);

      if (!Array.isArray(tabs)) {
        // Try alternate response structures
        console.log('[DEBUG-MIXES] contents keys:', Object.keys(data?.contents || {}));
        // Log first 1000 chars of stringified response for structure analysis
        const preview = JSON.stringify(data).slice(0, 2000);
        console.log('[DEBUG-MIXES] Response preview:', preview);
        return mixes;
      }

      const tabContent = tabs[0]?.tabRenderer?.content;
      const shelves =
        tabContent?.sectionListRenderer?.contents || [];

      console.log('[DEBUG-MIXES] Shelves count:', shelves.length);

      let shelfIdx = 0;
      for (const shelf of shelves) {
        const carousel = shelf?.musicCarouselShelfRenderer;
        const shelfTitle = carousel?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text;
        if (!carousel) {
          // Log what type of shelf this is
          const shelfKeys = Object.keys(shelf || {});
          console.log(`[DEBUG-MIXES] Shelf[${shelfIdx}] not carousel, keys:`, shelfKeys);
          shelfIdx++;
          continue;
        }

        const items = carousel?.contents || [];
        console.log(`[DEBUG-MIXES] Shelf[${shelfIdx}] "${shelfTitle || '(no title)'}" items:`, items.length);

        let allPlaylistIds: string[] = [];
        for (const item of items) {
          const renderer =
            item?.musicTwoRowItemRenderer ||
            item?.musicResponsiveListItemRenderer;
          if (!renderer) {
            console.log(`[DEBUG-MIXES]   item has keys:`, Object.keys(item || {}));
            continue;
          }

          // Extract playlist/mix info
          const navEndpoint =
            renderer?.navigationEndpoint?.watchPlaylistEndpoint ||
            renderer?.navigationEndpoint?.watchEndpoint ||
            renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
              ?.musicPlayButtonRenderer?.playNavigationEndpoint
              ?.watchPlaylistEndpoint;

          const playlistId =
            navEndpoint?.playlistId ||
            renderer?.navigationEndpoint?.browseEndpoint?.browseId;

          allPlaylistIds.push(playlistId || '(none)');

          if (!playlistId) continue;

          // Only pick mix/radio playlists (RD prefix = radio/mix)
          const isMix =
            playlistId.startsWith('RD') ||
            playlistId.startsWith('OLAK') ||
            playlistId.startsWith('VL');

          if (!isMix) continue;
          if (seen.has(playlistId)) continue;
          seen.add(playlistId);

          // Extract title
          const title =
            renderer?.title?.runs?.[0]?.text ||
            renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
              ?.text?.runs?.[0]?.text ||
            'YouTube Mix';

          // Extract subtitle
          const subtitle =
            renderer?.subtitle?.runs?.map((r: any) => r.text).join('') ||
            renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer
              ?.text?.runs?.map((r: any) => r.text).join('') ||
            '';

          // Extract thumbnail
          const thumbs =
            renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail
              ?.thumbnails ||
            renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
            [];
          const bestThumb = thumbs[thumbs.length - 1]?.url || thumbs[0]?.url;

          // Extract seed videoId for playback
          const videoId = navEndpoint?.videoId;

          mixes.push({
            id: playlistId,
            title,
            subtitle,
            thumbnailUrl: bestThumb,
            videoId,
          });
        }
        console.log(`[DEBUG-MIXES]   playlistIds found:`, allPlaylistIds.slice(0, 5));
        shelfIdx++;
      }
    } catch (parseErr) {
      console.warn('[DEBUG-MIXES] parseMixesFromBrowse EXCEPTION:', parseErr);
    }

    console.log('[DEBUG-MIXES] === Personalized mixes parsed:', mixes.length, '===');
    if (mixes.length > 0) {
      console.log('[DEBUG-MIXES] First mix:', JSON.stringify(mixes[0]));
    }
    return mixes;
  }
  /**
   * Parses tracks from InnerTube /next response (used for radio/mix playlists).
   */
  private parseTracksFromNext(data: any): Track[] {
    const tracks: Track[] = [];
    const seen = new Set<string>();

    try {
      // The playlist panel is in contents.singleColumnMusicWatchNextResultsRenderer
      // .tabbedRenderer.watchNextTabbedResultsRenderer.tabs[0].tabRenderer.content
      // .musicQueueRenderer.content.playlistPanelRenderer.contents
      const watchNext =
        data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
          ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || [];

      for (const item of watchNext) {
        const videoRenderer = item?.playlistPanelVideoRenderer;
        if (!videoRenderer) continue;

        const videoId =
          videoRenderer?.videoId ||
          videoRenderer?.navigationEndpoint?.watchEndpoint?.videoId;
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);

        const title = videoRenderer?.title?.runs?.[0]?.text;
        if (!title || title === 'Private video' || title === 'Deleted video') continue;

        // Artist from longBylineText or shortBylineText
        const artistRuns =
          videoRenderer?.longBylineText?.runs ||
          videoRenderer?.shortBylineText?.runs ||
          [];
        const artist = artistRuns
          .filter((r: any) => !r.text?.includes('•') && !r.text?.includes('views'))
          .map((r: any) => r.text)
          .join('')
          .trim() || 'YouTube Music';

        const thumbs = videoRenderer?.thumbnail?.thumbnails || [];
        const artworkUri =
          thumbs[thumbs.length - 1]?.url ||
          `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        tracks.push({
          id: videoId,
          title,
          artist,
          artworkUri,
          origin: 'online',
        });
      }
    } catch (err) {
      console.warn('[YouTubeAccountService] parseTracksFromNext error:', err);
    }

    return tracks;
  }

  /**
   * Parses tracks from InnerTube /browse response for VL/OLAK playlists.
   */
  private parseTracksFromBrowsePlaylist(data: any): Track[] {
    const tracks: Track[] = [];
    const seen = new Set<string>();

    try {
      const contents =
        data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
          ?.content?.sectionListRenderer?.contents?.[0]
          ?.musicPlaylistShelfRenderer?.contents ||
        data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
          ?.content?.sectionListRenderer?.contents?.[0]
          ?.musicPlaylistShelfRenderer?.contents ||
        [];

      for (const item of contents) {
        const renderer = item?.musicResponsiveListItemRenderer;
        if (!renderer) continue;

        // Get videoId from overlay play button
        const videoId =
          renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
            ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
            ?.videoId ||
          renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
            ?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);

        const title =
          renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
            ?.text?.runs?.[0]?.text;
        if (!title) continue;

        const artistRuns =
          renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer
            ?.text?.runs || [];
        const artist = artistRuns
          .filter((r: any) => r.text !== ' • ' && r.text !== ' & ')
          .map((r: any) => r.text)
          .join('')
          .trim() || 'YouTube Music';

        const thumbs =
          renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const artworkUri =
          thumbs[thumbs.length - 1]?.url ||
          `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        tracks.push({
          id: videoId,
          title,
          artist,
          artworkUri,
          origin: 'online',
        });
      }
    } catch (err) {
      console.warn('[YouTubeAccountService] parseTracksFromBrowsePlaylist error:', err);
    }

    return tracks;
  }

  /**
   * Imports a YouTube playlist into Aero's local library.
   */
  async importPlaylistToAero(playlist: {
    readonly id: string;
    readonly title: string;
  }): Promise<{ readonly success: boolean; readonly trackCount: number }> {
    try {
      const tracks = await this.fetchPlaylistTracks(playlist.id);
      if (tracks.length === 0) {
        return { success: false, trackCount: 0 };
      }

      if (playlist.id === 'LM' || playlist.id === 'LL') {
        for (const track of tracks) {
          if (!likedSongs.isLiked(track)) {
            likedSongs.toggleLike(track);
          }
        }
        return { success: true, trackCount: tracks.length };
      }

      await playlists.hydrate();
      const existing = playlists.getSnapshot();
      const match = existing.find(
        (p) => p.name.toLowerCase() === playlist.title.toLowerCase(),
      );

      const targetPlaylistId =
        match ? match.id : await playlists.createPlaylist(playlist.title);
      if (!targetPlaylistId) return { success: false, trackCount: 0 };

      for (const track of tracks) {
        await playlists.addTrack(targetPlaylistId, track);
      }

      return { success: true, trackCount: tracks.length };
    } catch (error) {
      console.warn('[YouTubeAccountService] Failed to import playlist:', error);
      return { success: false, trackCount: 0 };
    }
  }
}

export const youtubeAccountService = new YouTubeAccountService();
