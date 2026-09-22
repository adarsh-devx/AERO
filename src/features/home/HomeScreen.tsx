import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  dancingMoods,
  albumsForYou,
  trendingSongs as fallbackTrending,
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

/**
 * Dynamic YouTube Music Home Screen for Aero.
 *
 * Fetches real, live playable YouTube songs and videos for all sections.
 */
export function HomeScreen({ navigation }: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const history = usePlaybackHistory();

  const [quickPicksTracks, setQuickPicksTracks] = useState<readonly Track[]>([]);
  const [coversTracks, setCoversTracks] = useState<readonly Track[]>([]);
  const [trendingTracks, setTrendingTracks] = useState<readonly Track[]>([]);

  const [selectedTrackForOptions, setSelectedTrackForOptions] = useState<Track | null>(null);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<Track | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Fetch real live tracks for Home sections in parallel
    void (async () => {
      try {
        const [quickRes, coverRes, trendRes] = await Promise.allSettled([
          musicService.search('Trending Hindi Punjabi Songs'),
          musicService.search('Acoustic Lo-Fi Remix Songs'),
          musicService.search('Top 50 Hits Indian Pop'),
        ]);

        if (!isMounted) return;

        if (quickRes.status === 'fulfilled' && quickRes.value.tracks.length > 0) {
          setQuickPicksTracks(quickRes.value.tracks.slice(0, 16));
        }

        if (coverRes.status === 'fulfilled' && coverRes.value.tracks.length > 0) {
          setCoversTracks(coverRes.value.tracks.slice(0, 12));
        }

        if (trendRes.status === 'fulfilled' && trendRes.value.tracks.length > 0) {
          setTrendingTracks(trendRes.value.tracks.slice(0, 12));
        }
      } catch (err) {
        console.warn('[HOME] dynamic feed fetch error:', err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Quick picks: prioritizes history if available, then live dynamic tracks, then fallback
  const activeQuickPicks =
    history.length > 0
      ? history
      : quickPicksTracks.length > 0
        ? quickPicksTracks
        : fallbackQuickPicks;

  const activeCovers = coversTracks.length > 0 ? coversTracks : fallbackCovers;
  const activeTrending = trendingTracks.length > 0 ? trendingTracks : fallbackTrending;

    // Do NOT prewarm static fallback data. fallbackQuickPicks/fallbackCovers/fallbackTrending
  // (data.ts) are placeholders replaced once the real search/history results hydrate.
  // Prewarming them first used to occupy the prewarm slot and DEFER the real first
  // track out of the adoptable resolver.inflight map, so a tap on the real first
  // track issued a fresh NewPipe resolution instead of adopting the warm. Only offer
  // once the *top* list is real (history or live search) so the offered first online
  // track is the one actually rendered and tappable.
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
    void (async () => {
      await playerController.playFromQueue(list, index);
      navigation.navigate('NowPlaying');
    })();
  };

  const handlePlayAllFromList = (list: readonly Track[]) => {
    if (list.length > 0) {
      void (async () => {
        await playerController.playFromQueue(list, 0);
        navigation.navigate('NowPlaying');
      })();
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top App Bar: Aero Logo + "Aero" Brand + Avatar */}
        <HomeHeader />

        {/* Mood & Category Filter Chips */}
        <CategoryChips
          onSelectCategory={(_category) => {
            navigation.navigate('Search');
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

        {/* 5. Heard in Shorts */}
        <SongGridSection
          title="Heard in Shorts"
          tracks={fallbackShorts}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(fallbackShorts, idx)}
          onPlayAll={() => handlePlayAllFromList(fallbackShorts)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 6. Trending community playlists */}
        <TrendingPlaylistSection
          playlist={trendingPlaylists}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(trendingPlaylists.topTracks, idx)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 7. Dancing on your own (Moods) */}
        <SquareCardsSection
          subtitle="DANCE YOUR STRESS AWAY"
          title="Dancing on your own"
          items={dancingMoods}
          onSelectItem={(_item) => {
            navigation.navigate('Search');
          }}
        />

        {/* 8. Albums for you */}
        <SquareCardsSection
          title="Albums for you"
          items={albumsForYou}
          onSelectItem={(_item) => {
            navigation.navigate('Search');
          }}
        />

        {/* 9. Trending songs for you (Real Playable Tracks) */}
        <SongGridSection
          title="Trending songs for you"
          tracks={activeTrending}
          onSelectTrack={(_track, idx) => handlePlayTrackFromList(activeTrending, idx)}
          onPlayAll={() => handlePlayAllFromList(activeTrending)}
          onOptionsPress={(track) => setSelectedTrackForOptions(track)}
        />

        {/* 10. Liked songs section */}
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
