import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation';
import type { Track } from '../../core/types/track';
import { musicService, playerController } from '../../services/composition';
import { usePlaybackHistory } from '../history/usePlaybackHistory';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import {
  quickPicks as fallbackQuickPicks,
  coversAndRemixes as fallbackCovers,
  heardInShorts as fallbackShorts,
  trendingPlaylists,
  dancingMoods as defaultDancingMoods,
  albumsForYou as defaultAlbumsForYou,
  trendingSongs as fallbackTrending,
  CardItem,
} from './data';
import { homeColors, homeSpacing } from './theme';
import { HomeHeader } from './components/HomeHeader';
import { CategoryChips } from './components/CategoryChips';
import { SongGridSection } from './components/SongGridSection';
import { SquareCardsSection } from './components/SquareCardsSection';
import { TrendingPlaylistSection } from './components/TrendingPlaylistSection';
import { LikedSongsSection } from './components/LikedSongsSection';
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

function pickRandom<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function shuffleArray<T>(array: readonly T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Dynamic YouTube Music Home Screen for Aero.
 *
 * Randomizes and fetches real, live playable YouTube songs and albums on every launch & refresh.
 */
export function HomeScreen({ navigation }: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const history = usePlaybackHistory();
  const isMountedRef = useRef(true);

  const [quickPicksTracks, setQuickPicksTracks] = useState<readonly Track[]>([]);
  const [coversTracks, setCoversTracks] = useState<readonly Track[]>([]);
  const [trendingTracks, setTrendingTracks] = useState<readonly Track[]>([]);
  const [dancingMoodsList, setDancingMoodsList] = useState<readonly CardItem[]>(defaultDancingMoods);
  const [albumsList, setAlbumsList] = useState<readonly CardItem[]>(defaultAlbumsForYou);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedTrackForOptions, setSelectedTrackForOptions] = useState<Track | null>(null);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<Track | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchDynamicHomeFeed = useCallback(async (moodQuery?: string | null) => {
    try {
      const quickQuery = moodQuery
        ? `${moodQuery} Songs Hits`
        : pickRandom(QUICK_PICK_QUERIES);
      const coverQuery = moodQuery
        ? `${moodQuery} Acoustic Lo-Fi Remix`
        : pickRandom(COVERS_REMIXES_QUERIES);
      const trendQuery = moodQuery
        ? `${moodQuery} Top Hits`
        : pickRandom(TRENDING_QUERIES);

      const [quickRes, coverRes, trendRes] = await Promise.allSettled([
        musicService.search(quickQuery),
        musicService.search(coverQuery),
        musicService.search(trendQuery),
      ]);

      if (!isMountedRef.current) return;

      if (quickRes.status === 'fulfilled' && quickRes.value.tracks.length > 0) {
        setQuickPicksTracks(quickRes.value.tracks.slice(0, 16));
      }

      if (coverRes.status === 'fulfilled' && coverRes.value.tracks.length > 0) {
        setCoversTracks(coverRes.value.tracks.slice(0, 12));
      }

      if (trendRes.status === 'fulfilled' && trendRes.value.tracks.length > 0) {
        setTrendingTracks(trendRes.value.tracks.slice(0, 12));
      }

      // Shuffle Moods & Albums on each fetch for YouTube Music style dynamic rotation
      setDancingMoodsList(shuffleArray(defaultDancingMoods));
      setAlbumsList(shuffleArray(defaultAlbumsForYou));
    } catch (err) {
      console.warn('[HOME] dynamic feed fetch error:', err);
    }
  }, []);

  useEffect(() => {
    void fetchDynamicHomeFeed();
  }, [fetchDynamicHomeFeed]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDynamicHomeFeed();
    if (isMountedRef.current) {
      setRefreshing(false);
    }
  };

  // Quick picks: prioritizes history if available, then live dynamic tracks, then fallback
  const activeQuickPicks =
    history.length > 0
      ? history
      : quickPicksTracks.length > 0
        ? quickPicksTracks
        : fallbackQuickPicks;

  const activeCovers = coversTracks.length > 0 ? coversTracks : fallbackCovers;
  const activeTrending = trendingTracks.length > 0 ? trendingTracks : fallbackTrending;

  const topListIsReal = history.length > 0 || quickPicksTracks.length > 0;
  const homeTracks = topListIsReal
    ? ([
        ...activeQuickPicks,
        ...activeCovers,
        ...fallbackShorts,
        ...trendingPlaylists.topTracks,
        ...activeTrending,
      ] as readonly Track[])
    : null;
  usePrewarmTracks(homeTracks);

  const handlePlayTrackFromList = (list: readonly Track[], index: number) => {
    if (!list || list.length === 0) return;
    void (async () => {
      await playerController.playFromQueue(list, index);
      navigation.navigate('NowPlaying');
    })();
  };

  const handlePlayAllFromList = (list: readonly Track[]) => {
    if (list && list.length > 0) {
      void (async () => {
        await playerController.playFromQueue(list, 0);
        navigation.navigate('NowPlaying');
      })();
    }
  };

  const handleSelectCardItem = (item: CardItem) => {
    if (item.tracks && item.tracks.length > 0) {
      void (async () => {
        await playerController.playFromQueue(item.tracks, 0);
        navigation.navigate('NowPlaying');
      })();
    }
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

        {/* Mood & Category Filter Chips - Dynamically updates Home feed */}
        <CategoryChips
          onSelectCategory={(category) => {
            void fetchDynamicHomeFeed(category);
          }}
        />

        {/* 1. Quick picks (Real Playable Tracks) */}
        <SongGridSection
          title="Quick picks"
          tracks={activeQuickPicks}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(activeQuickPicks, idx)}
          onPlayAll={() => handlePlayAllFromList(activeQuickPicks)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 2. Covers and remixes (Real Playable Tracks) */}
        <SongGridSection
          title="Covers and remixes"
          tracks={activeCovers}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(activeCovers, idx)}
          onPlayAll={() => handlePlayAllFromList(activeCovers)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 3. Heard in Shorts (Real Playable Tracks) */}
        <SongGridSection
          title="Heard in Shorts"
          tracks={fallbackShorts}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(fallbackShorts, idx)}
          onPlayAll={() => handlePlayAllFromList(fallbackShorts)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 4. Trending community playlists (Real Playable Tracks) */}
        <TrendingPlaylistSection
          playlist={trendingPlaylists}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(trendingPlaylists.topTracks, idx)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 5. Dancing on your own (Real Mood Playlists -> Direct Play) */}
        <SquareCardsSection
          subtitle="DANCE YOUR STRESS AWAY"
          title="Dancing on your own"
          items={dancingMoodsList}
          onSelectItem={(item) => handleSelectCardItem(item)}
        />

        {/* 6. Albums for you (Real Playable Albums -> Direct Play) */}
        <SquareCardsSection
          title="Albums for you"
          items={albumsList}
          onSelectItem={(item) => handleSelectCardItem(item)}
        />

        {/* 7. Trending songs for you (Real Playable Tracks) */}
        <SongGridSection
          title="Trending songs for you"
          tracks={activeTrending}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(activeTrending, idx)}
          onPlayAll={() => handlePlayAllFromList(activeTrending)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 8. Liked songs section */}
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
        onSaveToPlaylist={() => {
          setSelectedTrackForPlaylist(selectedTrackForOptions);
        }}
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
});
