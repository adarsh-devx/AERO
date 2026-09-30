import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
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
import { trackIdentityKey, trackOrigin } from '../../../core/types/track';
import { ArtworkPlaceholder } from '../../home/components/ArtworkPlaceholder';
import { homeColors, homeRadius } from '../../home/theme';
import { playerController } from '../../../services/composition';
import { useDownloads } from '../../downloads/useDownloads';
import { useSleepTimer } from '../../player/useSleepTimer';

type OptionsMenuSheetProps = {
  visible: boolean;
  track: Track | null;
  onClose: () => void;
  onShowAudioInfo?: () => void;
  /**
   * Opens the Sleep Timer sheet. Optional: the Sleep Timer row only renders
   * where a host provides it (Now Playing), because the timer is player-
   * level state and its sheet lives there — per-track surfaces that don't
   * host the sheet don't show the row.
   */
  onShowSleepTimer?: () => void;
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
  onShowAudioInfo,
  onShowSleepTimer,
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

  // Hooks first, unconditionally: download state subscribes here, BEFORE
  // the null-track early return (calling hooks after a conditional return
  // crashes the sheet the first time it opens).
  const { isDownloaded, getActivity, downloadTrack, cancelDownload, removeDownload } =
    useDownloads();
  // Sleep-timer status for the row label — subscribes to the ONE timer store
  // (hooks must run before the null-track early return below).
  const sleepTimerSnapshot = useSleepTimer();

  if (!track) return null;

  const downloaded = isDownloaded(track);
  const activity = getActivity(track);
  const isDownloading = activity?.status === 'downloading';
  const isQueued = activity?.status === 'queued';
  const downloadFailed = activity?.status === 'failed';
  const downloadPercent =
    activity?.status === 'downloading' && activity.totalBytes > 0
      ? Math.round(activity.progress * 100)
      : null;
  // MediaStore tracks already live on the device — downloading one would
  // just duplicate it, so the action is not offered for them.
  const canDownload = trackOrigin(track) === 'online';

  // Is this track an UPCOMING item of the active queue? Identity-aware
  // (origin:id), so a `local:X` can never be removed through an `online:X`
  // row, and the currently playing item is never a removal candidate — the
  // row only appears where "Remove from queue" is semantically true.
  const playerSnapshot = playerController.getSnapshot();
  const queuedIndex = playerSnapshot.queue.findIndex(
    (queuedTrack, i) =>
      i !== playerSnapshot.queueIndex &&
      trackIdentityKey(queuedTrack) === trackIdentityKey(track),
  );
  const isUpcomingInQueue = queuedIndex >= 0;

  // Concise sleep-timer status per product spec: inactive → plain label,
  // active → "Sleep Timer · 27 min" / "Sleep Timer · End of track".
  const sleepTimerRowLabel =
    sleepTimerSnapshot.mode === 'duration' && sleepTimerSnapshot.remainingMs !== null
      ? `Sleep Timer · ${Math.max(1, Math.ceil(sleepTimerSnapshot.remainingMs / 60_000))} min`
      : sleepTimerSnapshot.mode === 'end-of-track'
        ? 'Sleep Timer · End of track'
        : 'Sleep Timer';

  // One action per state, never contradictory: Downloaded → Delete,
  // Downloading → Cancel (with live percent), Queued → Cancel (waiting
  // for a slot or a retry backoff), Failed → Retry, else Download.
  const downloadLabel = downloaded
    ? 'Downloaded'
    : isDownloading
      ? downloadPercent !== null
        ? `Cancel • ${downloadPercent}%`
        : 'Cancel download'
      : isQueued
        ? 'Cancel • Waiting'
        : downloadFailed
          ? 'Retry'
          : 'Download';

  const downloadIcon = downloaded
    ? 'checkmark-circle'
    : isDownloading
      ? 'close-circle-outline'
      : isQueued
        ? 'time-outline'
        : downloadFailed
          ? 'refresh-outline'
          : 'arrow-down-circle-outline';

  const downloadColor = downloaded || isDownloading || isQueued
    ? '#4cc9f0'
    : downloadFailed
      ? '#ff4d6d'
      : homeColors.text;

  const handleToggleDownload = () => {
    if (!track) return;
    if (downloaded) {
      // Remove download: file deleted, then entry — UI follows the store.
      removeDownload(track);
    } else if (isDownloading || isQueued) {
      // Tapping an in-flight download cancels it — active: partial file
      // cleaned up natively; queued: dropped from the queue immediately.
      cancelDownload(track);
    } else {
      // Idle or failed → (re)start; startDownload joins any in-flight op.
      downloadTrack(track);
    }
  };

  const handleAddToQueue = () => {
    playerController.addToQueue(track);
    handleDismiss();
  };

  const handleDismissQueue = () => {
    playerController.clearUpcomingQueue();
    handleDismiss();
  };

  const handleRemoveFromQueue = () => {
    // Re-read at press time: the index may have shifted since this render.
    const snapshot = playerController.getSnapshot();
    const index = snapshot.queue.findIndex(
      (queuedTrack, i) =>
        i !== snapshot.queueIndex &&
        trackIdentityKey(queuedTrack) === trackIdentityKey(track),
    );
    if (index >= 0) playerController.removeFromQueue(index);
    handleDismiss();
  };

  const handleSleepTimer = () => {
    // Real sleep timer lives in its own sheet (SleepTimerSheet) driven by
    // the ONE SleepTimer store — this row only opens it after this menu
    // dismisses. No raw setTimeout, no direct playback control here.
    handleDismiss();
    if (onShowSleepTimer) onShowSleepTimer();
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

            {/* Header: Artwork, Title, Artist, Close (✕) */}
            <View style={styles.header}>
              <View style={styles.artwork}>
                <ArtworkPlaceholder track={track} size={44} />
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
                <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.75)" />
              </Pressable>
            </View>
          </View>

          {/* Action List Rows (Floating Liquid Glass Capsules) */}
          <View style={styles.menuList}>
            {/* 1. Add to queue */}
            <Pressable
              style={({ pressed }) => [styles.glassPill, pressed && styles.glassPillPressed]}
              onPress={handleAddToQueue}
              accessibilityRole="button"
              accessibilityLabel="Add to queue"
            >
              <View style={styles.iconCircle}>
                <Ionicons name="list" size={18} color="#ffffff" />
              </View>
              <Text style={styles.pillText}>Add to queue</Text>
              <Ionicons name="chevron-forward" size={16} color="rgba(255, 255, 255, 0.45)" />
            </Pressable>

            {/* 2. Download */}
            {canDownload ? (
              <Pressable
                style={({ pressed }) => [styles.glassPill, pressed && styles.glassPillPressed]}
                onPress={handleToggleDownload}
                accessibilityRole="button"
                accessibilityLabel={
                  downloaded
                    ? 'Remove download'
                    : isDownloading
                      ? 'Cancel download'
                      : isQueued
                        ? 'Cancel queued download'
                        : downloadFailed
                          ? 'Retry download'
                          : 'Download track'
                }
              >
                <View
                  style={[
                    styles.iconCircle,
                    downloaded && { backgroundColor: 'rgba(76, 201, 240, 0.18)', borderColor: 'rgba(76, 201, 240, 0.4)' },
                    downloadFailed && { backgroundColor: 'rgba(255, 77, 109, 0.18)', borderColor: 'rgba(255, 77, 109, 0.4)' },
                  ]}
                >
                  <Ionicons
                    name={downloadIcon}
                    size={18}
                    color={downloadColor !== homeColors.text ? downloadColor : '#ffffff'}
                  />
                </View>
                <Text
                  style={[
                    styles.pillText,
                    downloadColor !== homeColors.text && { color: downloadColor },
                  ]}
                >
                  {downloadLabel}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255, 255, 255, 0.45)" />
              </Pressable>
            ) : null}

            {/* 3. Remove from queue */}
            {isUpcomingInQueue ? (
              <Pressable
                style={({ pressed }) => [styles.glassPill, pressed && styles.glassPillPressed]}
                onPress={handleRemoveFromQueue}
                accessibilityRole="button"
                accessibilityLabel="Remove from queue"
              >
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(255, 77, 77, 0.15)', borderColor: 'rgba(255, 77, 77, 0.35)' }]}>
                  <Ionicons name="remove-circle-outline" size={18} color="#ff4d4d" />
                </View>
                <Text style={[styles.pillText, { color: '#ff4d4d' }]}>Remove from queue</Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255, 77, 77, 0.45)" />
              </Pressable>
            ) : null}

            {/* 4. Audio & Source Info */}
            <Pressable
              style={({ pressed }) => [styles.glassPill, pressed && styles.glassPillPressed]}
              onPress={() => {
                handleDismiss();
                if (onShowAudioInfo) onShowAudioInfo();
              }}
              accessibilityRole="button"
              accessibilityLabel="Audio and source information"
            >
              <View style={styles.iconCircle}>
                <Ionicons name="information" size={18} color="#ffffff" />
              </View>
              <Text style={styles.pillText}>Audio &amp; source info</Text>
              <Ionicons name="chevron-forward" size={16} color="rgba(255, 255, 255, 0.45)" />
            </Pressable>

            {/* 5. Go to artist */}
            <Pressable
              style={({ pressed }) => [styles.glassPill, pressed && styles.glassPillPressed]}
              onPress={() => {
                handleDismiss();
                if (onGoToArtist && track.artist) {
                  onGoToArtist(track.artist);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Go to artist"
            >
              <View style={styles.iconCircle}>
                <Ionicons name="person-outline" size={18} color="#ffffff" />
              </View>
              <Text style={styles.pillText}>Go to artist</Text>
              <Ionicons name="chevron-forward" size={16} color="rgba(255, 255, 255, 0.45)" />
            </Pressable>

            {/* 6. Sleep Timer */}
            {onShowSleepTimer ? (
              <Pressable
                style={({ pressed }) => [styles.glassPill, pressed && styles.glassPillPressed]}
                onPress={handleSleepTimer}
                accessibilityRole="button"
                accessibilityLabel={sleepTimerRowLabel}
              >
                <View style={styles.iconCircle}>
                  <Ionicons name="moon-outline" size={18} color="#ffffff" />
                </View>
                <Text style={styles.pillText}>Sleep Timer</Text>
                {sleepTimerSnapshot.mode !== null ? (
                  <View style={styles.timerPill}>
                    <Text style={styles.timerPillText}>{sleepTimerRowLabel.replace('Sleep Timer · ', '')}</Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color="rgba(255, 255, 255, 0.45)" />
                )}
              </Pressable>
            ) : null}

            {/* 7. Dismiss queue (Destructive Red Glass Pill) */}
            <Pressable
              style={({ pressed }) => [styles.glassPill, styles.destructivePill, pressed && styles.destructivePillPressed]}
              onPress={handleDismissQueue}
              accessibilityRole="button"
              accessibilityLabel="Dismiss queue"
            >
              <View style={styles.destructiveIconCircle}>
                <Ionicons name="trash-outline" size={18} color="#ff4d4d" />
              </View>
              <Text style={[styles.pillText, { color: '#ff5c5c' }]}>Dismiss queue</Text>
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
    backgroundColor: 'rgba(18, 18, 26, 0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.32)',
    borderBottomColor: 'transparent',
    borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 8,
    paddingHorizontal: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.7,
    shadowRadius: 24,
    elevation: 25,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  artwork: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#181822',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  artist: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuList: {
    paddingVertical: 4,
    gap: 7,
  },
  glassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 22,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.32)',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderLeftColor: 'rgba(255, 255, 255, 0.12)',
    borderRightColor: 'rgba(255, 255, 255, 0.12)',
  },
  glassPillPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderTopColor: 'rgba(255, 255, 255, 0.55)',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginLeft: 12,
    letterSpacing: -0.2,
  },
  destructivePill: {
    marginTop: 4,
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    borderTopColor: 'rgba(255, 99, 71, 0.45)',
    borderBottomColor: 'rgba(255, 59, 48, 0.08)',
    borderLeftColor: 'rgba(255, 59, 48, 0.18)',
    borderRightColor: 'rgba(255, 59, 48, 0.18)',
  },
  destructivePillPressed: {
    backgroundColor: 'rgba(255, 59, 48, 0.22)',
  },
  destructiveIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 59, 48, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 99, 71, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(76, 201, 240, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(76, 201, 240, 0.3)',
  },
  timerPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4cc9f0',
  },
});
