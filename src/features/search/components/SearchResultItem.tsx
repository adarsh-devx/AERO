import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '../../../core/types/track';

interface SearchResultItemProps {
  track: Track;
  /** Minimal playback hook: pressing the row asks the parent to play this track. */
  onPlay?: (track: Track) => void;
}

/**
 * Single search result row: title + artist.
 * Pure presentational; receives a provider-independent Track only.
 * Playback is delegated upward via onPlay — no engine/provider logic here.
 */
export function SearchResultItem({ track, onPlay }: SearchResultItemProps) {
  const content = (
    <>
      <Text style={styles.title} numberOfLines={1}>
        {track.title}
      </Text>
      <Text style={styles.artist} numberOfLines={1}>
        {track.artist}
      </Text>
    </>
  );

  if (!onPlay) {
    return <View style={styles.item}>{content}</View>;
  }

  return (
    <Pressable
      style={styles.item}
      onPress={() => onPlay(track)}
      accessibilityRole="button"
      accessibilityLabel={`Play ${track.title} by ${track.artist}`}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#374151',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  artist: {
    marginTop: 2,
    fontSize: 13,
    color: '#9ca3af',
  },
});
