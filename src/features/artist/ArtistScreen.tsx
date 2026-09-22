import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../navigation';
import type { Track } from '../../core/types/track';
import { musicService, playerController } from '../../services/composition';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import { homeColors, homeRadius } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';

type ArtistScreenProps = NativeStackScreenProps<RootStackParamList, 'Artist'>;

interface ArtistMetadata {
  readonly name: string;
  readonly subscribers: string;
  readonly bannerColor: string;
}

const ARTIST_META: Record<string, ArtistMetadata> = {
  Talwinder: { name: 'Talwinder', subscribers: '1.24M subscribers', bannerColor: '#3a0ca3' },
  Shubh: { name: 'Shubh', subscribers: '7.72M subscribers', bannerColor: '#2b2d42' },
  'Arijit Singh': { name: 'Arijit Singh', subscribers: '42.5M subscribers', bannerColor: '#480ca8' },
  'AP Dhillon': { name: 'AP Dhillon', subscribers: '4.8M subscribers', bannerColor: '#5a189a' },
  'Yo Yo Honey Singh': { name: 'Yo Yo Honey Singh', subscribers: '14.5M subscribers', bannerColor: '#e01e37' },
};

/**
 * Dynamic YouTube Music Artist Screen.
 *
 * Fetches real playable tracks live for the artist via musicService.
 */
export function ArtistScreen({ route, navigation }: ArtistScreenProps) {
  const insets = useSafeAreaInsets();
  const artistName = route.params?.artistName ?? 'Artist';
  const meta = ARTIST_META[artistName] ?? {
    name: artistName,
    subscribers: 'Official Artist Channel',
    bannerColor: '#240046',
  };

  const [songs, setSongs] = useState<readonly Track[]>([]);
  const [loading, setLoading] = useState(true);
  const openingRef = useRef(false);

  // Shared prewarm seam: warm the artist list's first playable online track as
  // soon as the list arrives, so the first tap is cached or already in flight.
  usePrewarmTracks(songs);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    void (async () => {
      try {
        const { tracks } = await musicService.search(`${artistName} songs`);
        if (isMounted) {
          setSongs(tracks.slice(0, 20));
        }
      } catch (err) {
        console.warn('[ARTIST] failed to load real tracks for', artistName, err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [artistName]);

  const handlePlaySong = useCallback(
    (index: number) => {
      if (openingRef.current || songs.length === 0) return;
      openingRef.current = true;
      void (async () => {
        try {
          await playerController.playFromQueue(songs, index);
          navigation.navigate('NowPlaying');
        } finally {
          openingRef.current = false;
        }
      })();
    },
    [songs, navigation],
  );

  const handleShuffle = () => {
    if (songs.length > 0) {
      handlePlaySong(0);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Navigation Bar */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>

        <Text style={styles.topBarTitle} numberOfLines={1}>
          {meta.name}
        </Text>

        <Pressable
          style={styles.backButton}
          onPress={() => navigation.navigate('Search')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Search artist"
        >
          <Ionicons name="search-outline" size={22} color="#ffffff" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Artist Hero / Avatar Header */}
        <View style={styles.heroSection}>
          <View style={[styles.artistAvatarLarge, { backgroundColor: meta.bannerColor }]}>
            <Text style={styles.avatarLetter}>{meta.name.charAt(0)}</Text>
          </View>
          <Text style={styles.artistName}>{meta.name}</Text>
          <Text style={styles.subscribersCount}>{meta.subscribers}</Text>

          {/* Action Buttons: Shuffle & Subscribe */}
          <View style={styles.heroActions}>
            <Pressable
              style={({ pressed }) => [styles.shuffleButton, pressed && styles.buttonPressed]}
              onPress={handleShuffle}
              accessibilityRole="button"
              accessibilityLabel="Shuffle songs"
            >
              <Ionicons name="shuffle" size={20} color="#000000" />
              <Text style={styles.shuffleText}>Shuffle</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.subscribeButton, pressed && styles.buttonPressed]}
              accessibilityRole="button"
              accessibilityLabel="Subscribe"
            >
              <Text style={styles.subscribeText}>Subscribe</Text>
            </Pressable>
          </View>
        </View>

        {/* Songs Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Songs</Text>
          {songs.length > 0 ? (
            <Pressable onPress={handleShuffle}>
              <Text style={styles.seeAllText}>Play all</Text>
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color="#ffffff" size="large" />
          </View>
        ) : songs.length === 0 ? (
          <View style={styles.centerContainer}>
            <Text style={styles.emptyText}>No songs found for {meta.name}</Text>
          </View>
        ) : (
          <View style={styles.songsList}>
            {songs.map((song, index) => (
              <Pressable
                key={`${song.id}-${index}`}
                style={({ pressed }) => [styles.songRow, pressed && styles.rowPressed]}
                onPress={() => handlePlaySong(index)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${song.title}`}
              >
                <Text style={styles.songIndex}>{index + 1}</Text>

                <View style={styles.songArtwork}>
                  {song.artworkUri ? (
                    <Image source={{ uri: song.artworkUri }} style={styles.imageFill} />
                  ) : (
                    <ArtworkPlaceholder track={song} size={48} />
                  )}
                </View>

                <View style={styles.songMeta}>
                  <Text style={styles.songTitle} numberOfLines={1}>
                    {song.title}
                  </Text>
                  <Text style={styles.songSubtitle} numberOfLines={1}>
                    {song.artist}
                  </Text>
                </View>

                <Pressable style={styles.songMenuButton} hitSlop={8}>
                  <Ionicons name="ellipsis-vertical" size={18} color="#8e8e93" />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030303',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 52,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  artistAvatarLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    elevation: 8,
  },
  avatarLetter: {
    fontSize: 48,
    fontWeight: '800',
    color: '#ffffff',
  },
  artistName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subscribersCount: {
    fontSize: 14,
    color: '#8e8e93',
    marginBottom: 18,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shuffleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  shuffleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
  },
  subscribeButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  subscribeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  centerContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#8e8e93',
  },
  songsList: {
    paddingHorizontal: 16,
    gap: 6,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowPressed: {
    opacity: 0.7,
  },
  songIndex: {
    width: 20,
    fontSize: 15,
    fontWeight: '600',
    color: '#8e8e93',
    textAlign: 'center',
  },
  songArtwork: {
    width: 48,
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
  },
  imageFill: {
    width: '100%',
    height: '100%',
  },
  songMeta: {
    flex: 1,
    gap: 3,
  },
  songTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  songSubtitle: {
    fontSize: 13,
    color: '#8e8e93',
  },
  songMenuButton: {
    padding: 8,
  },
});
