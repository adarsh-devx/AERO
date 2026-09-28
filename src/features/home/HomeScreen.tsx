import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../navigation';
import type { Track } from '../../core/types/track';
import { musicService, playerController, recommendationService } from '../../services/composition';
import { usePlaybackHistory } from '../history/usePlaybackHistory';
import { usePlayerSelector } from '../../playback/usePlayerSelector';
import { useSettings } from '../settings/useSettings';
import {
  dedupeNewestFirst,
  selectDistinctForDisplay,
} from '../../core/types/songKey';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import { TactilePressable } from '../common/TactilePressable';
import { homeColors, homeSpacing } from './theme';
import { HomeHeader } from './components/HomeHeader';
import { CategoryChips } from './components/CategoryChips';
import { ArtworkPlaceholder } from './components/ArtworkPlaceholder';
import { SongGridSection } from './components/SongGridSection';
import { LikedSongsSection } from './components/LikedSongsSection';
import { RecentlyPlayed } from './components/RecentlyPlayed';
import { UpNext } from './components/UpNext';
import { OptionsMenuSheet } from '../nowplaying/components/OptionsMenuSheet';
import { AddToPlaylistSheet } from '../playlists/components/AddToPlaylistSheet';

type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

/** Diverse pool of search queries to randomize Home feeds */
const QUICK_PICK_QUERIES = [
  'Trending Hindi Punjabi Songs',
  'Top Indian Pop Hits',
  'Viral Punjabi Songs',
  'Arijit Singh Best Songs',
  'Bollywood Romantic Hits',
  'Desi Hip Hop Hits',
];

const COVERS_REMIXES_QUERIES = [
  'Acoustic Lo-Fi Remix Songs',
  'Lo-Fi Chill Hindi Mix',
  'Pop Mashup Acoustic Cover',
  'Slowed Reverb Bollywood Hits',
  'Coke Studio Top Hits',
];

const TRENDING_QUERIES = [
  'Top 50 Hits Indian Pop',
  'Global Chartbusters Pop Songs',
  'Trending Punjabi Dance Beats',
  'Bollywood Party Anthems',
  'Top Viral Songs 2024',
];

/**
 * Rich multi-query pools per category chip to fetch 40-50+ diverse tracks
 */
const CATEGORY_FEED_QUERIES: Readonly<Record<string, readonly string[]>> = {
  Podcasts: [
    'popular podcasts full episodes',
    'hindi audio podcast stories',
    'trending podcast shows',
    'motivational podcasts audio',
  ],
  'Work out': [
    'workout motivation songs',
    'gym workout music mix',
    'high energy workout hits',
    'cardio training edm music',
    'beast mode gym songs',
  ],
  'Feel good': [
    'feel good happy songs',
    'upbeat happy music mix',
    'feel good bollywood hit songs',
    'positive morning vibes songs',
    'cheerful pop hits',
  ],
  Energise: [
    'energetic dance songs',
    'energy boost music mix',
    'high energy party hits',
    'electronic dance beats',
    'pump up songs hype',
  ],
  Relax: [
    'relaxing calm songs',
    'chill relaxing music mix',
    'chill vibe hit songs',
    'lofi peaceful instrumental',
    'peaceful acoustic soothing songs',
  ],
  Focus: [
    'focus instrumental music',
    'study deep focus music',
    'focus flow ambient songs',
    'concentration study beats lofi',
    'deep focus piano',
  ],
  Party: [
    'party dance songs bollywood',
    'top party hits dance mix',
    'dance floor party anthems',
    'punjabi club party bangers',
    'party mashup dj songs',
  ],
  Romance: [
    'romantic love songs bollywood',
    'romantic music hits mix',
    'love song classics hindi',
    'bollywood romantic acoustic',
    'latest romantic hits',
  ],
};

/** Home feed fetch state — honest loading/error UI for the category feed. */
type FeedStatus = 'loading' | 'ready' | 'error';

