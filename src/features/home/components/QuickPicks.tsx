import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '../../../core/types/track';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { homeColors, homeRadius } from '../theme';

type QuickPicksProps = {
  tracks: readonly Track[];
  onSelectTrack: (track: Track, index: number) => void;
  onPlayAll: () => void;
  onOptionsPress?: (track: Track) => void;
};

/**
 * YouTube Music "Quick picks" section.
 *
 * Header: "Quick picks" + "Play all" button.
 * Grid/Columns: 4 stacked songs per column with artwork, title, subtitle & 3-dots button.
 */
export function QuickPicks({
  tracks,
  onSelectTrack,
  onPlayAll,
  onOptionsPress,
}: QuickPicksProps) {
  if (tracks.length === 0) return null;

  // Chunk tracks into columns of 4 rows each
  const columns: Track[][] = [];
  for (let i = 0; i < tracks.length; i += 4) {
    columns.push(tracks.slice(i, i + 4));
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Quick picks</Text>
        <Pressable
          style={({ pressed }) => [styles.playAllButton, pressed && styles.playAllButtonPressed]}
          onPress={onPlayAll}
          accessibilityRole="button"
          accessibilityLabel="Play all quick picks"
        >
          <Text style={styles.playAllText}>Play all</Text>
        </Pressable>
      </View>

      {/* Horizontal scrolling 4-row columns */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
      >
        {columns.map((column, colIdx) => (
          <View key={colIdx} style={styles.column}>
            {column.map((track, rowIdx) => {
              const globalIndex = colIdx * 4 + rowIdx;
              return (
                <Pressable
                  key={`${track.origin ?? 'track'}:${track.id}:${globalIndex}`}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => onSelectTrack(track, globalIndex)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${track.title} by ${track.artist}`}
                >
                  <View style={styles.artwork}>
                    <ArtworkPlaceholder track={track} size={48} />
                  </View>

                  <View style={styles.meta}>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                      {track.title}
                    </Text>
                    <Text style={styles.trackSubtitle} numberOfLines={1}>
                      {track.artist}
                      {track.album ? ` • ${track.album}` : ''}
                    </Text>
                  </View>

                  <Pressable
                    style={styles.optionsButton}
                    hitSlop={8}
                    onPress={(e) => {
                      e.stopPropagation();
                      if (onOptionsPress) onOptionsPress(track);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="More options"
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={homeColors.textMuted} />
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: homeColors.text,
  },
  playAllButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  playAllButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  playAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: homeColors.text,
  },
  scrollContent: {
    gap: 16,
    paddingRight: 16,
  },
  column: {
    width: 290,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
    borderRadius: homeRadius.surface,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  artwork: {
    width: 48,
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  meta: {
    flex: 1,
    gap: 3,
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  trackSubtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  optionsButton: {
    padding: 6,
  },
});
