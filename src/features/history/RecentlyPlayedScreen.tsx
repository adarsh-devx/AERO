import { useCallback, useEffect, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation';
import { playerController } from '../../services/composition';
import { usePlaybackHistory } from './usePlaybackHistory';
import { useSettings } from '../settings/useSettings';
import { dedupeNewestFirst } from '../../core/types/songKey';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import { homeColors, homeRadius } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';

type RecentlyPlayedScreenProps = NativeStackScreenProps<RootStackParamList, 'RecentlyPlayedHistory'>;

/**
 * Dedicated Recently Played History screen.
 *
 * Displays the playback history in a clean, full-width list — ONLY the
 * persisted PlaybackHistory store (real playback-start events), newest
 * first, deduplicated at DISPLAY time to one entry per canonical song
 * (the newest record's metadata wins; stored records are never rewritten
 * or reordered — the list stays strictly chronological). When "Save
 * listening history" is off, no personalized recent-play data is shown:
 * the existing empty state renders instead.
 *
 * Tapping any track starts playback from that index within the displayed
 * history queue.
 */
export function RecentlyPlayedScreen({ navigation }: RecentlyPlayedScreenProps) {
  const insets = useSafeAreaInsets();
  const history = usePlaybackHistory();
  const { playbackHistoryEnabled } = useSettings();

  // Display-only dedup: newest-first order preserved, one card per song.
  const displayHistory = useMemo(
    () => (playbackHistoryEnabled ? dedupeNewestFirst(history) : []),
    [history, playbackHistoryEnabled],
  );

  // Shared prewarm seam: the first entry's online track is the most likely tap.
  usePrewarmTracks(displayHistory);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: `Recently Played${displayHistory.length > 0 ? ` (${displayHistory.length})` : ''}`,
    });
  }, [navigation, displayHistory.length]);

  const handlePlay = useCallback(
    (index: number) => {
      void playerController.playFromQueue(displayHistory, index);
    },
    [displayHistory],
  );

  if (displayHistory.length === 0) {
    return (
      <View style={[styles.container, styles.emptyContainer, { paddingTop: 16 }]}>
        <Text style={styles.emptyTitle}>Nothing played yet</Text>
        <Text style={styles.emptySubtitle}>
          Tracks you play will show up here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Identity-only keys: the display list is identity-unique (the store
          identity-dedups on record, display dedups by song), so keys stay
          STABLE across prepends — an index suffix would remount every row
          on each new play. */}
      <FlatList
        data={displayHistory}
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
