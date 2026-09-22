import { useCallback, useEffect } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation';
import type { Track } from '../../core/types/track';
import { playerController } from '../../services/composition';
import { useLikedSongs } from './useLikedSongs';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import { homeColors, homeRadius } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';

type LikedSongsScreenProps = NativeStackScreenProps<RootStackParamList, 'LikedSongs'>;

/**
 * Dedicated Liked Songs screen.
 *
 * Reads ONLY the app-level liked-songs store; tapping a track starts
 * playback through the existing PlayerController with the displayed
 * liked list as the queue context (consistent with Search behavior).
 */
export function LikedSongsScreen({ navigation }: LikedSongsScreenProps) {
  const insets = useSafeAreaInsets();
  const { likedTracks } = useLikedSongs();

  // Shared prewarm seam: warm the first playable online liked track before the
  // user taps. Placed before the empty-state return so hook order is stable.
  usePrewarmTracks(likedTracks);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: `Liked Songs${likedTracks.length > 0 ? ` (${likedTracks.length})` : ''}`,
    });
  }, [navigation, likedTracks.length]);

  const handlePlay = useCallback(
    (index: number) => {
      void playerController.playFromQueue(likedTracks, index);
    },
    [likedTracks],
  );

  if (likedTracks.length === 0) {
    return (
      <View style={[styles.container, styles.emptyContainer, { paddingTop: 16 }]}>
        <Text style={styles.emptyTitle}>No liked songs yet</Text>
        <Text style={styles.emptySubtitle}>
          Tracks you like from Now Playing will appear here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={likedTracks}
        keyExtractor={(track) => `${track.origin ?? 'unknown'}:${track.id}`}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        renderItem={({ item, index }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => handlePlay(index)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${item.title}`}
          >
            <View style={styles.artwork}>
              <ArtworkPlaceholder track={item} size={44} />
            </View>
            <View style={styles.meta}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {item.artist}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: homeColors.background,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: homeColors.text,
  },
  emptySubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: homeColors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  artwork: {
    width: 44,
    height: 44,
    borderRadius: homeRadius.artwork,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  artist: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
});