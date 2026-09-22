import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '../../../core/types/track';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { homeColors, homeRadius, homeSpacing, mutedText } from '../theme';

const RECENT_ARTWORK = 44;

type RecentlyPlayedProps = {
  tracks: readonly Track[];
  /** Maximum number of tracks to display (e.g. 6 on home screen). */
  maxItems?: number;
  /** Starts playback for a history entry through the existing player flow. */
  onSelect?: (track: Track, index: number) => void;
};

/**
 * Compact two-column grid of recently played items:
 * small square artwork, title, artist.
 *
 * Renders the real playback history (newest first), and a clean empty
 * state before anything has been played.
 */
export function RecentlyPlayed({ tracks, maxItems = 6, onSelect }: RecentlyPlayedProps) {
  if (tracks.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing played yet</Text>
        <Text style={styles.emptyHint}>Tracks you play will show up here.</Text>
      </View>
    );
  }

  const displayedTracks = maxItems > 0 ? tracks.slice(0, maxItems) : tracks;

  return (
    <View style={styles.grid}>
      {displayedTracks.map((track, index) => {
        const content = (
          <>
            <ArtworkPlaceholder track={track} size={RECENT_ARTWORK} />
            <View style={styles.meta}>
              <Text style={mutedText.title} numberOfLines={1}>
                {track.title}
              </Text>
              <Text style={mutedText.subtitle} numberOfLines={1}>
                {track.artist}
              </Text>
            </View>
          </>
        );

        if (!onSelect) {
          return (
            <View key={track.id} style={styles.item}>
              {content}
            </View>
          );
        }

        return (
          <Pressable
            key={track.id}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            onPress={() => onSelect(track, index)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${track.title} by ${track.artist}`}
          >
            {content}
          </Pressable>
        );
      })}
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
  empty: {
    borderWidth: 1,
    borderColor: homeColors.border,
    borderRadius: homeRadius.artwork,
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.textMuted,
  },
  emptyHint: {
    fontSize: 12,
    color: homeColors.textFaint,
  },
});
