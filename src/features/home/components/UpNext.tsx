import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '../../../core/types/track';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { NextIcon, PauseIcon, PlayIcon } from './Icons';
import { homeColors, homeRadius, mutedText } from '../theme';

const ROW_ARTWORK = 48;

type UpNextProps = {
  track: Track;
  /** Whether the demo row shows a paused (play) or active (pause) state. */
  isPlaying: boolean;
  onTogglePlay: () => void;
};

/**
 * Section header ("Up next for you" + subtle See all) and a single
 * compact upcoming-track row with play/pause and next actions.
 */
export function UpNext({ track, isPlaying, onTogglePlay }: UpNextProps) {
  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Up next for you</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See all upcoming"
          onPress={() => {
            /* Queue list is a future feature (PRD §10) — placeholder. */
          }}
        >
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <ArtworkPlaceholder track={track} size={ROW_ARTWORK} />
        <View style={styles.meta}>
          <Text style={mutedText.title} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={mutedText.subtitle} numberOfLines={1}>
            {track.artist}
          </Text>
        </View>
        <Pressable
          style={styles.control}
          onPress={onTogglePlay}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
        </Pressable>
        <Pressable
          style={styles.control}
          accessibilityRole="button"
          accessibilityLabel="Next track"
          onPress={() => {
            /* Queue advancement arrives with the playback engine. */
          }}
        >
          <NextIcon size={12} />
        </Pressable>
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
  seeAll: {
    fontSize: 13,
    fontWeight: '500',
    color: homeColors.textMuted,
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
  meta: {
    flex: 1,
    gap: 2,
  },
  control: {
    width: 36,
    height: 36,
    borderRadius: homeRadius.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
