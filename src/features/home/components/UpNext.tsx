import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '../../../core/types/track';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { homeColors, homeRadius, mutedText } from '../theme';

const ROW_ARTWORK = 48;
/** Max upcoming rows previewed on Home; the full queue lives in Now Playing. */
const UP_NEXT_PREVIEW_COUNT = 6;

type UpNextProps = {
  /** Upcoming queue tracks in the CURRENT playback order (after the playing track). */
  tracks: readonly Track[];
  /** Called with the index within `tracks` when a row is tapped. */
  onSelectTrack: (index: number) => void;
};

/**
 * Home "Up next for you" preview of the real PlayerController queue.
 *
 * The tracks are derived from the player snapshot's queue (already the
 * effective, shuffle-aware playback order) — this section never owns a
 * queue of its own, so next/previous/shuffle/queue changes show up here
 * immediately. Tapping a row jumps to that queue position through the
 * existing `playAt` queue logic. Renders nothing when no queue is active.
 */
export function UpNext({ tracks, onSelectTrack }: UpNextProps) {
  if (tracks.length === 0) return null;

  const displayedTracks = tracks.slice(0, UP_NEXT_PREVIEW_COUNT);

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Up next for you</Text>
      </View>

      <View style={styles.list}>
        {displayedTracks.map((track, index) => (
          <Pressable
            key={`${track.origin ?? 'unknown'}:${track.id}:${index}`}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => onSelectTrack(index)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${track.title} by ${track.artist} from Up Next`}
          >
            <ArtworkPlaceholder track={track} size={ROW_ARTWORK} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heading: {
    fontSize: 17,
    fontWeight: '600',
    color: homeColors.text,
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: homeRadius.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surface,
  },
  rowPressed: {
    opacity: 0.6,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
});
