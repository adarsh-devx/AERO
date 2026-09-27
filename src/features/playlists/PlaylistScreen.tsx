import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../navigation';
import type { Track } from '../../core/types/track';
import { getTrackArtworkUri, trackIdentityKey } from '../../core/types/track';
import { playerController } from '../../services/composition';
import { usePlayerSelector } from '../../playback/usePlayerSelector';
import { usePlaylists } from './usePlaylists';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { homeColors, homeRadius } from '../home/theme';
import { OptionsMenuSheet } from '../nowplaying/components/OptionsMenuSheet';
import { AddToPlaylistSheet } from './components/AddToPlaylistSheet';
import { AddTracksSheet } from './components/AddTracksSheet';
import { PlaylistNameDialog } from './components/PlaylistNameDialog';

type PlaylistScreenProps = NativeStackScreenProps<RootStackParamList, 'Playlist'>;

/**
 * A single playlist: derived cover, name, track count, Play / Shuffle and
 * Add Tracks / Rename / Delete actions over the one persisted playlists
 * store.
 *
 * Playback always delegates to PlayerController: Play and row taps call
 * playFromQueue (the playlist is the queue context; the tapped track is the
 * start index), Shuffle uses the existing shuffle mechanism only. Playlist
 * edits (add/remove/reorder/rename/delete) mutate playlist membership — never
 * the active queue — so currently playing audio is untouched by any edit.
 */
