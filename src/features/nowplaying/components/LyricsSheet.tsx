import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import type { Lyrics, LyricsLine } from '../../../core/types/lyrics';
import { activeLyricsLineIndex } from '../../../core/types/lyrics';
import { homeColors, homeRadius } from '../../home/theme';
import { lyricsService, playerController } from '../../../services/composition';

type LyricsSheetProps = {
  visible: boolean;
  /** Current track; lyrics are looked up from its metadata only. */
  track: Track | null;
  /** Live playback position — the EXISTING position updates, no new timer. */
  positionMs: number;
  /** False while playback is loading/errored (same rule as the seek bar). */
  seekEnabled: boolean;
  onClose: () => void;
};

type LyricsPhase = 'loading' | 'ready' | 'unavailable' | 'error';

type SheetState = {
  phase: LyricsPhase;
  lyrics: Lyrics | null;
};

const INITIAL_STATE: SheetState = { phase: 'loading', lyrics: null };

/** m:ss for tap-to-seek accessibility labels. */
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * Bottom-sheet lyrics panel, styled after the existing Up Next / Options
 * sheets (same glass surface, handle and tab header — no new visual
 * language, no gradients).
 *
 * Data flow: NowPlayingScreen → lyricsService (metadata-only lookup,
 * cached) → provider. Playback is untouched while the sheet is open,
 * and nothing here reaches the audio engine: sync highlighting reads the
 * `positionMs` prop (the controller's existing snapshot stream) and line
 * taps go through `playerController.seek()`, which applies its own
 * loading/error guards.
 *
 * Track-change race (spec §11): every (re)load bumps a generation
 * counter; a response is dropped unless it still owns the counter — so
 * A → B (A's late response cannot overwrite B) and A → B → A (third
 * load wins, service cache serves A instantly) are both safe.
 */
export function LyricsSheet({
  visible,
  track,
  positionMs,
  seekEnabled,
  onClose,
}: LyricsSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(600)).current;
  const isClosingRef = useRef(false);
  const listRef = useRef<FlatList<LyricsLine>>(null);
  const requestGeneration = useRef(0);
  const [state, setState] = useState<SheetState>(INITIAL_STATE);
  const [retryToken, setRetryToken] = useState(0);

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

  // Load lyrics for whatever track is showing; stale responses lose the
  // generation race and are discarded. Closing the sheet also bumps the
  // generation, so an in-flight request can never mutate a hidden sheet.
  useEffect(() => {
    if (!visible || !track) {
      requestGeneration.current += 1;
      return;
    }
    const generation = ++requestGeneration.current;
    setState(INITIAL_STATE);
    lyricsService.getLyrics(track).then(
      (lyrics) => {
        if (generation !== requestGeneration.current) return;
        setState(lyrics ? { phase: 'ready', lyrics } : { phase: 'unavailable', lyrics: null });
      },
      () => {
        if (generation !== requestGeneration.current) return;
        setState({ phase: 'error', lyrics: null });
      },
    );
  }, [visible, track, retryToken]);

  const synced = state.lyrics?.type === 'synced';
  const activeIndex = useMemo(
    () => (state.lyrics ? activeLyricsLineIndex(state.lyrics.lines, positionMs) : -1),
    [state.lyrics, positionMs],
  );

  // Keep the singing line in view — fires only when the ACTIVE LINE
  // changes (a few times per minute), not on every position tick.
  useEffect(() => {
    if (!visible || activeIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({ index: activeIndex, viewPosition: 0.35, animated: true });
      } catch {
        // List not measured yet; onScrollToIndexFailed covers async misses.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, visible]);

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

  const seekToLine = (line: LyricsLine) => {
    // playerController.seek() itself refuses while loading/errored — the
    // existing seek guards are the single source of truth.
    if (line.startMs === undefined) return;
    void playerController.seek(line.startMs);
  };

  const renderLine = ({ item, index }: { item: LyricsLine; index: number }) => {
    const isActive = synced && index === activeIndex;
    const pressable = synced && item.startMs !== undefined && seekEnabled;
    const body = (
      <Text
        style={[
          synced ? styles.syncedLine : styles.plainLine,
          isActive && styles.syncedLineActive,
        ]}
      >
        {item.text}
      </Text>
    );
    if (!pressable) return <View style={styles.lineRow}>{body}</View>;
    return (
      <Pressable
        style={({ pressed }) => [styles.lineRow, pressed && styles.lineRowPressed]}
        onPress={() => seekToLine(item)}
        accessibilityRole="button"
        accessibilityLabel={`Seek to ${formatTimestamp(item.startMs ?? 0)}: ${item.text}`}
      >
        {body}
      </Pressable>
    );
  };

  const renderContent = () => {
    if (state.phase === 'loading') {
      return (
        <View style={styles.stateContainer}>
          <ActivityIndicator color="#ffffff" size="small" />
          <Text style={styles.stateSubtitle}>Loading lyrics…</Text>
        </View>
      );
    }
    if (state.phase === 'unavailable') {
      return (
        <View style={styles.stateContainer}>
          <Ionicons name="document-text-outline" size={40} color="rgba(255, 255, 255, 0.25)" />
          <Text style={styles.stateTitle}>No lyrics available</Text>
          <Text style={styles.stateSubtitle}>
            The lyrics source has no match for this track.
          </Text>
        </View>
      );
    }
    if (state.phase === 'error') {
      return (
        <View style={styles.stateContainer}>
          <Ionicons name="cloud-offline-outline" size={40} color="rgba(255, 255, 255, 0.25)" />
          <Text style={styles.stateTitle}>Couldn&apos;t load lyrics</Text>
          <Text style={styles.stateSubtitle}>Check your connection and try again.</Text>
          <Pressable
            style={({ pressed }) => [styles.retryPill, pressed && styles.retryPillPressed]}
            onPress={() => setRetryToken((token) => token + 1)}
            accessibilityRole="button"
            accessibilityLabel="Retry loading lyrics"
          >
            <Ionicons name="refresh-outline" size={16} color="#ffffff" />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    const lyrics = state.lyrics;
    if (!lyrics) return null;
    return (
      <FlatList
        ref={listRef}
        data={lyrics.lines}
        keyExtractor={(_, index) => String(index)}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={renderLine}
        onScrollToIndexFailed={(info) => {
          try {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
          } catch {
            // Best effort only: highlighting never depends on the scroll position.
          }
        }}
      />
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropTouch}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss lyrics"
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
          {/* Top handle bar with drag-to-dismiss (same pattern as UpNextSheet) */}
          <View style={styles.dragHandleArea} {...panResponder.panHandlers}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.tabHeader}>
              <View style={styles.tabItemActive}>
                <Text style={styles.tabTextActive}>LYRICS</Text>
                <View style={styles.tabIndicator} />
              </View>
              <Pressable
                style={styles.closeButton}
                onPress={handleDismiss}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close lyrics"
              >
                <Ionicons name="close" size={20} color={homeColors.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* Track this sheet is showing */}
          {track ? (
            <View style={styles.trackHeader}>
              <Text style={styles.trackTitle} numberOfLines={1}>
                {track.title}
              </Text>
              <Text style={styles.trackArtist} numberOfLines={1}>
                {track.artist}
              </Text>
            </View>
          ) : null}

          {renderContent()}
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
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: 8,
  },
  trackHeader: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderBottomWidth: 1,
    borderBottomColor: homeColors.border,
    gap: 2,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: homeColors.text,
  },
  trackArtist: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 4,
  },
  lineRow: {
    paddingVertical: 7,
    borderRadius: homeRadius.surface,
  },
  lineRowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  syncedLine: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.55)',
  },
  syncedLineActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  plainLine: {
    fontSize: 15,
    lineHeight: 24,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  stateContainer: {
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: homeColors.textMuted,
  },
  stateSubtitle: {
    fontSize: 13,
    color: homeColors.textFaint,
    textAlign: 'center',
  },
  retryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surfaceRaised,
  },
  retryPillPressed: {
    opacity: 0.6,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
});
