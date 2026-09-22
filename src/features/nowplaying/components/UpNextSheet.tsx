import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  FlatList,
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

type UpNextSheetProps = {
  visible: boolean;
  currentTrack: Track | null;
  upcomingTracks: readonly Track[];
  queueIndex: number;
  onClose: () => void;
  onSelectTrack: (absoluteIndex: number) => void;
};

/**
 * Slide-up Bottom Sheet Modal for the Up Next queue matching YouTube Music.
 *
 * Smooth, single-source 60fps slide animation without modal animation flicker.
 */
export function UpNextSheet({
  visible,
  currentTrack,
  upcomingTracks,
  queueIndex,
  onClose,
  onSelectTrack,
}: UpNextSheetProps) {
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
          accessibilityLabel="Dismiss Up Next queue"
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
          {/* Top handle bar with Drag PanResponder */}
          <View style={styles.dragHandleArea} {...panResponder.panHandlers}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* YouTube Music Tab Bar Header */}
            <View style={styles.tabHeader}>
              <View style={styles.tabItemActive}>
                <Text style={styles.tabTextActive}>UP NEXT</Text>
                <View style={styles.tabIndicator} />
              </View>
              <Pressable
                style={styles.closeButton}
                onPress={handleDismiss}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close queue"
              >
                <Ionicons name="close" size={20} color={homeColors.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* Currently playing header banner if exists */}
          {currentTrack ? (
            <View style={styles.playingHeader}>
              <Text style={styles.playingFromLabel}>
                Playing now • <Text style={styles.playingTrackTitle}>{currentTrack.title}</Text>
              </Text>
            </View>
          ) : null}

          {/* Queue List */}
          {upcomingTracks.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Queue is empty</Text>
              <Text style={styles.emptySubtitle}>Play or add more songs to build your queue.</Text>
            </View>
          ) : (
            <FlatList
              data={upcomingTracks}
              keyExtractor={(item, index) => `${item.origin ?? 'unknown'}:${item.id}:${index}`}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => {
                const absoluteIndex = queueIndex + 1 + index;
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => {
                      onSelectTrack(absoluteIndex);
                      handleDismiss();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Play ${item.title} by ${item.artist}`}
                  >
                    <View style={styles.artwork}>
                      <ArtworkPlaceholder track={item} size={44} />
                    </View>
                    <View style={styles.meta}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.rowArtist} numberOfLines={1}>
                        {item.artist}
                        {item.album ? ` • ${item.album}` : ''}
                      </Text>
                    </View>
                    {/* YouTube Music style drag handle (=) */}
                    <Ionicons name="reorder-two-outline" size={22} color={homeColors.textMuted} />
                  </Pressable>
                );
              }}
            />
          )}
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
    maxHeight: '80%',
    backgroundColor: 'rgba(18, 18, 24, 0.94)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'transparent',
    borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
  dragHandleArea: {
    paddingBottom: 4,
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
  tabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  tabItemActive: {
    paddingBottom: 10,
    position: 'relative',
  },
  tabTextActive: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#ffffff',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#4cc9f0',
    borderRadius: 1.5,
    shadowColor: '#4cc9f0',
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: 8,
  },
  playingHeader: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderBottomWidth: 1,
    borderBottomColor: homeColors.border,
  },
  playingFromLabel: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  playingTrackTitle: {
    color: homeColors.text,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: homeRadius.surface,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  rowArtist: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: homeColors.textMuted,
  },
  emptySubtitle: {
    fontSize: 13,
    color: homeColors.textFaint,
  },
});
