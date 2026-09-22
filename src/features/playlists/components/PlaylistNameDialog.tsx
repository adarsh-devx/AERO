import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEffect, useState } from 'react';

import { homeColors, homeRadius } from '../../home/theme';

type PlaylistNameDialogProps = {
  visible: boolean;
  /** 'create' shows a fresh input; 'rename' pre-fills with initialName. */
  mode: 'create' | 'rename';
  initialName?: string;
  title: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

/**
 * Minimal name-input dialog for playlist create/rename. Dependency-free
 * (RN Modal + TextInput); blank input is rejected by the caller via
 * normalizePlaylistName, and the confirm button is disabled when the
 * trimmed input is empty.
 */
export function PlaylistNameDialog({
  visible,
  mode,
  initialName = '',
  title,
  confirmLabel,
  onConfirm,
  onCancel,
}: PlaylistNameDialogProps) {
  const [name, setName] = useState(initialName);

  // Reset the input each time the dialog opens (fresh value for create,
  // pre-filled value for rename).
  useEffect(() => {
    if (visible) {
      setName(mode === 'rename' ? initialName : '');
    }
  }, [visible, mode, initialName]);

  const trimmed = name.trim();
  const canConfirm = trimmed.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Playlist name"
            placeholderTextColor={homeColors.textFaint}
            autoFocus
            selectTextOnFocus
            maxLength={80}
          />
          <View style={styles.actions}>
            <Pressable style={styles.button} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.confirmButton, !canConfirm && styles.disabled]}
              disabled={!canConfirm}
              onPress={() => onConfirm(trimmed)}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    backgroundColor: homeColors.surfaceRaised,
    borderRadius: homeRadius.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    padding: 20,
    gap: 14,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: homeColors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: homeColors.border,
    borderRadius: homeRadius.artwork,
    backgroundColor: homeColors.surface,
    color: homeColors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: homeRadius.artwork,
  },
  confirmButton: {
    backgroundColor: homeColors.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  disabled: {
    opacity: 0.4,
  },
  cancelText: {
    fontSize: 14,
    color: homeColors.textMuted,
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.text,
  },
});
