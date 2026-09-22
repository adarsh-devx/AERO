import { useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '../../../core/types/track';
import { ArtworkPlaceholder } from '../../home/components/ArtworkPlaceholder';
import { homeColors, homeRadius } from '../../home/theme';
import { playerController } from '../../../services/composition';
import { useDownloads } from '../../downloads/useDownloads';

type OptionsMenuSheetProps = {
  visible: boolean;
  track: Track | null;
  onClose: () => void;
  onSaveToPlaylist: () => void;
  onGoToArtist?: (artistName: string) => void;
};

/**
 * YouTube Music style 3-Dots Options Menu Bottom Sheet.
 *
 * Smooth 60fps single-source slide animation without glitching.
 */
export function OptionsMenuSheet({
  visible,
  track,
  onClose,
  onSaveToPlaylist,
  onGoToArtist,
}: OptionsMenuSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(600)).current;
  const isClosingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      translateY.setValue(600);
      Animated.spring(translateY, {
        toValue: 0,
        damping: 24,
        mass: 0.8,
        stiffness: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const handleDismiss = () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(translateY, {
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            translateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 80 || gestureState.vy > 0.4) {
            handleDismiss();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              damping: 20,
              mass: 0.8,
              stiffness: 200,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [translateY],
  );

  if (!track) return null;

  const { isDownloaded, downloadTrack, removeDownload } = useDownloads();
  const downloaded = track ? isDownloaded(track) : false;

  const handleToggleDownload = () => {
    if (!track) return;
    if (downloaded) {
      removeDownload(track);
    } else {
      downloadTrack(track);
    }
  };

  const handlePlayNext = () => {
    playerController.playNextTrack(track);
    handleDismiss();
  };

  const handleAddToQueue = () => {
    playerController.addToQueue(track);
    handleDismiss();
  };

  const handleDismissQueue = () => {
    playerController.clearUpcomingQueue();
    handleDismiss();
  };

  const handleSleepTimer = () => {
    handleDismiss();
    Alert.alert('Sleep Timer', 'Choose duration:', [
      { text: '15 Minutes', onPress: () => setTimeout(() => void playerController.stop(), 15 * 60 * 1000) },
      { text: '30 Minutes', onPress: () => setTimeout(() => void playerController.stop(), 30 * 60 * 1000) },
      { text: '1 Hour', onPress: () => setTimeout(() => void playerController.stop(), 60 * 60 * 1000) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleDismiss}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropTouch}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss options menu"
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Top handle area with PanResponder */}
          <View {...panResponder.panHandlers}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* Header: Artwork, Title, Artist, Close (✕) - NO Like button */}
            <View style={styles.header}>
              <View style={styles.artwork}>
                <ArtworkPlaceholder track={track} size={48} />
              </View>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={1}>
                  {track.title}
                </Text>
                <Text style={styles.artist} numberOfLines={1}>
                  {track.artist}
                  {track.album ? ` • ${track.album}` : ''}
                </Text>
              </View>
              <Pressable
                style={styles.closeButton}
                onPress={handleDismiss}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={homeColors.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* Quick Action Tiles */}
          <View style={styles.tilesContainer}>
            <Pressable
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={handlePlayNext}
              accessibilityRole="button"
              accessibilityLabel="Play next"
            >
              <Ionicons name="play-forward-outline" size={22} color={homeColors.text} />
              <Text style={styles.tileText}>Play next</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={handleToggleDownload}
              accessibilityRole="button"
              accessibilityLabel={downloaded ? 'Remove download' : 'Download track'}
            >
              <Ionicons
                name={downloaded ? 'checkmark-circle' : 'arrow-down-circle-outline'}
                size={22}
                color={downloaded ? '#4cc9f0' : homeColors.text}
              />
              <Text style={[styles.tileText, downloaded && { color: '#4cc9f0' }]}>
                {downloaded ? 'Downloaded' : 'Download'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={() => {
                handleDismiss();
                onSaveToPlaylist();
              }}
              accessibilityRole="button"
              accessibilityLabel="Save to playlist"
            >
              <Ionicons name="bookmark-outline" size={22} color={homeColors.text} />
              <Text style={styles.tileText}>Save</Text>
            </Pressable>
          </View>

          {/* Action List Rows */}
          <View style={styles.menuList}>
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              onPress={handleAddToQueue}
              accessibilityRole="button"
              accessibilityLabel="Add to queue"
            >
              <Ionicons name="list-outline" size={22} color={homeColors.textMuted} style={styles.menuIcon} />
              <Text style={styles.menuText}>Add to queue</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              onPress={() => {
                handleDismiss();
                if (onGoToArtist && track.artist) {
                  onGoToArtist(track.artist);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Go to artist"
            >
              <Ionicons name="person-outline" size={22} color={homeColors.textMuted} style={styles.menuIcon} />
              <Text style={styles.menuText}>Go to artist</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              onPress={handleDismissQueue}
              accessibilityRole="button"
              accessibilityLabel="Dismiss queue"
            >
              <Ionicons name="trash-outline" size={22} color={homeColors.textMuted} style={styles.menuIcon} />
              <Text style={styles.menuText}>Dismiss queue</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              onPress={handleSleepTimer}
              accessibilityRole="button"
              accessibilityLabel="Sleep timer"
            >
              <Ionicons name="moon-outline" size={22} color={homeColors.textMuted} style={styles.menuIcon} />
              <Text style={styles.menuText}>Sleep timer</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: 'rgba(18, 18, 24, 0.94)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'transparent',
    borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 8,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  artwork: {
    width: 48,
    height: 48,
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
    fontSize: 16,
    fontWeight: '700',
    color: homeColors.text,
  },
  artist: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  tilesContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: homeColors.border,
  },
  tile: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: homeRadius.surface,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  tilePressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  tileText: {
    fontSize: 12,
    fontWeight: '600',
    color: homeColors.text,
  },
  menuList: {
    paddingVertical: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: homeRadius.surface,
  },
  menuRowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  menuIcon: {
    width: 32,
  },
  menuText: {
    fontSize: 15,
    fontWeight: '500',
    color: homeColors.text,
  },
});
