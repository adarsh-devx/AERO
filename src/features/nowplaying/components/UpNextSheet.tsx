import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
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
import type { QueueRemoval } from '../../../playback/PlayerController';
import { ArtworkPlaceholder } from '../../home/components/ArtworkPlaceholder';
import { homeColors, homeRadius } from '../../home/theme';

/**
 * Swipe-to-remove thresholds — the same numbers as the MiniPlayer and
 * Now Playing artwork gestures (claim 16, commit 60, fast-flick 24/0.45).
 */
const SWIPE_CLAIM_DX = 16;
const SWIPE_COMMIT_DX = 60;
const SWIPE_FAST_DX = 24;
const SWIPE_COMMIT_VX = 0.45;
/** Finger travel while dragging is clamped here; commit flies out further. */
const SWIPE_MAX_DX = 140;
const SWIPE_EXIT_DX = 420;
/** How long the compact Undo affordance stays visible after a removal. */
const UNDO_VISIBLE_MS = 4500;

type UpNextSheetProps = {
  visible: boolean;
  currentTrack: Track | null;
  upcomingTracks: readonly Track[];
  queueIndex: number;
  onClose: () => void;
  onSelectTrack: (absoluteIndex: number) => void;
  /** Move a queue item between ABSOLUTE queue indices (step Move Up/Down now,
   * drag reorder later — same contract). */
  onMoveTrack: (fromAbsoluteIndex: number, toAbsoluteIndex: number) => void;
  /**
   * Remove an UPCOMING queue item by absolute queue index. Returns the
   * removal record (for Undo), or null when the controller refused it —
   * the current track is always refused, at the controller as well.
   */
  onRemoveTrack: (absoluteIndex: number) => QueueRemoval | null;
  /**
   * Restore a removed item at its EXACT former queue/source position.
   * Never starts playback and never changes the current track.
   */
  onRestoreTrack: (removal: QueueRemoval) => void;
  /** Clear every upcoming item; the current track is never touched. */
  onClearQueue: () => void;
};

type QueueRowProps = {
  item: Track;
  /** Absolute index in the effective queue (queueIndex + 1 + list index). */
  absoluteIndex: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: (absoluteIndex: number) => void;
  onMove: (fromAbsoluteIndex: number, toAbsoluteIndex: number) => void;
  /** Commit a removal; returns false when the controller refused it. */
  onRemove: (absoluteIndex: number) => boolean;
};

/**
 * One upcoming-queue row: local horizontal swipe-to-remove alongside the
 * existing tap / Move Up / Move Down / Remove controls.
 *
 * Gesture rules:
 * - NOTHING here reaches PlayerController while the finger moves — drag
 *   position lives in this row's own Animated value, so no publish and no
 *   re-render of unrelated rows happens per frame.
 * - The responder is claimed ONLY when movement is horizontal-dominant and
 *   past SWIPE_CLAIM_DX: vertical gestures keep scrolling the list normally.
 * - BOTH swipe directions remove (symmetric affordance), committed with the
 *   same distance/velocity numbers as the MiniPlayer/artwork gestures.
 * - The exit animation runs FIRST; the queue is mutated once, on commit.
 * - Only upcoming rows are rendered by the sheet (the CURRENT track is a
 *   non-interactive banner), so the playing item can never be swiped — and
 *   PlayerController.removeFromQueue refuses it anyway (authoritative).
 */
