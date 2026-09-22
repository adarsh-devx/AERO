import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation';
import type { Track } from '../../core/types/track';
import { trackIdentityKey } from '../../core/types/track';
import { playerController } from '../../services/composition';
import { usePlaylists } from './usePlaylists';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { homeColors, homeRadius } from '../home/theme';

type PlaylistScreenProps = NativeStackScreenProps<RootStackParamList, 'Playlist'>;

/**
 * A single playlist: name, track count, Play action and the track list.
 * Tapping a track (or Play) starts playback through the existing
 * PlayerController with the playlist's tracks as the queue context.
 * Rows offer a per-track Remove control. If the playlist was deleted,
 * the screen falls back with an empty state.
 */
export function PlaylistScreen({ route }: PlaylistScreenProps) {
  const insets = useSafeAreaInsets();
  const { playlistId } = route.params;
  const { getPlaylist, removeTrack } = usePlaylists();
  const playlist = getPlaylist(playlistId);

  // Shared prewarm seam: the playlist's first playable online track is the most
  // likely tap (and what the Play button starts). Called before the not-found
  // return so hook order is stable; a missing playlist simply offers nothing.
  usePrewarmTracks(playlist?.tracks);

  if (playlist === null) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text style={styles.emptyTitle}>Playlist not found</Text>
        <Text style={styles.emptyHint}>It may have been deleted.</Text>
      </View>
    );
  }

  const handlePlay = (index: number) => {
    void playerController.playFromQueue(playlist.tracks, index);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={playlist.tracks}
        keyExtractor={(track) => trackIdentityKey(track)}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.playlistName}>{playlist.name}</Text>
            <Text style={styles.playlistCount}>
              {playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.playButton, pressed && styles.playPressed]}
              disabled={playlist.tracks.length === 0}
              onPress={() => handlePlay(0)}
              accessibilityRole="button"
              accessibilityLabel={`Play ${playlist.name}`}
            >
              <Text style={styles.playText}>Play</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No songs yet</Text>
            <Text style={styles.emptyHint}>Add songs from Now Playing.</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Pressable
              style={styles.rowMain}
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
            <Pressable
              style={styles.removeButton}
              onPress={() => removeTrack(playlist.id, item)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.title} from playlist`}
              hitSlop={8}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
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
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 6,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 4,
  },
  playlistName: {
    fontSize: 24,
    fontWeight: '700',
    color: homeColors.text,
  },
  playlistCount: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
  playButton: {
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surfaceRaised,
  },
  playPressed: {
    opacity: 0.6,
  },
  playText: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  emptyCard: {
    marginHorizontal: 20,
    marginTop: 16,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 8,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  removeButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  removeText: {
    fontSize: 13,
    fontWeight: '500',
    color: homeColors.textMuted,
  },
});
