import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../navigation';
import { trackOrigin, type Track } from '../../core/types/track';
import { playerController } from '../../services/composition';
import type { QueueRemoval } from '../../playback/PlayerController';
import { useLikedSongs } from '../liked/useLikedSongs';
import { useDownloads } from '../downloads/useDownloads';
import { albumIdentityKey } from '../library/grouping';
import { useSettings } from '../settings/useSettings';
import { AddToPlaylistSheet } from '../playlists/components/AddToPlaylistSheet';
import { UpNextSheet } from './components/UpNextSheet';
import { LyricsSheet } from './components/LyricsSheet';
import { OptionsMenuSheet } from './components/OptionsMenuSheet';
import { AudioInfoSheet } from './components/AudioInfoSheet';
import { SleepTimerSheet } from './components/SleepTimerSheet';
import { useSleepTimer } from '../player/useSleepTimer';
import { homeColors } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { HeartIcon } from '../home/components/Icons';
import { LiquidGlassView } from '../common/LiquidGlassView';

type NowPlayingScreenProps = NativeStackScreenProps<RootStackParamList, 'NowPlaying'>;

const ARTWORK_MAX = 340;
const ARTWORK_BORDER = 12;

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// These sheets take stable/primitive props only, so they re-render only
// when something they show actually changes. The player snapshot republishes
// ~2×/s for the progress bar, and a closed (or input-unchanged) sheet must
// not ride along with every position tick. LyricsSheet is deliberately NOT
// memoized: it consumes positionMs for live line highlighting.
const MemoAddToPlaylistSheet = memo(AddToPlaylistSheet);
const MemoOptionsMenuSheet = memo(OptionsMenuSheet);
const MemoUpNextSheet = memo(UpNextSheet);
const MemoAudioInfoSheet = memo(AudioInfoSheet);
const MemoSleepTimerSheet = memo(SleepTimerSheet);

type PlayerSeekBarProps = {
  seekable: boolean;
  durationMs: number;
  positionMs: number;
};

const PlayerSeekBar = memo(function PlayerSeekBar({
  seekable,
  durationMs,
  positionMs,} : PlayerSeekBarProps) {
  const barRef = useRef<View>(null);
  const barWidthRef = useRef(0);
  const barPageXRef = useRef(0);
  const durationMsRef = useRef(durationMs);
  durationMsRef.current = durationMs;
  const canSeekRef = useRef(seekable);
  canSeekRef.current = seekable;

  const [scrubbingPositionMs, setScrubbingPositionMs] = useState<number | null>(null);
  const thumbScale = useRef(new Animated.Value(1)).current;

  // Balance beginScrub/endScrub if the screen unmounts mid-drag.
  useEffect(
    () => () => {
      playerController.endScrub();
    },
    [],
  );

  const currentDisplayPositionMs = scrubbingPositionMs !== null ? scrubbingPositionMs : positionMs;
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, currentDisplayPositionMs / durationMs)) : 0;

  const measureBar = useCallback(() => {
    barRef.current?.measureInWindow((x, _y, width) => {
      if (width > 0) {
        barWidthRef.current = width;
        barPageXRef.current = x;
      }
    });
  }, []);

  /** Finger pageX → clamped position, or null while the bar is unmeasured. */
  const getPositionFromPageX = useCallback((pageX: number): number | null => {
    const width = barWidthRef.current;
    const dur = durationMsRef.current;
    if (width <= 0 || dur <= 0) return null;
    const offset = pageX - barPageXRef.current;
    if (!Number.isFinite(offset)) return null;
    const ratio = Math.min(1, Math.max(0, offset / width));
    return ratio * dur;
  }, []);

  const handleSeekAccessibility = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const action = event.nativeEvent.actionName;
      if (action !== 'increment' && action !== 'decrement') return;
      const dur = durationMsRef.current;
      if (dur <= 0 || !canSeekRef.current) return;
      const current = playerController.getSnapshot().positionMs ?? 0;
      const deltaMs = action === 'increment' ? 10_000 : -10_000;
      void playerController.seek(Math.min(dur, Math.max(0, current + deltaMs)));
    },
    [],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canSeekRef.current && durationMsRef.current > 0,
        onMoveShouldSetPanResponder: () => canSeekRef.current && durationMsRef.current > 0,
        onPanResponderGrant: (evt) => {
          if (!canSeekRef.current) return;
          measureBar();
          if (barPageXRef.current === 0 && barWidthRef.current > 0) {
            barPageXRef.current = evt.nativeEvent.pageX - evt.nativeEvent.locationX;
          }
          Animated.spring(thumbScale, { toValue: 1.4, useNativeDriver: true }).start();
          const pos = getPositionFromPageX(evt.nativeEvent.pageX);
          if (pos === null) return; // unmeasured bar: never seek to a bogus 0
          playerController.beginScrub();
          setScrubbingPositionMs(pos);
          // No audio seek on touch-down: the thumb jumps to the finger via
          // local state; the player moves once, on release (tap included).
        },
        onPanResponderMove: (evt) => {
          if (!canSeekRef.current) return;
          const pos = getPositionFromPageX(evt.nativeEvent.pageX);
          if (pos === null) return;
          // Local state only: zero bridge traffic while the finger moves,
          // so the thumb tracks the finger at frame rate.
          setScrubbingPositionMs(pos);
        },
        onPanResponderRelease: (evt) => {
          Animated.spring(thumbScale, { toValue: 1.0, useNativeDriver: true }).start();
          const pos = getPositionFromPageX(evt.nativeEvent.pageX);
          if (canSeekRef.current && pos !== null) {
            setScrubbingPositionMs(pos);
            // The gesture's ONE audio seek: local state drove the thumb all
            // along; now the player moves. seek() adopts the final position
            // synchronously (anchor), endScrub() delivers ONE catch-up render
            // with it, and the promise's finally hands the display back to
            // the real engine value.
            const settle = playerController.seek(pos);
            playerController.endScrub();
            void settle.finally(() => {
              setScrubbingPositionMs(null);
            });
          } else {
            playerController.endScrub();
            setScrubbingPositionMs(null);
          }
        },
        onPanResponderTerminate: () => {
          playerController.endScrub();
          Animated.spring(thumbScale, { toValue: 1.0, useNativeDriver: true }).start();
          setScrubbingPositionMs(null);
        },
      }),
    [getPositionFromPageX, measureBar, thumbScale],
  );

  return (
    <View style={styles.progressSection}>
      <View
        ref={barRef}
        style={[styles.seekBar, !seekable && styles.seekBarDisabled]}
        onLayout={measureBar}
        {...panResponder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{
          min: 0,
          max: Math.max(0, Math.round(durationMs / 1000)),
          now: Math.round(currentDisplayPositionMs / 1000),
          text:
            durationMs > 0
              ? `${formatTime(currentDisplayPositionMs)} of ${formatTime(durationMs)}`
              : 'Duration unknown',
        }}
        onAccessibilityAction={handleSeekAccessibility}
      >
        <View style={styles.seekTrack} pointerEvents="none">
          <View style={[styles.seekFill, { width: `${progress * 100}%` }]}>
            <Animated.View
              style={[styles.seekThumb, { transform: [{ scale: thumbScale }] }]}
            />
          </View>
        </View>
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>
          {positionMs !== null || scrubbingPositionMs !== null
            ? formatTime(currentDisplayPositionMs)
            : '--:--'}
        </Text>
        <Text style={styles.timeText}>
          {durationMs > 0 ? `-${formatTime(Math.max(0, durationMs - currentDisplayPositionMs))}` : '--:--'}
        </Text>
      </View>
    </View>
  );
});

