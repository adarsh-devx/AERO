import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

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
import { homeColors, homeSpacing } from './theme';
import { HomeHeader } from './components/HomeHeader';
import { CategoryChips } from './components/CategoryChips';
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
 * Real provider queries behind each category chip — every entry is a plain
 * music/content search through the EXISTING MusicService → InnerTube path
 * (the same architecture the default feed already uses), so results are
 * genuinely different per chip with no local lists, no demo songs and no
 * filtering of the same hardcoded results. Three DIFFERENT phrasings per
 * category keep Quick picks / Covers and remixes / Trending genuinely
 * distinct sections instead of the same answer three times.
 *
 * Category taps are explicit USER discovery (like typing in Search), so
 * they work regardless of the Personalized Home setting; they never touch
 * search history or any signal store.
 */
const CATEGORY_FEED_QUERIES: Readonly<
  Record<string, { readonly quick: string; readonly covers: string; readonly trend: string }>
> = {
  Podcasts: {
    quick: 'popular podcasts',
    covers: 'podcast episodes discussion',
    trend: 'new podcast shows',
  },
  'Work out': {
    quick: 'workout motivation songs',
    covers: 'gym workout music mix',
    trend: 'high energy workout hits',
  },
  'Feel good': {
    quick: 'feel good happy songs',
    covers: 'upbeat happy music mix',
    trend: 'feel good hit songs',
  },
  Energise: {
    quick: 'energetic dance songs',
    covers: 'energy boost music mix',
    trend: 'high energy party hits',
  },
  Relax: {
    quick: 'relaxing calm songs',
    covers: 'chill relaxing music mix',
    trend: 'chill vibe hit songs',
  },
  Focus: {
    quick: 'focus instrumental music',
    covers: 'study deep focus music',
    trend: 'focus flow songs',
  },
  Party: {
    quick: 'party dance songs',
    covers: 'party hits music mix',
    trend: 'dance floor party anthems',
  },
  Romance: {
    quick: 'romantic love songs',
    covers: 'romantic music hits mix',
    trend: 'love song classics',
  },
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
    // immediately: the old category's songs must never render under the
    // new selection, and the loading state stays honest. Refreshing the
    // SAME category keeps current content visible while it reloads.
    if (category !== lastFetchedCategoryRef.current) {
      setQuickPicksTracks([]);
      setCoversTracks([]);
      setTrendingTracks([]);
    }
    setFeedStatus('loading');

    // Category → real intent queries (existing provider path); default feed
    // keeps its randomized fresh-query picking.
    const plan = category !== null ? CATEGORY_FEED_QUERIES[category] : undefined;
    const lastQueries = lastFeedQueriesRef.current;
    const quickQuery = plan ? plan.quick : pickFreshQuery(QUICK_PICK_QUERIES, lastQueries.quick);
    const coverQuery = plan ? plan.covers : pickFreshQuery(COVERS_REMIXES_QUERIES, lastQueries.covers);
    const trendQuery = plan ? plan.trend : pickFreshQuery(TRENDING_QUERIES, lastQueries.trend);

    const [quickRes, coverRes, trendRes] = await Promise.allSettled([
      musicService.search(quickQuery),
      musicService.search(coverQuery),
      musicService.search(trendQuery),
    ]);

    // Latest-wins + unmount guard: a slower earlier request can never
    // overwrite a newer category's results, and nothing applies after the
    // screen is gone.
    if (!isLatest() || !isMountedRef.current) return;

    lastFeedQueriesRef.current = {
      quick: quickQuery,
      covers: coverQuery,
      trend: trendQuery,
    };
    lastFetchedCategoryRef.current = category;

    // Keep the FULL result list: display dedup + artist diversity run
    // first (in the feed memo below) and section sizes are applied
    // afterwards, so collapsing alternate uploads never shrinks a grid.
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
    const recommendationFeed = recommendationSections.map((section) => ({
      ...section,
      tracks: selectDistinctForDisplay(section.tracks, shownSongKeys),
    }));
    return {
      recommendationFeed,
      quickPicks: selectDistinctForDisplay(quickPicksTracks, shownSongKeys).slice(0, 16),
      covers: selectDistinctForDisplay(coversTracks, shownSongKeys).slice(0, 12),
      trending: selectDistinctForDisplay(trendingTracks, shownSongKeys).slice(0, 12),
    };
  }, [recommendationSections, quickPicksTracks, coversTracks, trendingTracks]);

  const feedTracks = useMemo(
    () => [
      ...feed.recommendationFeed.flatMap((section) => section.tracks),
      ...feed.quickPicks,
      ...feed.covers,
      ...feed.trending,
    ],
    [feed],
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

        {/* Discovery + personalized sections — local RecommendationService
            output (current-track context, signal sections, ranked
            catch-all), song-deduplicated globally across the WHOLE feed
            in the memo above. Rendered only with real candidates;
            ranking lives in the service. */}
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

        {/* 1. Quick picks — live InnerTube results; hidden until fetched */}
        <SongGridSection
          title="Quick picks"
          tracks={feed.quickPicks}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(feed.quickPicks, idx)}
          onPlayAll={() => handlePlayAllFromList(feed.quickPicks)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 2. Covers and remixes — live InnerTube results */}
        <SongGridSection
          title="Covers and remixes"
          tracks={feed.covers}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(feed.covers, idx)}
          onPlayAll={() => handlePlayAllFromList(feed.covers)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 3. Trending songs for you — live InnerTube results */}
        <SongGridSection
          title="Trending songs for you"
          tracks={feed.trending}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(feed.trending, idx)}
          onPlayAll={() => handlePlayAllFromList(feed.trending)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 4. Recently played — persisted playback history (newest first,
            one entry per canonical song; hidden when the setting is off) */}
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

        {/* 5. Up next — the live PlayerController queue; hidden when idle */}
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
});