function pickRandom<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Fresh-query picker for the mood feed: avoids re-picking the query a
 * slot just used (when the pool offers an alternative), so a refresh asks
 * the provider for NEW candidates/orderings instead of replaying the last
 * fetch. MusicService.search has no result cache, so each distinct query
 * is a real request — bounded to the fixed pools above, never a loop.
 */
function pickFreshQuery(pool: readonly string[], previous: string | null): string {
  if (previous !== null && pool.length > 1) {
    const alternatives = pool.filter((query) => query !== previous);
    if (alternatives.length > 0) return pickRandom(alternatives);
  }
  return pickRandom(pool);
}

/**
 * Dynamic YouTube Music Home Screen for Aero.
 *
 * Every section reads REAL application data — there is no static demo or
 * fallback content anywhere on Home:
 *
 * - Quick picks / Covers / Trending: live InnerTube results through the
 *   existing provider abstraction (randomized per launch & refresh).
 *   A section stays hidden until its fetch returns tracks.
 * - Recently played: the persisted playback-history store, newest first.
 * - Up next: the live PlayerController queue, in current playback order
 *   (the snapshot's queue is already shuffle-aware).
 * - Liked songs: the persisted liked-songs store.
 * - Personalized sections ("Related To This Song", "More from…",
 *   "Because You Played…", "From Your Recent Searches",
 *   "Discover Something New", "Made for You"): the local
 *   RecommendationService, built from the existing
 *   history/likes/search-history signals, the current-track context and
 *   real provider searches. This screen only renders them — no ranking
 *   logic lives here — and a section is never shown without real
 *   candidates.
 *
 * The previous hardcoded recommendation sections ("Heard in Shorts",
 * "Trending community playlists", "Dancing on your own", "Albums for you")
 * were removed deliberately: the architecture has no recommendation source
 * for them (PRD NG-7 discovery stays provider-driven), and fake tracks must
 * not masquerade as personalized recommendations.
 */