type PlayerVolumeBarProps = {
  volume: number;
};

const PlayerVolumeBar = memo(function PlayerVolumeBar({ volume }: PlayerVolumeBarProps) {
  const volumeBarRef = useRef<View>(null);
  const volumeBarWidthRef = useRef(0);
  const volumeBarPageXRef = useRef(0);
  const [scrubbingVolume, setScrubbingVolume] = useState<number | null>(null);
  const volumeThumbScale = useRef(new Animated.Value(1)).current;

  // Balance beginVolumeScrub/endVolumeScrub if the screen unmounts mid-drag.
  useEffect(
    () => () => {
      playerController.endVolumeScrub();
    },
    [],
  );

  const currentVolume = scrubbingVolume !== null ? scrubbingVolume : volume;

  const measureVolumeBar = useCallback(() => {
    volumeBarRef.current?.measureInWindow((x, _y, width) => {
      if (width > 0) {
        volumeBarWidthRef.current = width;
        volumeBarPageXRef.current = x;
      }
    });
  }, []);

  const getVolumeFromPageX = useCallback((pageX: number): number | null => {
    const width = volumeBarWidthRef.current;
    if (width <= 0) return null;
    const offset = pageX - volumeBarPageXRef.current;
    const ratio = Math.min(1, Math.max(0, offset / width));
    return ratio;
  }, []);

  const handleVolumeAccessibility = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const action = event.nativeEvent.actionName;
      if (action !== 'increment' && action !== 'decrement') return;
      const current = playerController.getSnapshot().volume;
      const delta = action === 'increment' ? 0.05 : -0.05;
      playerController.setVolume(Math.round((current + delta) * 100) / 100);
    },
    [],
  );

  const volumePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          measureVolumeBar();
          Animated.spring(volumeThumbScale, { toValue: 1.4, useNativeDriver: true }).start();
          if (volumeBarPageXRef.current === 0 && volumeBarWidthRef.current > 0) {
            volumeBarPageXRef.current = evt.nativeEvent.pageX - evt.nativeEvent.locationX;
          }
          playerController.beginVolumeScrub();
          const vol = getVolumeFromPageX(evt.nativeEvent.pageX);
          if (vol !== null) {
            setScrubbingVolume(vol);
            // Immediate: the engine's mixer level changes on the very first
            // touch — full 0..1 float, never throttled or quantized.
            playerController.setVolume(vol);
          }
        },
        onPanResponderMove: (evt) => {
          const vol = getVolumeFromPageX(evt.nativeEvent.pageX);
          if (vol !== null) {
            // Thumb tracks local state; the real audio level follows every
            // move immediately (silent adoption keeps React out of it).
            setScrubbingVolume(vol);
            playerController.setVolume(vol);
          }
        },
        onPanResponderRelease: (evt) => {
          Animated.spring(volumeThumbScale, { toValue: 1.0, useNativeDriver: true }).start();
          const vol = getVolumeFromPageX(evt.nativeEvent.pageX);
          if (vol !== null) {
            playerController.setVolume(vol);
          }
          setScrubbingVolume(null);
          playerController.endVolumeScrub(); // one catch-up notification
        },
        onPanResponderTerminate: () => {
          Animated.spring(volumeThumbScale, { toValue: 1.0, useNativeDriver: true }).start();
          setScrubbingVolume(null);
          playerController.endVolumeScrub(); // hand back to the real volume
        },
      }),
    [getVolumeFromPageX, measureVolumeBar, volumeThumbScale],
  );

  return (
    <View style={styles.volumeRow}>
      <Ionicons name="volume-low" size={16} color="rgba(255, 255, 255, 0.55)" />
      <View
        ref={volumeBarRef}
        style={styles.volumeBar}
        onLayout={measureVolumeBar}
        {...volumePanResponder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback volume"
        accessibilityValue={{
          min: 0,
          max: 100,
          now: Math.round(currentVolume * 100),
          text: `${Math.round(currentVolume * 100)}%`,
        }}
        onAccessibilityAction={handleVolumeAccessibility}
      >
        <View style={styles.seekTrack} pointerEvents="none">
          <View style={[styles.seekFill, { width: `${currentVolume * 100}%` }]}>
            <Animated.View
              style={[styles.seekThumb, { transform: [{ scale: volumeThumbScale }] }]}
            />
          </View>
        </View>
      </View>
      <Ionicons name="volume-high" size={16} color="rgba(255, 255, 255, 0.55)" />
    </View>
  );
});

