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

            {/* Download — identical state machine (downloaded / downloading /
                queued / failed → delete / cancel / retry), now as a normal
                list row. Hidden for MediaStore tracks, as before. */}
            {canDownload ? (
              <Pressable
                style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
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
                <Ionicons name={downloadIcon} size={22} color={downloadColor} style={styles.menuIcon} />
                <Text
                  style={[
                    styles.menuText,
                    downloadColor !== homeColors.text && { color: downloadColor },
                  ]}
                >
                  {downloadLabel}
                </Text>
              </Pressable>
            ) : null}

            {isUpcomingInQueue ? (
              <Pressable
                style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
                onPress={handleRemoveFromQueue}
                accessibilityRole="button"
                accessibilityLabel="Remove from queue"
              >
                <Ionicons name="remove-circle-outline" size={22} color={homeColors.textMuted} style={styles.menuIcon} />
                <Text style={styles.menuText}>Remove from queue</Text>
              </Pressable>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              onPress={() => {
                handleDismiss();
                if (onShowAudioInfo) onShowAudioInfo();
              }}
              accessibilityRole="button"
              accessibilityLabel="Audio and source information"
            >
              <Ionicons name="information-circle-outline" size={22} color={homeColors.textMuted} style={styles.menuIcon} />
              <Text style={styles.menuText}>Audio &amp; source info</Text>
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
            {onShowSleepTimer ? (
              <Pressable
                style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
                onPress={handleSleepTimer}
                accessibilityRole="button"
                accessibilityLabel={sleepTimerRowLabel}
              >
                <Ionicons name="moon-outline" size={22} color={homeColors.textMuted} style={styles.menuIcon} />
                <Text style={styles.menuText}>{sleepTimerRowLabel}</Text>
              </Pressable>
            ) : null}
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
