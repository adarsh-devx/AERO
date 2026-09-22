import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation';
import type { Playlist } from './types';
import { usePlaylists } from './usePlaylists';
import { PlaylistNameDialog } from './components/PlaylistNameDialog';
import { homeColors, homeRadius } from '../home/theme';

type PlaylistsScreenProps = NativeStackScreenProps<RootStackParamList, 'Playlists'>;

/** Asks for confirmation, then deletes the playlist. */
function confirmDelete(playlist: Playlist, onDelete: () => void): void {
  Alert.alert(`Delete "${playlist.name}"?`, 'This playlist and its track list will be removed.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onDelete },
  ]);
}

/**
 * Playlist list: all user playlists (newest first) with Create, plus
 * per-playlist Rename/Delete. Delete requires confirmation; editing
 * uses the shared name dialog. No swipe gestures yet.
 */
export function PlaylistsScreen({ navigation }: PlaylistsScreenProps) {
  const insets = useSafeAreaInsets();
  const { playlists, createPlaylist, renamePlaylist, deletePlaylist } = usePlaylists();
  const [createVisible, setCreateVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Playlist | null>(null);

  return (
    <View style={styles.container}>
      <FlatList
        data={playlists}
        keyExtractor={(playlist) => playlist.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <Pressable
            style={({ pressed }) => [styles.createButton, pressed && styles.rowPressed]}
            onPress={() => setCreateVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Create playlist"
          >
            <Text style={styles.createText}>+ Create Playlist</Text>
          </Pressable>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No playlists yet</Text>
            <Text style={styles.emptyHint}>Create a playlist to organize your music.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.playlistCard}>
            <Pressable
              style={({ pressed }) => [styles.playlistMain, pressed && styles.rowPressed]}
              onPress={() => navigation.navigate('Playlist', { playlistId: item.id })}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name}`}
            >
              <Text style={styles.playlistName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.playlistCount}>
                {item.tracks.length} {item.tracks.length === 1 ? 'song' : 'songs'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.editButton}
              onPress={() => setRenameTarget(item)}
              accessibilityRole="button"
              accessibilityLabel={`Rename ${item.name}`}
              hitSlop={8}
            >
              <Text style={styles.editText}>Rename</Text>
            </Pressable>
            <Pressable
              style={styles.editButton}
              onPress={() => confirmDelete(item, () => deletePlaylist(item.id))}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.name}`}
              hitSlop={8}
            >
              <Text style={[styles.editText, styles.deleteText]}>Delete</Text>
            </Pressable>
          </View>
        )}
      />

      <PlaylistNameDialog
        visible={createVisible}
        mode="create"
        title="New playlist"
        confirmLabel="Create"
        onConfirm={(name) => {
          createPlaylist(name);
          setCreateVisible(false);
        }}
        onCancel={() => setCreateVisible(false)}
      />
      <PlaylistNameDialog
        visible={renameTarget !== null}
        mode="rename"
        initialName={renameTarget?.name ?? ''}
        title="Rename playlist"
        confirmLabel="Rename"
        onConfirm={(name) => {
          if (renameTarget) renamePlaylist(renameTarget.id, name);
          setRenameTarget(null);
        }}
        onCancel={() => setRenameTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: homeColors.background,
  },
  createButton: {
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: homeRadius.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surface,
    alignItems: 'center',
  },
  createText: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  playlistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: homeRadius.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surface,
    gap: 10,
  },
  playlistMain: {
    flex: 1,
    gap: 2,
  },
  playlistName: {
    fontSize: 16,
    fontWeight: '600',
    color: homeColors.text,
  },
  playlistCount: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
  editButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  editText: {
    fontSize: 13,
    fontWeight: '500',
    color: homeColors.textMuted,
  },
  deleteText: {
    color: '#c96a6a',
  },
  rowPressed: {
    opacity: 0.6,
  },
  empty: {
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
});