// --- Artwork gestures (Meld/Metrolist pattern) -------------------------
// Claim only clearly horizontal movement: vertical drags keep scrolling
// the ScrollView, and touches that barely move never claim at all.
const ARTWORK_SWIPE_CLAIM_PX = 16;
// Trigger: a real drag OR a fast flick — taps and accidental jitter never
// change tracks. Velocities are React Native px/ms (flick ≥ 450 px/s).
const ARTWORK_SWIPE_DISTANCE_PX = 60;
const ARTWORK_SWIPE_FLICK_PX = 24;
const ARTWORK_SWIPE_FLICK_VEL = 0.45;
const ARTWORK_DOUBLE_TAP_MS = 350;
const ARTWORK_SEEK_SKIP_MS = 5_000;

type PlayerArtworkProps = {
  track: Track;
  size: number;
  isPlaying: boolean;
  seekable: boolean;
  durationMs: number;
  /** JS: horizontal swipe → next/previous (commit at gesture end only). */
  onChangeTrack: (direction: 'next' | 'previous') => void;
};

/**
 * Album artwork with independent interactions:
 * - horizontal swipe → next/previous track, committed at release
 * - tap / double-tap → ±5 s seek skip
 * Vertical drags are never claimed, so the ScrollView keeps scrolling.
 */
const PlayerArtwork = memo(function PlayerArtwork({
  track,
  size,
  isPlaying,
  seekable,
  durationMs,
  onChangeTrack,
}: PlayerArtworkProps) {
  const frameRef = useRef<View>(null);
  const framePageXRef = useRef(0);
  const frameWidthRef = useRef(0);
  const lastTapRef = useRef<{ at: number; side: 'left' | 'right' } | null>(null);
  const feedbackAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const artworkScale = useRef(new Animated.Value(isPlaying ? 1 : 0.94)).current;
  const [feedback, setFeedback] = useState<{ text: string; side: 'left' | 'right' } | null>(null);

  useEffect(() => {
    Animated.spring(artworkScale, {
      toValue: isPlaying ? 1 : 0.94,
      friction: 7,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, [isPlaying, artworkScale]);

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
      feedbackAnimRef.current?.stop();
    },
    [],
  );

  const measureFrame = useCallback(() => {
    frameRef.current?.measureInWindow((x, _y, width) => {
      if (width > 0) {
        frameWidthRef.current = width;
        framePageXRef.current = x;
      }
    });
  }, []);

  const showFeedback = useCallback(
    (text: string, side: 'left' | 'right') => {
      if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
      feedbackAnimRef.current?.stop();
      setFeedback({ text, side });
      feedbackOpacity.setValue(0);
      const sequence = Animated.sequence([
        Animated.timing(feedbackOpacity, { toValue: 1, duration: 110, useNativeDriver: true }),
        Animated.delay(640),
        Animated.timing(feedbackOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]);
      feedbackAnimRef.current = sequence;
      sequence.start(() => {
        feedbackAnimRef.current = null;
      });
      feedbackTimerRef.current = setTimeout(() => {
        feedbackTimerRef.current = null;
        setFeedback(null);
      }, 1_030);
    },
    [feedbackOpacity],
  );

  const handleArtworkPress = useCallback(
    (event: { nativeEvent: { pageX: number } }) => {
      const absoluteX = event.nativeEvent.pageX;
      if (!seekable) return;
      measureFrame();
      const width = frameWidthRef.current;
      if (width <= 0) return;
      const side =
        absoluteX < framePageXRef.current + width / 2 ? 'left' : 'right';
      const now = Date.now();
      const lastTap = lastTapRef.current;
      lastTapRef.current = null;
      if (
        lastTap === null ||
        now - lastTap.at > ARTWORK_DOUBLE_TAP_MS ||
        lastTap.side !== side
      ) {
        lastTapRef.current = { at: now, side };
        return;
      }
      const deltaMs = side === 'left' ? -ARTWORK_SEEK_SKIP_MS : ARTWORK_SEEK_SKIP_MS;
      const positionMs = playerController.getSnapshot().positionMs ?? 0;
      void playerController.seek(Math.min(Math.max(0, positionMs + deltaMs), durationMs));
      showFeedback(side === 'left' ? '−5s' : '+5s', side);
    },
    [durationMs, measureFrame, seekable, showFeedback],
  );

  // Horizontal swipe → next/previous, committed only at release. The capture
  // threshold matches ARTWORK_SWIPE_CLAIM_PX with strict axis dominance, so
  // vertical drags are never claimed and the ScrollView keeps scrolling.
  const artworkSwiper = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gestureState) =>
          Math.abs(gestureState.dx) >= ARTWORK_SWIPE_CLAIM_PX &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderRelease: (_event, gestureState) => {
          const dx = gestureState.dx;
          const travelled = Math.abs(dx) >= ARTWORK_SWIPE_DISTANCE_PX;
          const flicked =
            Math.abs(dx) >= ARTWORK_SWIPE_FLICK_PX &&
            Math.abs(gestureState.vx) >= ARTWORK_SWIPE_FLICK_VEL;
          if (travelled || flicked) {
            onChangeTrack(dx < 0 ? 'next' : 'previous');
          }
        },
      }),
    [onChangeTrack],
  );

  const frameSize = size + ARTWORK_BORDER * 2;

  return (
    <View style={styles.artworkArea}>
      <View {...artworkSwiper.panHandlers}>
        <Pressable
          ref={frameRef}
          onLayout={measureFrame}
          onPress={handleArtworkPress}
          accessible={false}
        >
          <Animated.View
            style={[
              styles.artworkFrame,
              { width: frameSize, height: frameSize, transform: [{ scale: artworkScale }] },
            ]}
          >
            <LiquidGlassView
              shape="rounded"
              borderRadius={28}
              intensity="ultra"
              style={styles.artworkGlassWrapper}
            >
              <ArtworkPlaceholder
                track={track}
                size={size}
                borderRadius={24}
                style={{ width: size, height: size }}
                imageStyle={{ width: size, height: size }}
              />
            </LiquidGlassView>
          </Animated.View>
        </Pressable>
      </View>
      {feedback !== null ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.seekFeedback,
            feedback.side === 'left' ? styles.seekFeedbackLeft : styles.seekFeedbackRight,
            { opacity: feedbackOpacity },
          ]}
        >
          <Text style={styles.seekFeedbackText}>{feedback.text}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
});

