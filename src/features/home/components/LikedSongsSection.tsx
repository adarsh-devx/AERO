import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '../../../core/types/track';
import { playerController } from '../../../services/composition';
import { useLikedSongs } from '../../liked/useLikedSongs';
import { usePrewarmTracks } from '../../../playback/usePrewarmTracks';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { homeColors, homeRadius, homeSpacing, mutedText } from '../theme';

const LIKED_ARTWORK = 44;
/** Max rows shown on Home before the user follows the header's See all. */
const LIKED_SECTION_PREVIEW_COUNT = 4;

/**
 * Home "Liked songs" section over the real liked-songs store:
 * compact rows (artwork, title, artist), newest-liked first, capped
 * preview with a See all action into the Liked Songs screen. Tapping a
 * row plays through the existing PlayerController queue flow.
 * A subtle empty state replaces the section when nothing is liked.
 */
export function LikedSongsSection() {
  const { likedTracks } = useLikedSongs();

  // Shared prewarm seam: warm the first playable online liked track while the
  // user is looking at the section. Called before the empty-state return so the
  // hook order stays stable.
  usePrewarmTracks(likedTracks);

  if (likedTracks.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Songs you like will show up here.</Text>
      </View>
    );
  }

  const preview = likedTracks.slice(0, LIKED_SECTION_PREVIEW_COUNT);

  return (
    <View style={styles.grid}>
      {preview.map((track: Track, index: number) => (
        <Pressable
          key={`${track.origin ?? 'unknown'}:${track.id}`}
          style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          onPress={() => {
            void playerController.playFromQueue(likedTracks, index);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Play ${track.title} by ${track.artist}`}
        >
          <ArtworkPlaceholder track={track} size={LIKED_ARTWORK} />
          <View style={styles.meta}>
            <Text style={mutedText.title} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={mutedText.subtitle} numberOfLines={1}>
              {track.artist}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: homeSpacing.itemGap,
  },
  item: {
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  itemPressed: {
    opacity: 0.6,
  },
  seeAll: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '500',
    color: homeColors.textMuted,
  },
  empty: {
    borderWidth: 1,
    borderColor: homeColors.border,
    borderRadius: homeRadius.artwork,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 12,
    color: homeColors.textFaint,
  },
});