export function HomeScreen({ navigation }: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const history = usePlaybackHistory();
  const isMountedRef = useRef(true);

  /**
   * The ONE queue — read-only view of PlayerController state, never a copy.
   * Selected field-by-field: playback position ticks (~2x/s) publish new
   * snapshots, but Home renders nothing from position, so those ticks must
   * never rebuild this (heavy) tree — only queue changes may.
   */
  const queue = usePlayerSelector((snapshot) => snapshot.queue);
  const queueIndex = usePlayerSelector((snapshot) => snapshot.queueIndex);

  /** Personalized sections from the local recommendation engine. */
  const recommendationSections = useSyncExternalStore(
    recommendationService.subscribe,
    recommendationService.getSnapshot,
  );

  const [quickPicksTracks, setQuickPicksTracks] = useState<readonly Track[]>([]);
  const [coversTracks, setCoversTracks] = useState<readonly Track[]>([]);
  const [trendingTracks, setTrendingTracks] = useState<readonly Track[]>([]);
  const [categoryTracks, setCategoryTracks] = useState<readonly Track[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  /** Controlled chip selection — drives queries AND survives refresh. */
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  /** Loading/error for the Quick picks / Covers / Trending feed. */
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('loading');
  /** Last query each feed slot used — so the next refresh picks a fresh one. */
  const lastFeedQueriesRef = useRef<{
    quick: string | null;
    covers: string | null;
    trend: string | null;
  }>({ quick: null, covers: null, trend: null });
  /**
   * Latest-wins guard: every fetch takes the next id, and only the request
   * still holding the newest id may apply results. Rapid
   * Work out → Feel good → Podcasts therefore ends with EXACTLY the last
   * chip's results even if an older request resolves last.
   */
  const feedRequestIdRef = useRef(0);
  /** The category whose results are currently applied (refresh keeps content). */
  const lastFetchedCategoryRef = useRef<string | null>(null);

  const [selectedTrackForOptions, setSelectedTrackForOptions] = useState<Track | null>(null);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<Track | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchDynamicHomeFeed = useCallback(async (category: string | null) => {
    const requestId = feedRequestIdRef.current + 1;
    feedRequestIdRef.current = requestId;
    const isLatest = () => feedRequestIdRef.current === requestId;

    // Switching to a DIFFERENT category clears the previous results
    if (category !== lastFetchedCategoryRef.current) {
      setQuickPicksTracks([]);
      setCoversTracks([]);
      setTrendingTracks([]);
      setCategoryTracks([]);
    }
    setFeedStatus('loading');

    // 1. Category selected: fetch rich multi-query pool for 40-50+ tracks
    if (category !== null) {
      const queries = CATEGORY_FEED_QUERIES[category] ?? [category];
      const results = await Promise.allSettled(queries.map((q) => musicService.search(q)));

      if (!isLatest() || !isMountedRef.current) return;

      lastFetchedCategoryRef.current = category;
      const combined: Track[] = [];
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value.tracks.length > 0) {
          combined.push(...res.value.tracks);
        }
      }
      setCategoryTracks(combined);
      setFeedStatus(combined.length > 0 ? 'ready' : 'error');
      return;
    }

    // 2. Default feed: randomized fresh-query picking
    setCategoryTracks([]);
    const lastQueries = lastFeedQueriesRef.current;
    const quickQuery = pickFreshQuery(QUICK_PICK_QUERIES, lastQueries.quick);
    const coverQuery = pickFreshQuery(COVERS_REMIXES_QUERIES, lastQueries.covers);
    const trendQuery = pickFreshQuery(TRENDING_QUERIES, lastQueries.trend);

    const [quickRes, coverRes, trendRes] = await Promise.allSettled([
      musicService.search(quickQuery),
      musicService.search(coverQuery),
      musicService.search(trendQuery),
    ]);

    if (!isLatest() || !isMountedRef.current) return;

    lastFeedQueriesRef.current = {
      quick: quickQuery,
      covers: coverQuery,
      trend: trendQuery,
    };
    lastFetchedCategoryRef.current = null;

    let loadedAny = false;
    if (quickRes.status === 'fulfilled' && quickRes.value.tracks.length > 0) {
      setQuickPicksTracks(quickRes.value.tracks);
      loadedAny = true;
    }
    if (coverRes.status === 'fulfilled' && coverRes.value.tracks.length > 0) {
      setCoversTracks(coverRes.value.tracks);
      loadedAny = true;
    }
    if (trendRes.status === 'fulfilled' && trendRes.value.tracks.length > 0) {
      setTrendingTracks(trendRes.value.tracks);
      loadedAny = true;
    }
    setFeedStatus(loadedAny ? 'ready' : 'error');
  }, []);

  useEffect(() => {
    void fetchDynamicHomeFeed(null);
  }, [fetchDynamicHomeFeed]);

  // First Home visit: hydrate signals + fetch personalized sections.
  // Afterwards the service refreshes itself reactively (like/play/search
  // changes); pull-to-refresh below forces a fresh pass.
  useEffect(() => {
    void recommendationService.refresh();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    // Existing mood feed and fresh personalized sections in parallel.
    // allSettled: one failing side never strands the spinner, and neither
    // path touches playback, history, likes or library data.
    await Promise.allSettled([
      // Refreshes whatever category is SELECTED (not a random default feed).
      fetchDynamicHomeFeed(selectedCategory),
      recommendationService.refresh({ force: true }),
    ]);
    if (isMountedRef.current) {
      setRefreshing(false);
    }
  };

  // Prewarm seam: warm the feed's first playable online track through the
  // same resolver/cache the play path uses. Empty lists are a no-op.
  // Recommendation tracks are real fetched tracks — never placeholders.
  /**
   * Global feed dedup + artist diversity — ONE pass in RENDER order:
   * recommendation sections claim first (they render first), then Quick
   * picks, Covers and Trending. `selectDistinctForDisplay`:
   * - drops canonical-song duplicates WITHIN a section (four uploads of
   *   one song collapse to one card),
   * - drops songs already claimed by an EARLIER section (a song shown in
   *   "Because You Played" never reappears in Quick picks/Trending),
   * - caps any artist at 3 cards per section and avoids consecutive
   *   same-artist cards — different SONGS and different ARTISTS, not
   *   merely different video IDs.
   * Up Next (the live queue), Liked songs and Recently played are
   * user/store data and are deliberately NOT part of this pass.
   */
  const feed = useMemo(() => {
    const shownSongKeys = new Set<string>();
    if (selectedCategory !== null) {
      const categoryList = dedupeNewestFirst(categoryTracks).slice(0, 50);
      return {
        recommendationFeed: [],
        quickPicks: [],
        covers: [],
        trending: [],
        categoryList,
      };
    }
    const recommendationFeed = recommendationSections.map((section) => ({
      ...section,
      tracks: selectDistinctForDisplay(section.tracks, shownSongKeys),
    }));
    return {
      recommendationFeed,
      quickPicks: selectDistinctForDisplay(quickPicksTracks, shownSongKeys).slice(0, 16),
      covers: selectDistinctForDisplay(coversTracks, shownSongKeys).slice(0, 12),
      trending: selectDistinctForDisplay(trendingTracks, shownSongKeys).slice(0, 12),
      categoryList: [],
    };
  }, [selectedCategory, categoryTracks, recommendationSections, quickPicksTracks, coversTracks, trendingTracks]);

  const feedTracks = useMemo(
    () =>
      selectedCategory !== null
        ? feed.categoryList
        : [
            ...feed.recommendationFeed.flatMap((section) => section.tracks),
            ...feed.quickPicks,
            ...feed.covers,
            ...feed.trending,
          ],
    [selectedCategory, feed],
  );
  usePrewarmTracks(feedTracks);

  /**
   * Recently Played display: ONLY the persisted playback-history store
   * (recorded by the real playback-start event), newest first —
   * deduplicated to ONE entry per canonical song keeping the NEWEST
   * record's metadata, strictly chronological (never randomized), with
   * the underlying records untouched. When "Save listening history" is
   * off, no personalized recent-play data is displayed: the section
   * falls back to its existing empty state.
   */
  const { playbackHistoryEnabled } = useSettings();
  const displayHistory = useMemo(
    () => (playbackHistoryEnabled ? dedupeNewestFirst(history) : []),
    [history, playbackHistoryEnabled],
  );

  // Up next: upcoming slice of the ONE PlayerController queue, in the
  // current (shuffle-aware) playback order; empty until a queue exists.
  const upcomingQueueTracks = useMemo(
    () =>
      queueIndex >= 0 && queueIndex < queue.length - 1
        ? queue.slice(queueIndex + 1)
        : [],
    [queue, queueIndex],
  );

  /**
   * Queue first, then navigate: `playFromQueue` publishes the new current track
   * synchronously (status 'loading'), so Mini Player / Now Playing switch to it
   * on this frame. Stream resolution continues in the background — the UI must
   * never wait for it.
   */
  const openNowPlayingWithQueue = (list: readonly Track[], index: number) => {
    if (!list || list.length === 0) return;
    void playerController.playFromQueue(list, index);
    navigation.navigate('NowPlaying');
  };

  const handlePlayTrackFromList = (list: readonly Track[], index: number) => {
    openNowPlayingWithQueue(list, index);
  };

  const handlePlayAllFromList = (list: readonly Track[]) => {
    openNowPlayingWithQueue(list, 0);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 140 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={homeColors.accent}
            colors={[homeColors.accent]}
          />
        }
      >
        {/* Top App Bar: Aero Logo + "Aero" Brand + Avatar */}
        <HomeHeader />

        {/* Mood & Category Filter Chips - controlled selection: chip state,
            the applied feed and pull-to-refresh can never drift apart */}
        <CategoryChips
          selectedCategory={selectedCategory}
          onSelectCategory={(category) => {
            setSelectedCategory(category);
            void fetchDynamicHomeFeed(category);
          }}
        />

        {/* Category feed status: honest loading/error UI above the sections
            (sections themselves simply stay hidden while empty). */}
        {feedStatus === 'loading' ? (
          <View style={styles.feedStatusRow} accessibilityRole="text">
            <ActivityIndicator size="small" color={homeColors.textMuted} />
            <Text style={styles.feedStatusText}>
              Loading {selectedCategory !== null ? selectedCategory.toLocaleLowerCase() : 'picks'}…
            </Text>
          </View>
        ) : null}
        {feedStatus === 'error' ? (
          <Pressable
            style={styles.feedStatusRow}
            onPress={() => void fetchDynamicHomeFeed(selectedCategory)}
            accessibilityRole="button"
            accessibilityLabel="Retry loading music"
          >
            <Text style={styles.feedStatusText}>
              Couldn't load music. Tap to retry.
            </Text>
          </Pressable>
        ) : null}

        {/* Category Mode: Clean vertical column list of 40-50 tracks */}
        {selectedCategory !== null ? (
          <View style={styles.section}>
            {feed.categoryList.length > 0 ? (
              <>
                <View style={styles.categoryHeaderRow}>
                  <View>
                    <Text style={styles.categoryHeaderTitle}>{selectedCategory} Mix</Text>
                    <Text style={styles.categoryHeaderSubtitle}>{feed.categoryList.length} tracks</Text>
                  </View>
                  <TactilePressable
                    activeScale={0.92}
                    style={styles.categoryPlayAllButton}
                    onPress={() => handlePlayAllFromList(feed.categoryList)}
                    accessibilityRole="button"
                    accessibilityLabel={`Play all ${selectedCategory} tracks`}
                  >
                    <Ionicons name="play" size={15} color="#000000" style={{ marginRight: 5 }} />
                    <Text style={styles.categoryPlayAllText}>Play all</Text>
                  </TactilePressable>
                </View>

                {feed.categoryList.map((track, idx) => (
                  <TactilePressable
                    key={`${track.origin ?? 'track'}:${track.id}:${idx}`}
                    activeScale={0.97}
                    style={styles.categoryTrackRow}
                    onPress={() => handlePlayTrackFromList(feed.categoryList, idx)}
                    accessibilityRole="button"
                    accessibilityLabel={`Play ${track.title} by ${track.artist}`}
                  >
                    <View style={styles.categoryArtwork}>
                      <ArtworkPlaceholder track={track} size={48} />
                    </View>

                    <View style={styles.categoryMeta}>
                      <Text style={styles.categoryTrackTitle} numberOfLines={1}>
                        {track.title}
                      </Text>
                      <Text style={styles.categoryTrackSubtitle} numberOfLines={1}>
                        {track.artist}
                        {track.album ? ` • ${track.album}` : ''}
                      </Text>
                    </View>

                    <Pressable
                      style={styles.categoryOptionsButton}
                      hitSlop={8}
                      onPress={(e) => {
                        e.stopPropagation();
                        setSelectedTrackForOptions(track);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="More options"
                    >
                      <Ionicons name="ellipsis-vertical" size={18} color={homeColors.textMuted} />
                    </Pressable>
                  </TactilePressable>
                ))}
              </>
            ) : null}
          </View>
        ) : (
          /* Default Home feed when selectedCategory === null */
          <>
            {/* Discovery + personalized sections */}
            {feed.recommendationFeed.map((section) => (
              <SongGridSection
                key={section.id}
                title={section.title}
                tracks={section.tracks}
                onSelectTrack={(_track, idx) => handlePlayTrackFromList(section.tracks, idx)}
                onPlayAll={() => handlePlayAllFromList(section.tracks)}
                onOptionsPress={(track) => setSelectedTrackForOptions(track)}
              />
            ))}

            {/* 1. Quick picks */}
            <SongGridSection
              title="Quick picks"
              tracks={feed.quickPicks}
              onSelectTrack={(_track, idx) => handlePlayTrackFromList(feed.quickPicks, idx)}
              onPlayAll={() => handlePlayAllFromList(feed.quickPicks)}
              onOptionsPress={(track) => setSelectedTrackForOptions(track)}
            />

            {/* 2. Covers and remixes */}
            <SongGridSection
              title="Covers and remixes"
              tracks={feed.covers}
              onSelectTrack={(_track, idx) => handlePlayTrackFromList(feed.covers, idx)}
              onPlayAll={() => handlePlayAllFromList(feed.covers)}
              onOptionsPress={(track) => setSelectedTrackForOptions(track)}
            />

            {/* 3. Trending songs */}
            <SongGridSection
              title="Trending songs for you"
              tracks={feed.trending}
              onSelectTrack={(_track, idx) => handlePlayTrackFromList(feed.trending, idx)}
              onPlayAll={() => handlePlayAllFromList(feed.trending)}
              onOptionsPress={(track) => setSelectedTrackForOptions(track)}
            />

            {/* 4. Recently played */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.heading}>Recently played</Text>
                <Pressable
                  onPress={() => navigation.navigate('RecentlyPlayedHistory')}
                  accessibilityRole="button"
                  accessibilityLabel="See all recently played"
                  hitSlop={8}
                >
                  <Text style={styles.seeAll}>See all</Text>
                </Pressable>
              </View>
              <RecentlyPlayed
                tracks={displayHistory}
                onSelect={(_track, idx) => handlePlayTrackFromList(displayHistory, idx)}
              />
            </View>

            {/* 5. Up next */}
            {upcomingQueueTracks.length > 0 ? (
              <View style={styles.section}>
                <UpNext
                  tracks={upcomingQueueTracks}
                  onSelectTrack={(index) => {
                    void playerController.playAt(queueIndex + 1 + index);
                    navigation.navigate('NowPlaying');
                  }}
                />
              </View>
            ) : null}

            {/* 6. Liked songs section */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.heading}>Liked songs</Text>
                <Pressable
                  onPress={() => navigation.navigate('LikedSongs')}
                  accessibilityRole="button"
                  accessibilityLabel="See all liked songs"
                  hitSlop={8}
                >
                  <Text style={styles.seeAll}>See all</Text>
                </Pressable>
              </View>
              <LikedSongsSection />
            </View>
          </>
        )}
      </ScrollView>

      {/* 3-Dots Options Menu Bottom Sheet */}
      <OptionsMenuSheet
        visible={selectedTrackForOptions !== null}
        track={selectedTrackForOptions}
        onClose={() => setSelectedTrackForOptions(null)}
        onGoToArtist={(artist) => {
          navigation.navigate('Artist', { artistName: artist });
        }}
      />

      {/* Add To Playlist Sheet */}
      <AddToPlaylistSheet
        visible={selectedTrackForPlaylist !== null}
        track={selectedTrackForPlaylist}
        onClose={() => setSelectedTrackForPlaylist(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: homeColors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: homeSpacing.screenX,
    paddingBottom: 24,
  },
  section: {
    marginTop: homeSpacing.sectionGap,
    marginBottom: 8,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: homeColors.text,
    marginBottom: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '600',
    color: homeColors.textMuted,
    marginBottom: 14,
  },
  feedStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  feedStatusText: {
    fontSize: 13,
    fontWeight: '600',
    color: homeColors.textMuted,
    textAlign: 'center',
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 2,
  },
  categoryHeaderTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: homeColors.text,
  },
  categoryHeaderSubtitle: {
    fontSize: 13,
    color: homeColors.textMuted,
    marginTop: 2,
  },
  categoryPlayAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  categoryPlayAllText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 13,
  },
  categoryTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderRadius: 10,
  },
  categoryArtwork: {
    width: 48,
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#1c1c1e',
    marginRight: 12,
  },
  categoryMeta: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  categoryTrackTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
    marginBottom: 3,
  },
  categoryTrackSubtitle: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
  categoryOptionsButton: {
    padding: 8,
  },
});
