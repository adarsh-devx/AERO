import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import type { Track } from '../../../core/types/track';
import { trackIdentityKey } from '../../../core/types/track';
import { usePlaylists } from '../usePlaylists';
import { PlaylistNameDialog } from './PlaylistNameDialog';
import { homeColors, homeRadius } from '../../home/theme';

type AddToPlaylistSheetProps = {
  visible: boolean;
  track: Track | null;
  onClose: () => void;
};

/**
 * Minimal playlist-selection sheet for "Add to playlist". Lists all
 * playlists (already-present tracks render as "Added") plus a
 * create-new-playlist flow. Selection never touches playback.
 */
export function AddToPlaylistSheet({ visible, track, onClose }: AddToPlaylistSheetProps) {
  const { playlists, addTrack, createPlaylist } = usePlaylists();
  const [createDialogVisible, setCreateDialogVisible] = useState(false);

  if (track === null) return null;

  const handleConfirmCreate = (name: string) => {
    const id = createPlaylist(name);
    if (id !== null) {
      addTrack(id, track);
    }
    setCreateDialogVisible(false);
    onClose();
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropTouch} onPress={onClose} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add to playlist</Text>
            {playlists.map((playlist) => {
              const alreadyAdded = playlist.tracks.some(
                (existing) => trackIdentityKey(existing) === trackIdentityKey(track),
              );
              return (
                <Pressable
                  key={playlist.id}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  disabled={alreadyAdded}
                  onPress={() => {
                    addTrack(playlist.id, track);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Add to ${playlist.name}`}
                >
                  <View style={styles.rowMeta}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {playlist.name}
                    </Text>
                    <Text style={styles.rowSubtitle}>
                      {playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'}
                    </Text>
                  </View>
                  {alreadyAdded && <Text style={styles.addedLabel}>Added</Text>}
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [styles.row, styles.createRow, pressed && styles.rowPressed]}
              onPress={() => setCreateDialogVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Create new playlist"
            >
              <Text style={styles.createText}>+ Create new playlist</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <PlaylistNameDialog
        visible={createDialogVisible}
        mode="create"
        title="New playlist"
        confirmLabel="Create"
        onConfirm={handleConfirmCreate}
        onCancel={() => setCreateDialogVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: homeColors.surfaceRaised,
    borderTopLeftRadius: homeRadius.surface,
    borderTopRightRadius: homeRadius.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 4,
  },
  sheetTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: homeColors.textMuted,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: homeRadius.artwork,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  rowMeta: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  rowSubtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  addedLabel: {
    fontSize: 12,
    color: homeColors.textFaint,
  },
  createRow: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: homeColors.border,
    borderRadius: 0,
  },
  createText: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
});