export function PlaylistScreen({ route, navigation }: PlaylistScreenProps) {
  const insets = useSafeAreaInsets();
  const { playlistId } = route.params;
  const { hydrated, getPlaylist, removeTrack, moveTrack, renamePlaylist, deletePlaylist } =
    usePlaylists();
  const playlist = getPlaylist(playlistId);
  // Shared track options menu — the same sheet Search/Home/Library use, so
  // "Play next" / "Add to queue" hit the ONE PlayerController queue.
  const [optionsTrack, setOptionsTrack] = useState<Track | null>(null);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [addTracksVisible, setAddTracksVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);

  // Shuffle reflects — and only ever uses — the ONE PlayerController's
  // shuffle state; there is no second shuffle state in this screen.
  // Selected as a single boolean: playback position ticks (~2x/s) can
  // never rebuild this screen — only a shuffle toggle can.
  const shuffleEnabled = usePlayerSelector((snapshot) => snapshot.shuffleEnabled);

  // Shared prewarm seam: the playlist's first playable online track is the most
  // likely tap (and what the Play button starts). Called before the early
  // returns so hook order is stable; a missing playlist simply offers nothing.
  usePrewarmTracks(playlist?.tracks);

  // The playlist is gone: deleted while this screen was open (another
  // screen, another edit), or the id never existed. Wait for hydration so a
  // pre-load absence is never mistaken for a deletion, then navigate away —
  // playback, downloads, liked songs and history are separate stores and
  // keep running untouched.
  useEffect(() => {
    if (hydrated && playlist === null && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [hydrated, playlist, navigation]);

  if (!hydrated) {
    // Storage load still in flight: honest loading state instead of flashing
    // "not found" for a playlist that is about to appear.
    return (
      <View style={[styles.container, styles.empty]}>
        <Text style={styles.emptyHint}>Loading playlist…</Text>
      </View>
    );
  }

  if (playlist === null) {
    // The effect above navigates back; keep this frame neutral meanwhile.
    return <View style={[styles.container, styles.empty]} />;
  }

  // Deterministic cover: first track in playlist order whose effective
  // artwork exists; otherwise the first track (ArtworkPlaceholder's
  // initial-letter fallback); an empty playlist gets the standard note tile.
  // Derived only — nothing is downloaded or stored for playlist artwork.
  const coverTrack =
    playlist.tracks.find((track) => getTrackArtworkUri(track)) ?? playlist.tracks[0];

  const handlePlay = (index: number) => {
    void playerController.playFromQueue(playlist.tracks, index);
  };

  const handleShuffle = () => {
    if (playlist.tracks.length === 0) return;
    // Load the playlist as the source queue first. playFromQueue publishes
    // the new current track synchronously, so the toggle below (only needed
    // when shuffle isn't already on) sees this playlist as its context —
    // the ordering itself is entirely PlayerController's existing Fisher-
    // Yates path, never re-implemented here.
    const shuffleWasEnabled = shuffleEnabled;
    void playerController.playFromQueue(playlist.tracks, 0);
    if (!shuffleWasEnabled) {
      void playerController.toggleShuffle();
    }
  };

  const handleDelete = () => {
    Alert.alert(`Delete "${playlist.name}"?`, 'This playlist and its track list will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          // Membership only: the active queue, downloads, liked songs and
          // history are not playlist state and are never modified here.
          deletePlaylist(playlist.id);
          if (navigation.canGoBack()) navigation.goBack();
        },
      },
    ]);
  };

  const isEmpty = playlist.tracks.length === 0;

  return (
    <View style={styles.container}>
      <FlatList
        data={playlist.tracks}
        keyExtractor={(track) => trackIdentityKey(track)}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <View style={styles.header}>
            {coverTrack ? (
              <ArtworkPlaceholder track={coverTrack} size={148} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverFallback]}>
                <Ionicons name="musical-note" size={56} color={homeColors.textFaint} />
              </View>
            )}
            <Text style={styles.playlistName}>{playlist.name}</Text>
            <Text style={styles.playlistCount}>
              {playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'}
            </Text>
            <View style={styles.controlsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.playButton,
                  pressed && styles.playPressed,
                  isEmpty && styles.controlDisabled,
                ]}
                disabled={isEmpty}
                onPress={() => handlePlay(0)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${playlist.name}`}
              >
                <Text style={styles.playText}>Play</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.playButton,
                  pressed && styles.playPressed,
                  isEmpty && styles.controlDisabled,
                ]}
                disabled={isEmpty}
                onPress={handleShuffle}
                accessibilityRole="button"
                accessibilityLabel={`Shuffle ${playlist.name}`}
              >
                <Text style={styles.playText}>Shuffle</Text>
              </Pressable>
            </View>
            <View style={styles.actionsRow}>
              <Pressable
                style={styles.actionButton}
                onPress={() => setAddTracksVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Add tracks to playlist"
                hitSlop={8}
              >
                <Text style={styles.actionText}>Add Tracks</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => setRenameVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Rename playlist"
                hitSlop={8}
              >
                <Text style={styles.actionText}>Rename</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete playlist"
                hitSlop={8}
              >
                <Text style={[styles.actionText, styles.actionDeleteText]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No songs yet</Text>
            <Text style={styles.emptyHint}>Add tracks from your library or search.</Text>
            <Pressable
              style={({ pressed }) => [styles.addCta, pressed && styles.playPressed]}
              onPress={() => setAddTracksVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Add tracks"
            >
              <Text style={styles.playText}>Add Tracks</Text>
            </Pressable>
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
              style={styles.itemMenuButton}
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation();
                setOptionsTrack(item);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Options for ${item.title}`}
            >
              <Ionicons name="ellipsis-vertical" size={18} color="#8e8e93" />
            </Pressable>
            <Pressable
              style={styles.reorderButton}
              disabled={index === 0}
              hitSlop={8}
              onPress={() => moveTrack(playlist.id, index, index - 1)}
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.title} up`}
            >
              <Ionicons
                name="chevron-up"
                size={18}
                color={index === 0 ? 'rgba(255, 255, 255, 0.25)' : '#8e8e93'}
              />
            </Pressable>
            <Pressable
              style={styles.reorderButton}
              disabled={index === playlist.tracks.length - 1}
              hitSlop={8}
              onPress={() => moveTrack(playlist.id, index, index + 1)}
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.title} down`}
            >
              <Ionicons
                name="chevron-down"
                size={18}
                color={
                  index === playlist.tracks.length - 1
                    ? 'rgba(255, 255, 255, 0.25)'
                    : '#8e8e93'
                }
              />
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

      {/* Track Options Sheet — queue actions mutate the one PlayerController queue */}
      <OptionsMenuSheet
        visible={optionsTrack !== null}
        track={optionsTrack}
        onClose={() => setOptionsTrack(null)}
        onGoToArtist={(artistName) => navigation.navigate('Artist', { artistName })}
      />
      <AddToPlaylistSheet
        visible={addToPlaylistVisible}
        track={optionsTrack}
        onClose={() => setAddToPlaylistVisible(false)}
      />
      {/* Reverse flow: pick tracks to append to THIS playlist (store only). */}
      <AddTracksSheet
        visible={addTracksVisible}
        playlist={playlist}
        onClose={() => setAddTracksVisible(false)}
      />
      <PlaylistNameDialog
        visible={renameVisible}
        mode="rename"
        initialName={playlist.name}
        title="Rename playlist"
        confirmLabel="Rename"
        onConfirm={(name) => {
          renamePlaylist(playlist.id, name);
          setRenameVisible(false);
        }}
        onCancel={() => setRenameVisible(false)}
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
  cover: {
    marginBottom: 10,
    borderRadius: homeRadius.artwork,
  },
  coverFallback: {
    backgroundColor: '#202020',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.06)',
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
  controlsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  playButton: {
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
  controlDisabled: {
    opacity: 0.4,
  },
  playText: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 14,
  },
  actionButton: {
    paddingVertical: 6,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '500',
    color: homeColors.textMuted,
  },
  actionDeleteText: {
    color: '#ff6b6b',
  },
  addCta: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surfaceRaised,
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
  reorderButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
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
  itemMenuButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
});