/**
 * YouTube Music inspired Now Playing experience.
 *
 * Header: Down chevron + 3-dots Options Menu (No cluttered pills).
 * Center: Large rounded Album Artwork.
 * Info & Actions: Song Title + Artist + Heart Like button + "+ Save" playlist pill.
 * Progress: Scrubbable seek bar with active position thumb dot.
 * Controls: Shuffle, Prev, Big White Play/Pause Circle, Next, Repeat.
 * Bottom: Centered "UP NEXT" trigger sheet.
 */
export function NowPlayingScreen({ navigation }: NowPlayingScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const snapshot = useSyncExternalStore(
    playerController.subscribe,
    playerController.getSnapshot,
  );

  const track = snapshot.currentTrack;
  const isPlaying = snapshot.status === 'playing';
  const isLoading = snapshot.status === 'loading';
  const { isLiked, toggleLike } = useLikedSongs();
  const { showLyricsButtonEnabled } = useSettings();
  const trackIsLiked = track !== null && isLiked(track);

  const [playlistSheetVisible, setPlaylistSheetVisible] = useState(false);
  const [upNextSheetVisible, setUpNextSheetVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [lyricsSheetVisible, setLyricsSheetVisible] = useState(false);
  const [audioInfoVisible, setAudioInfoVisible] = useState(false);
  const [sleepTimerSheetVisible, setSleepTimerSheetVisible] = useState(false);

  // Download state for the passive indicator — the ONE app-level downloads
  // store (same source the Options menu and Downloads screens use). No
  // download logic lives in Now Playing; it only renders what the store says.
  const { isDownloaded, getActivity } = useDownloads();

  // Stable sheet handlers: inline lambdas would change identity on every
  // ~2×/s snapshot tick and defeat the memoized sheets below. Local UI
  // state stays limited to sheet visibility, per the state-consistency rule.
  const openPlaylistSheet = useCallback(() => setPlaylistSheetVisible(true), []);
  const closePlaylistSheet = useCallback(() => setPlaylistSheetVisible(false), []);
  const openUpNextSheet = useCallback(() => setUpNextSheetVisible(true), []);
  const closeUpNextSheet = useCallback(() => setUpNextSheetVisible(false), []);
  const closeOptionsMenu = useCallback(() => setOptionsMenuVisible(false), []);
  const openLyricsSheet = useCallback(() => setLyricsSheetVisible(true), []);
  const closeLyricsSheet = useCallback(() => setLyricsSheetVisible(false), []);
  const openAudioInfo = useCallback(() => setAudioInfoVisible(true), []);
  const closeAudioInfo = useCallback(() => setAudioInfoVisible(false), []);
  const openSleepTimerSheet = useCallback(() => setSleepTimerSheetVisible(true), []);
  const closeSleepTimerSheet = useCallback(() => setSleepTimerSheetVisible(false), []);
  const selectQueueTrack = useCallback((absoluteIndex: number) => {
    void playerController.playAt(absoluteIndex);
  }, []);
  const moveQueueTrack = useCallback((fromAbsoluteIndex: number, toAbsoluteIndex: number) => {
    playerController.moveInQueue(fromAbsoluteIndex, toAbsoluteIndex);
  }, []);
  // Returns the removal record so the Up Next sheet can offer Undo (null
  // when refused — e.g. the current track, which the controller protects).
  const removeQueueTrack = useCallback(
    (absoluteIndex: number): QueueRemoval | null =>
      playerController.removeFromQueue(absoluteIndex),
    [],
  );
  // Undo: restores the track at its exact former queue/source position.
  // Pure queue mutation — never starts playback, never changes the current
  // track (see PlayerController.restoreRemovedTrack).
  const restoreQueueTrack = useCallback((removal: QueueRemoval) => {
    playerController.restoreRemovedTrack(removal);
  }, []);
  const clearUpcomingQueue = useCallback(() => {
    playerController.clearUpcomingQueue();
  }, []);

  // Sleep-timer indicator state — subscribes to the ONE transient timer
  // store (never polls PlayerController): disappears immediately on
  // cancel/expire/replace, ticks at minute granularity while counting down.
  const sleepTimerSnapshot = useSleepTimer();

  const durationMs = snapshot.durationMs ?? track?.durationMs ?? 0;
  const positionMs = snapshot.positionMs ?? 0;

  // --- Derived presentational facts (absent → omitted, never faked) ---
  // Album link: only when the Album screen can RESOLVE the key. That screen
  // groups the device library, so a local track's album key is guaranteed to
  // find its group there; any other track keeps its album as plain text — no
  // navigation destination that cannot resolve is ever created.
  const albumKey = track !== null ? albumIdentityKey(track) : null;
  const albumNavigable = albumKey !== null && track !== null && trackOrigin(track) === 'local';
  // Artist link: the Artist screen resolves any name through the ONE search
  // path (local + online), so it is always a real destination.
  const artistNavigable = track !== null && track.artist.trim().length > 0;

  // Passive download state for the current track (null → no pill shown).
  // Pure read of the store: Now Playing never starts, cancels or retries a
  // download — those actions stay in the Options menu.
  const downloadIndicator = (() => {
    if (track === null) return null;
    if (isDownloaded(track)) {
      return { icon: 'checkmark-circle' as const, label: 'Downloaded', color: '#ffffff' };
    }
    const activity = getActivity(track);
    if (activity === null) return null;
    if (activity.status === 'downloading') {
      const percent =
        activity.totalBytes > 0
          ? Math.round(Math.min(1, Math.max(0, activity.progress)) * 100)
          : null;
      return {
        icon: 'arrow-down-circle' as const,
        label: percent !== null ? `Downloading ${percent}%` : 'Downloading',
        color: '#ffffff',
      };
    }
    if (activity.status === 'queued') {
      return { icon: 'time-outline' as const, label: 'Queued', color: homeColors.textMuted };
    }
    return { icon: 'alert-circle' as const, label: 'Failed', color: homeColors.accent };
  })();

  // --- 60fps Native Micro-Interaction Drivers ---
  const playScale = useRef(new Animated.Value(1)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const nextNudge = useRef(new Animated.Value(0)).current;
  const prevNudge = useRef(new Animated.Value(0)).current;

  const handleToggleLike = () => {
    if (!track) return;
    Animated.sequence([
      Animated.timing(heartScale, { toValue: 0.7, duration: 60, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1.35, friction: 3, tension: 140, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1.0, friction: 4, tension: 90, useNativeDriver: true }),
    ]).start();
    toggleLike(track);
  };

  const handleTogglePlay = () => {
    Animated.sequence([
      Animated.timing(playScale, { toValue: 0.85, duration: 70, useNativeDriver: true }),
      Animated.spring(playScale, { toValue: 1.12, friction: 3, tension: 160, useNativeDriver: true }),
      Animated.spring(playScale, { toValue: 1.0, friction: 4, tension: 100, useNativeDriver: true }),
    ]).start();
    void playerController.togglePlayPause();
  };

  const handleNext = () => {
    Animated.sequence([
      Animated.timing(nextNudge, { toValue: 6, duration: 80, useNativeDriver: true }),
      Animated.spring(nextNudge, { toValue: 0, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    void playerController.next();
  };

  const handlePrev = () => {
    Animated.sequence([
      Animated.timing(prevNudge, { toValue: -6, duration: 80, useNativeDriver: true }),
      Animated.spring(prevNudge, { toValue: 0, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    void playerController.previous();
  };

  const seekable = durationMs > 0 && !isLoading && snapshot.status !== 'error';

  const changeTrack = useCallback((direction: 'next' | 'previous') => {
    if (direction === 'next') {
      void playerController.next();
    } else {
      void playerController.previous();
    }
  }, []);

  // --- Drag-Up / Swipe-Up gesture to open UpNextSheet ---
  const swipeUpPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5,
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy < -15 || gestureState.vy < -0.2) {
            setUpNextSheetVisible(true);
          }
        },
      }),
    [],
  );

  const artworkSize = Math.min(ARTWORK_MAX, windowWidth - 28 * 2 - ARTWORK_BORDER * 2);

  const upcomingTracks = useMemo(
    () =>
      snapshot.queueIndex >= 0 && snapshot.queueIndex < snapshot.queue.length - 1
        ? snapshot.queue.slice(snapshot.queueIndex + 1)
        : [],
    [snapshot.queue, snapshot.queueIndex],
  );

  if (!track) {
    navigation.goBack();
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      {/* Top Header: Chevron Down (Left) + 3-Dots Options Menu (Right) */}
      <View style={styles.header}>
        <Pressable
          style={styles.headerControl}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Close Now Playing"
          hitSlop={12}
        >
          <Ionicons name="chevron-down" size={24} color={homeColors.text} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.headerLabel}>NOW PLAYING</Text>
        </View>

        <Pressable
          style={styles.headerControl}
          onPress={() => setOptionsMenuVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Options menu"
          hitSlop={12}
        >
          <Ionicons name="ellipsis-vertical" size={22} color={homeColors.text} />
        </Pressable>
      </View>

      {/* Main Content Area */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Ambient Fluid Artwork Aura */}
        <View style={styles.ambientAuraContainer} pointerEvents="none">
          <View style={styles.ambientAura} />
        </View>

        {/* Album Artwork in Liquid Glass Frame */}
        <PlayerArtwork
          track={track}
          size={artworkSize}
          isPlaying={isPlaying}
          seekable={seekable}
          durationMs={durationMs}
          onChangeTrack={changeTrack}
        />

        {/* Song Info — Title, tappable Artist, Album when the source has
            one. Artist opens the existing Artist screen; Album only becomes
            a link when its key resolves in the library grouping (otherwise
            plain text). Missing fields are simply absent — never
            "Unknown"/"undefined". */}
        <View style={styles.metaSection}>
          <Text style={styles.title} numberOfLines={1}>
            {track.title}
          </Text>
          {artistNavigable ? (
            <Pressable
              onPress={() => navigation.navigate('Artist', { artistName: track.artist })}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Open artist ${track.artist}`}
            >
              <Text style={styles.artist} numberOfLines={1}>
                {track.artist}
              </Text>
            </Pressable>
          ) : null}
          {Boolean(track.album && track.album.trim().length > 0) ? (
            albumNavigable && albumKey !== null ? (
              <Pressable
                onPress={() => navigation.navigate('Album', { albumKey })}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Open album ${track.album}`}
              >
                <Text style={styles.album} numberOfLines={1}>
                  {track.album}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.album} numberOfLines={1}>
                {track.album}
              </Text>
            )
          ) : null}
        </View>

        {/* Action Buttons Row: Liquid Glass Heart Like Button + Save Playlist Pill */}
        <View style={styles.actionsRow}>
          <Pressable
            style={styles.actionGlassOrb}
            disabled={track === null}
            onPress={handleToggleLike}
            accessibilityRole="button"
            accessibilityLabel={trackIsLiked ? 'Unlike' : 'Like'}
          >
            <LiquidGlassView
              shape="circle"
              intensity="high"
              style={styles.circleOrb}
              glowColor={trackIsLiked ? 'rgba(255, 77, 109, 0.4)' : undefined}
            >
              <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                <HeartIcon
                  filled={trackIsLiked}
                  color={trackIsLiked ? '#ff4d6d' : '#ffffff'}
                  size={20}
                />
              </Animated.View>
            </LiquidGlassView>
          </Pressable>

          <Pressable
            style={styles.saveGlassPill}
            onPress={openPlaylistSheet}
            accessibilityRole="button"
            accessibilityLabel="Save to playlist"
          >
            <LiquidGlassView shape="pill" intensity="high" style={styles.savePillInner}>
              <Ionicons name="add" size={18} color="#ffffff" />
              <Text style={styles.savePillText}>Save</Text>
            </LiquidGlassView>
          </Pressable>

          {/* Lyrics shortcut — hidden (display none) */}
          {/* showLyricsButtonEnabled ? (
            <Pressable
              style={styles.saveGlassPill}
              onPress={openLyricsSheet}
              accessibilityRole="button"
              accessibilityLabel="Show lyrics"
            >
              <LiquidGlassView shape="pill" intensity="high" style={styles.savePillInner}>
                <Ionicons name="document-text-outline" size={18} color="#ffffff" />
                <Text style={styles.savePillText}>Lyrics</Text>
              </LiquidGlassView>
            </Pressable>
          ) : null */}

          {/* Sleep timer indicator — shown only while a timer is armed.
              Tapping it reopens the sheet for reconfiguration/cancel. */}
          {sleepTimerSnapshot.mode !== null ? (
            <Pressable
              style={styles.saveGlassPill}
              onPress={openSleepTimerSheet}
              accessibilityRole="button"
              accessibilityLabel={
                sleepTimerSnapshot.mode === 'end-of-track'
                  ? 'Sleep timer active, ends after this track. Opens sleep timer settings'
                  : `Sleep timer active, ${Math.max(1, Math.ceil((sleepTimerSnapshot.remainingMs ?? 0) / 60_000))} minutes remaining. Opens sleep timer settings`
              }
            >
              <LiquidGlassView shape="pill" intensity="high" style={styles.savePillInner}>
                <Ionicons name="moon" size={16} color="#ffffff" />
                <Text style={styles.savePillText}>
                  {sleepTimerSnapshot.mode === 'end-of-track'
                    ? 'End of track'
                    : `${Math.max(1, Math.ceil((sleepTimerSnapshot.remainingMs ?? 0) / 60_000))} min`}
                </Text>
              </LiquidGlassView>
            </Pressable>
          ) : null}

          {/* Download state — passive read of the ONE downloads store,
              shown only while a real state exists (downloaded / progress /
              queued / failed). Monochrome + warm accent, no new colors. */}
          {downloadIndicator ? (
            <View
              style={styles.saveGlassPill}
              accessibilityRole="text"
              accessibilityLabel={downloadIndicator.label}
            >
              <LiquidGlassView shape="pill" intensity="high" style={styles.savePillInner}>
                <Ionicons name={downloadIndicator.icon} size={16} color={downloadIndicator.color} />
                <Text style={styles.savePillText}>{downloadIndicator.label}</Text>
              </LiquidGlassView>
            </View>
          ) : null}
        </View>

        {/* Seek Bar — isolated component with 60fps local scrubbing and live audio seeking */}
        <PlayerSeekBar
          seekable={seekable}
          durationMs={durationMs}
          positionMs={positionMs}
        />

        {/* Transport Controls (Liquid Glass Circular Controls) */}
        <View style={styles.controls}>
          {/* Shuffle */}
          <Pressable
            style={styles.controlGlassOrb}
            onPress={() => void playerController.toggleShuffle()}
            accessibilityRole="button"
            accessibilityLabel={snapshot.shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
          >
            <LiquidGlassView
              shape="circle"
              intensity={snapshot.shuffleEnabled ? 'ultra' : 'medium'}
              style={styles.secondaryOrb}
              glowColor={snapshot.shuffleEnabled ? 'rgba(255, 255, 255, 0.4)' : undefined}
            >
              <Ionicons
                name="shuffle"
                size={20}
                color={snapshot.shuffleEnabled ? '#ffffff' : 'rgba(255, 255, 255, 0.55)'}
              />
            </LiquidGlassView>
          </Pressable>

          {/* Previous */}
          <Animated.View style={{ transform: [{ translateX: prevNudge }] }}>
            <Pressable
              style={styles.controlGlassOrb}
              disabled={!snapshot.hasPrevious}
              onPress={handlePrev}
              accessibilityRole="button"
              accessibilityLabel="Previous track"
            >
              <LiquidGlassView
                shape="circle"
                intensity="medium"
                style={styles.secondaryOrb}
              >
                <Ionicons
                  name="play-skip-back"
                  size={22}
                  color={snapshot.hasPrevious ? '#ffffff' : 'rgba(255, 255, 255, 0.3)'}
                />
              </LiquidGlassView>
            </Pressable>
          </Animated.View>

          {/* Big Pure Apple Liquid Glass Play/Pause Orb */}
          <Pressable
            onPress={handleTogglePlay}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel={
              isLoading
                ? 'Loading selected track'
                : snapshot.status === 'error'
                  ? 'Retry playback'
                  : isPlaying
                    ? 'Pause'
                    : 'Play'
            }
          >
            <Animated.View
              style={[styles.playOrbContainer, { transform: [{ scale: playScale }] }]}
            >
              <LiquidGlassView
                shape="circle"
                intensity="ultra"
                style={styles.playOrbGlass}
              >
                {isLoading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : snapshot.status === 'error' ? (
                  // Retry affordance: on error, togglePlayPause re-runs the
                  // FULL selection path (fresh resolve, fresh guard) — the
                  // same retry semantics the lock screen uses.
                  <Ionicons name="refresh" size={30} color="#ffffff" />
                ) : (
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={32}
                    color="#ffffff"
                    style={{ marginLeft: isPlaying ? 0 : 3 }}
                  />
                )}
              </LiquidGlassView>
            </Animated.View>
          </Pressable>

          {/* Next */}
          <Animated.View style={{ transform: [{ translateX: nextNudge }] }}>
            <Pressable
              style={styles.controlGlassOrb}
              disabled={!snapshot.hasNext}
              onPress={handleNext}
              accessibilityRole="button"
              accessibilityLabel="Next track"
            >
              <LiquidGlassView
                shape="circle"
                intensity="medium"
                style={styles.secondaryOrb}
              >
                <Ionicons
                  name="play-skip-forward"
                  size={22}
                  color={snapshot.hasNext ? '#ffffff' : 'rgba(255, 255, 255, 0.3)'}
                />
              </LiquidGlassView>
            </Pressable>
          </Animated.View>

          {/* Repeat */}
          <Pressable
            style={styles.controlGlassOrb}
            onPress={() => playerController.toggleRepeatMode()}
            accessibilityRole="button"
            accessibilityLabel={`Repeat ${snapshot.repeatMode}`}
          >
            <LiquidGlassView
              shape="circle"
              intensity={snapshot.repeatMode !== 'off' ? 'ultra' : 'medium'}
              style={styles.secondaryOrb}
              glowColor={snapshot.repeatMode !== 'off' ? 'rgba(255, 255, 255, 0.4)' : undefined}
            >
              <View style={styles.repeatContainer}>
                <Ionicons
                  name="repeat"
                  size={20}
                  color={snapshot.repeatMode !== 'off' ? '#ffffff' : 'rgba(255, 255, 255, 0.55)'}
                />
                {snapshot.repeatMode === 'one' ? (
                  <View style={styles.repeatBadge}>
                    <Text style={styles.repeatBadgeText}>1</Text>
                  </View>
                ) : null}
              </View>
            </LiquidGlassView>
          </Pressable>
        </View>

        {/* In-app volume — isolated component with 60fps local scrubbing */}
        <PlayerVolumeBar volume={snapshot.volume} />

        {/* Friendly, FIXED failure text: raw error messages can carry HTTP
            codes or native resolver internals, which never belong on
            screen. The retry affordance is the play orb above. */}
        {snapshot.status === 'error' ? (
          <Text style={styles.errorText} numberOfLines={2}>
            Couldn't play this track. Tap retry to try again.
          </Text>
        ) : null}

        {/* Bottom Centered Liquid Glass "UP NEXT" Trigger */}
        <View style={styles.upNextTriggerContainer} {...swipeUpPanResponder.panHandlers}>
          <Pressable
            onPress={openUpNextSheet}
            accessibilityRole="button"
            accessibilityLabel={
              upcomingTracks.length > 0
                ? `Open queue, ${upcomingTracks.length} ${upcomingTracks.length === 1 ? 'track' : 'tracks'} up next`
                : 'Open queue'
            }
          >
            <LiquidGlassView shape="pill" intensity="high" style={styles.upNextTriggerPill}>
              <Ionicons name="chevron-up" size={16} color="rgba(255, 255, 255, 0.7)" />
              <Text style={styles.upNextTriggerText}>
                {upcomingTracks.length > 0 ? `UP NEXT · ${upcomingTracks.length}` : 'UP NEXT'}
              </Text>
            </LiquidGlassView>
          </Pressable>
        </View>
      </ScrollView>

      {/* Sheets / Modals — memoized with stable callbacks so the ~2×/s
          position ticks don't re-render them (LyricsSheet below stays live
          on purpose). */}
      <MemoAddToPlaylistSheet
        visible={playlistSheetVisible}
        track={track}
        onClose={closePlaylistSheet}
      />

      <MemoOptionsMenuSheet
        visible={optionsMenuVisible}
        track={track}
        onClose={closeOptionsMenu}
        onShowAudioInfo={openAudioInfo}
        onShowSleepTimer={openSleepTimerSheet}
        onGoToArtist={(artistName) => {
          // Real destination: the Artist screen resolves any name through
          // the one search path (the old "jump to Search tab" behavior
          // never actually showed the artist).
          navigation.navigate('Artist', { artistName });
        }}
      />

      <MemoUpNextSheet
        visible={upNextSheetVisible}
        currentTrack={track}
        upcomingTracks={upcomingTracks}
        queueIndex={snapshot.queueIndex}
        onClose={closeUpNextSheet}
        onSelectTrack={selectQueueTrack}
        onMoveTrack={moveQueueTrack}
        onRemoveTrack={removeQueueTrack}
        onRestoreTrack={restoreQueueTrack}
        onClearQueue={clearUpcomingQueue}
      />

      <MemoAudioInfoSheet
        visible={audioInfoVisible}
        track={track}
        metadata={snapshot.activeStream}
        durationMs={durationMs}
        onClose={closeAudioInfo}
      />

      <LyricsSheet
        visible={lyricsSheetVisible}
        track={track}
        positionMs={positionMs}
        seekEnabled={seekable}
        onClose={closeLyricsSheet}
      />

      <MemoSleepTimerSheet
        visible={sleepTimerSheetVisible}
        currentTrack={track}
        onClose={closeSleepTimerSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: homeColors.background,
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
  },
  headerControl: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: homeColors.textMuted,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 16,
    position: 'relative',
  },
  ambientAuraContainer: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
  },
  ambientAura: {
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    opacity: 0.8,
    shadowColor: '#000000',
    shadowOpacity: 0.9,
    shadowRadius: 50,
    elevation: 12,
  },
  artworkArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    zIndex: 1,
    // Anchors the absolute ±5s feedback pill to the artwork.
    position: 'relative',
  },
  artworkFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkGlassWrapper: {
    padding: 6,
    borderWidth: 1.5,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.65,
    shadowRadius: 30,
    elevation: 20,
  },
  artworkImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
  },
  metaSection: {
    marginBottom: 16,
    gap: 4,
    zIndex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
  },
  artist: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.65)',
  },
  album: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wrap so the armed sleep-timer pill (plus the download indicator)
    // can never push the row off-screen on narrow devices.
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 20,
    zIndex: 1,
  },
  actionGlassOrb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOrb: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveGlassPill: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  savePillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  savePillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  progressSection: {
    marginBottom: 20,
    zIndex: 1,
  },
  seekBar: {
    // 16 → a ~36 px touch band: comfortable for scrubbing without
    // inflating the visual bar.
    paddingVertical: 16,
  },
  seekBarDisabled: {
    opacity: 0.4,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    zIndex: 1,
  },
  volumeBar: {
    flex: 1,
    paddingVertical: 12,
  },
  seekTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    position: 'relative',
  },
  seekFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ffffff',
    position: 'relative',
    alignItems: 'flex-end',
    justifyContent: 'center',
    shadowColor: '#ffffff',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  seekThumb: {
    position: 'absolute',
    right: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#ffffff',
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 6,
  },
  seekFeedback: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    zIndex: 2,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 16,
    // Subtle glass language, matching the control orbs' split borders —
    // no glow, no neon.
    backgroundColor: 'rgba(16, 16, 16, 0.78)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'rgba(255, 255, 255, 0.10)',
    overflow: 'hidden',
  },
  seekFeedbackLeft: {
    left: 18,
  },
  seekFeedbackRight: {
    right: 18,
  },
  seekFeedbackText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    color: 'rgba(255, 255, 255, 0.55)',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 24,
    zIndex: 1,
  },
  controlGlassOrb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryOrb: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  playOrbContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOrbGlass: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1.5,
    borderTopColor: 'rgba(255, 255, 255, 0.65)',
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.65,
    shadowRadius: 24,
    elevation: 16,
  },
  repeatContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    // Monochrome active-state marker (matches the white shuffle/repeat
    // glow language); the lone cyan chip read as neon on a dark player.
    backgroundColor: '#ffffff',
    borderRadius: 6,
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#000000',
  },
  errorText: {
    marginTop: 8,
    marginBottom: 16,
    fontSize: 12,
    color: '#ff4d6d',
    textAlign: 'center',
  },
  upNextTriggerContainer: {
    paddingVertical: 6,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  upNextTriggerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.3)',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  upNextTriggerText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#ffffff',
  },
});