const QueueRow = memo(function QueueRow({
  item,
  absoluteIndex,
  canMoveUp,
  canMoveDown,
  onSelect,
  onMove,
  onRemove,
}: QueueRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const exitingRef = useRef(false);

  const settleBack = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      damping: 18,
      mass: 0.6,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // The inner Pressable owns the tap; this wrapper steals the touch
        // only once movement proves horizontal (the Pressable then gets
        // terminated and its onPress never fires).
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > SWIPE_CLAIM_DX &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderMove: (_, gestureState) => {
          // Local only: clamp + set on the Animated value. No setState, no
          // controller publish — zero React re-renders while dragging.
          translateX.setValue(
            Math.max(-SWIPE_MAX_DX, Math.min(SWIPE_MAX_DX, gestureState.dx)),
          );
        },
        onPanResponderRelease: (_, gestureState) => {
          const distance = Math.abs(gestureState.dx);
          const decisive =
            distance >= SWIPE_COMMIT_DX ||
            (distance >= SWIPE_FAST_DX &&
              Math.abs(gestureState.vx) >= SWIPE_COMMIT_VX);
          if (decisive && !exitingRef.current) {
            exitingRef.current = true;
            Animated.timing(translateX, {
              toValue: gestureState.dx >= 0 ? SWIPE_EXIT_DX : -SWIPE_EXIT_DX,
              duration: 170,
              useNativeDriver: true,
            }).start(({ finished }) => {
              if (finished && onRemove(absoluteIndex)) return;
              // Controller refused (defensive) or the animation was
              // interrupted: bring the row home, never leave it off-screen.
              exitingRef.current = false;
              translateX.setValue(0);
            });
          } else if (!exitingRef.current) {
            settleBack();
          }
        },
        onPanResponderTerminate: () => {
          if (exitingRef.current) return;
          settleBack();
        },
      }),
    [translateX, settleBack, onRemove, absoluteIndex],
  );

  // Subtle affordance: fades in symmetrically as the finger travels and is
  // strongest at the commit distance. No red/neon destructive treatment.
  const affordanceOpacity = translateX.interpolate({
    inputRange: [-SWIPE_EXIT_DX, -SWIPE_COMMIT_DX, 0, SWIPE_COMMIT_DX, SWIPE_EXIT_DX],
    outputRange: [1, 1, 0, 1, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.rowWrap} {...pan.panHandlers}>
      <Animated.View
        style={[styles.rowAffordance, { opacity: affordanceOpacity }]}
        pointerEvents="none"
      >
        <Ionicons name="close" size={20} color="#8e8e93" />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX }] }}>
        <Pressable
          style={({ pressed }) => [
            styles.row,
            pressed && styles.rowPressed,
          ]}
          onPress={() => onSelect(absoluteIndex)}
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
          <View style={styles.rowActions}>
            <Pressable
              style={styles.rowActionButton}
              disabled={!canMoveUp}
              hitSlop={6}
              onPress={(e) => {
                e.stopPropagation();
                onMove(absoluteIndex, absoluteIndex - 1);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.title} up`}
            >
              <Ionicons
                name="chevron-up"
                size={18}
                color={canMoveUp ? '#8e8e93' : 'rgba(255, 255, 255, 0.25)'}
              />
            </Pressable>
            <Pressable
              style={styles.rowActionButton}
              disabled={!canMoveDown}
              hitSlop={6}
              onPress={(e) => {
                e.stopPropagation();
                onMove(absoluteIndex, absoluteIndex + 1);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.title} down`}
            >
              <Ionicons
                name="chevron-down"
                size={18}
                color={canMoveDown ? '#8e8e93' : 'rgba(255, 255, 255, 0.25)'}
              />
            </Pressable>
            <Pressable
              style={styles.rowActionButton}
              hitSlop={6}
              onPress={(e) => {
                e.stopPropagation();
                onRemove(absoluteIndex);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.title} from queue`}
            >
              <Ionicons name="close" size={18} color="#8e8e93" />
            </Pressable>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
});

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
  onMoveTrack,
  onRemoveTrack,
  onRestoreTrack,
  onClearQueue,
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

  const handleDismiss = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(translateY, {
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  }, [onClose, translateY]);

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
    [handleDismiss, translateY],
  );

  // --- Undo (single pending item, never a stack) -------------------------
  // One record + one timer: a NEW removal deterministically REPLACES the
  // pending one (last removal wins), so the affordance can never show an
  // older record than the queue it belongs to.
  const [pendingUndo, setPendingUndo] = useState<{
    removal: QueueRemoval;
    title: string;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingUndo = useCallback(() => {
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setPendingUndo(null);
  }, []);

  const armUndo = useCallback((removal: QueueRemoval) => {
    if (undoTimerRef.current !== null) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null;
      setPendingUndo(null);
    }, UNDO_VISIBLE_MS);
    setPendingUndo({ removal, title: removal.track.title });
  }, []);

  // Never leave a timer (or a stale undo slot) behind when the screen
  // unmounts, and end the undo window deterministically on dismiss.
  useEffect(
    () => () => {
      if (undoTimerRef.current !== null) clearTimeout(undoTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!visible) clearPendingUndo();
  }, [visible, clearPendingUndo]);

  // Committed removal (swipe exit finished, or the accessible Remove
  // button): one call into the controller; the record arms Undo.
  const handleRemoveRow = useCallback(
    (absoluteIndex: number): boolean => {
      const removal = onRemoveTrack(absoluteIndex);
      if (removal === null) return false;
      armUndo(removal);
      return true;
    },
    [onRemoveTrack, armUndo],
  );

  const handleUndo = useCallback(() => {
    if (pendingUndo === null) return;
    onRestoreTrack(pendingUndo.removal);
    clearPendingUndo();
  }, [pendingUndo, onRestoreTrack, clearPendingUndo]);

  // Stable row callbacks: memoized rows must not re-render (and their
  // PanResponders must not be recreated) when the sheet re-renders.
  const handleSelectRow = useCallback(
    (absoluteIndex: number) => {
      onSelectTrack(absoluteIndex);
      handleDismiss();
    },
    [onSelectTrack, handleDismiss],
  );
  const handleMoveRow = useCallback(
    (fromAbsoluteIndex: number, toAbsoluteIndex: number) => {
      onMoveTrack(fromAbsoluteIndex, toAbsoluteIndex);
    },
    [onMoveTrack],
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
              <View style={styles.headerActions}>
                {upcomingTracks.length > 0 ? (
                  <Pressable
                    style={styles.clearButton}
                    onPress={onClearQueue}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear up next queue"
                  >
                    <Ionicons name="trash-outline" size={15} color={homeColors.textMuted} />
                    <Text style={styles.clearText}>Clear</Text>
                  </Pressable>
                ) : null}
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
          </View>

          {/* Currently playing header banner if exists */}
          {currentTrack ? (
            <View style={styles.playingHeader}>
              <Text style={styles.playingFromLabel} numberOfLines={1}>
                <Text style={styles.currentBadge}>CURRENT</Text>
                {' • '}
                <Text style={styles.playingTrackTitle}>{currentTrack.title}</Text>
              </Text>
            </View>
          ) : null}

          {/* Compact Undo affordance after a removal (single pending item,
              ~4.5 s, glass style of the sheet — no destructive styling). */}
          {pendingUndo !== null ? (
            <View style={styles.undoBar}>
              <Text style={styles.undoText} numberOfLines={1}>
                Removed {pendingUndo.title}
              </Text>
              <Pressable
                style={styles.undoButton}
                onPress={handleUndo}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Undo removal of ${pendingUndo.title}`}
              >
                <Text style={styles.undoButtonText}>UNDO</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Queue List */}
          {upcomingTracks.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>
                {currentTrack ? 'No more songs' : 'Queue is empty'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {currentTrack
                  ? 'Nothing is queued after the current track.'
                  : 'Play or add more songs to build your queue.'}
              </Text>
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
                  <QueueRow
                    item={item}
                    absoluteIndex={absoluteIndex}
                    // CURRENT stays pinned at the top of the sheet: the first
                    // upcoming row cannot move above it, later rows can.
                    canMoveUp={index > 0}
                    canMoveDown={index < upcomingTracks.length - 1}
                    onSelect={handleSelectRow}
                    onMove={handleMoveRow}
                    onRemove={handleRemoveRow}
                  />
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  clearText: {
    fontSize: 12,
    fontWeight: '600',
    color: homeColors.textMuted,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
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
  currentBadge: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#4cc9f0',
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
  rowWrap: {
    borderRadius: homeRadius.surface,
    overflow: 'hidden',
    position: 'relative',
  },
  rowAffordance: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  undoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginHorizontal: 24,
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: homeRadius.surface,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  undoText: {
    flex: 1,
    fontSize: 13,
    color: homeColors.textMuted,
  },
  undoButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#4cc9f0',
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
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rowActionButton: {
    padding: 6,
    borderRadius: 14,
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
