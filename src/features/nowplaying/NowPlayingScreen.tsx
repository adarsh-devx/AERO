import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../navigation';
import { playerController } from '../../services/composition';
import { useLikedSongs } from '../liked/useLikedSongs';
import { AddToPlaylistSheet } from '../playlists/components/AddToPlaylistSheet';
import { UpNextSheet } from './components/UpNextSheet';
import { OptionsMenuSheet } from './components/OptionsMenuSheet';
import { homeColors, homeRadius } from '../home/theme';
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
  const trackIsLiked = track !== null && isLiked(track);

  const [playlistSheetVisible, setPlaylistSheetVisible] = useState(false);
  const [upNextSheetVisible, setUpNextSheetVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);

  const durationMs = snapshot.durationMs ?? track?.durationMs ?? 0;
  const positionMs = snapshot.positionMs ?? 0;

  // --- 60fps Native Micro-Interaction Drivers ---
  const playScale = useRef(new Animated.Value(1)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const artworkScale = useRef(new Animated.Value(isPlaying ? 1 : 0.94)).current;
  const thumbScale = useRef(new Animated.Value(1)).current;
  const nextNudge = useRef(new Animated.Value(0)).current;
  const prevNudge = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(artworkScale, {
      toValue: isPlaying ? 1 : 0.94,
      friction: 7,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, [isPlaying, artworkScale]);

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

  // --- Seek bar (PanResponder-based with persistent width ref) ---
  const barWidthRef = useRef(0);
  const [scrubbingPositionMs, setScrubbingPositionMs] = useState<number | null>(null);
  const durationMsRef = useRef(durationMs);
  durationMsRef.current = durationMs;

  const currentDisplayPositionMs = scrubbingPositionMs !== null ? scrubbingPositionMs : positionMs;
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, currentDisplayPositionMs / durationMs)) : 0;

  const getPositionFromLocationX = useCallback((locationX: number) => {
    const width = barWidthRef.current;
    const dur = durationMsRef.current;
    if (width <= 0 || dur <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, locationX / width));
    return ratio * dur;
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => durationMsRef.current > 0,
        onMoveShouldSetPanResponder: () => durationMsRef.current > 0,
        onPanResponderGrant: (evt) => {
          Animated.spring(thumbScale, { toValue: 1.4, useNativeDriver: true }).start();
          const pos = getPositionFromLocationX(evt.nativeEvent.locationX);
          setScrubbingPositionMs(pos);
        },
        onPanResponderMove: (evt) => {
          const pos = getPositionFromLocationX(evt.nativeEvent.locationX);
          setScrubbingPositionMs(pos);
        },
        onPanResponderRelease: (evt) => {
          Animated.spring(thumbScale, { toValue: 1.0, useNativeDriver: true }).start();
          const pos = getPositionFromLocationX(evt.nativeEvent.locationX);
          setScrubbingPositionMs(null);
          void playerController.seek(pos);
        },
        onPanResponderTerminate: () => {
          Animated.spring(thumbScale, { toValue: 1.0, useNativeDriver: true }).start();
          setScrubbingPositionMs(null);
        },
      }),
    [getPositionFromLocationX, thumbScale],
  );

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

  const onBarLayout = (e: LayoutChangeEvent) => {
    barWidthRef.current = e.nativeEvent.layout.width;
  };

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
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) },
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
        <View style={styles.artworkArea}>
          <Animated.View
            style={[
              styles.artworkFrame,
              {
                width: artworkSize + ARTWORK_BORDER * 2,
                height: artworkSize + ARTWORK_BORDER * 2,
                transform: [{ scale: artworkScale }],
              },
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
                size={artworkSize}
                borderRadius={24}
                style={{ width: artworkSize, height: artworkSize }}
                imageStyle={{ width: artworkSize, height: artworkSize }}
              />
            </LiquidGlassView>
          </Animated.View>
        </View>

        {/* Song Info (Title & Artist) */}
        <View style={styles.metaSection}>
          <Text style={styles.title} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {track.artist}
            {track.album ? ` • ${track.album}` : ''}
          </Text>
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
            onPress={() => setPlaylistSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Save to playlist"
          >
            <LiquidGlassView shape="pill" intensity="high" style={styles.savePillInner}>
              <Ionicons name="add" size={18} color="#ffffff" />
              <Text style={styles.savePillText}>Save</Text>
            </LiquidGlassView>
          </Pressable>
        </View>

        {/* Seek Bar with Luminous Scrubber */}
        <View style={styles.progressSection}>
          <View
            style={styles.seekBar}
            onLayout={onBarLayout}
            {...panResponder.panHandlers}
          >
            <View style={styles.seekTrack}>
              <View style={[styles.seekFill, { width: `${progress * 100}%` }]}>
                <Animated.View
                  style={[styles.seekThumb, { transform: [{ scale: thumbScale }] }]}
                />
              </View>
            </View>
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(currentDisplayPositionMs)}</Text>
            <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
          </View>
        </View>

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
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          >
            <Animated.View
              style={[styles.playOrbContainer, { transform: [{ scale: playScale }] }]}
            >
              <LiquidGlassView
                shape="circle"
                intensity="ultra"
                style={styles.playOrbGlass}
              >
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={32}
                  color="#ffffff"
                  style={{ marginLeft: isPlaying ? 0 : 3 }}
                />
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

        {snapshot.status === 'error' && snapshot.errorMessage ? (
          <Text style={styles.errorText} numberOfLines={1}>
            {snapshot.errorMessage}
          </Text>
        ) : null}

        {/* Bottom Centered Liquid Glass "UP NEXT" Trigger */}
        <View style={styles.upNextTriggerContainer} {...swipeUpPanResponder.panHandlers}>
          <Pressable
            onPress={() => setUpNextSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Open Up Next queue"
          >
            <LiquidGlassView shape="pill" intensity="high" style={styles.upNextTriggerPill}>
              <Ionicons name="chevron-up" size={16} color="rgba(255, 255, 255, 0.7)" />
              <Text style={styles.upNextTriggerText}>UP NEXT</Text>
            </LiquidGlassView>
          </Pressable>
        </View>
      </ScrollView>

      {/* Sheets / Modals */}
      <AddToPlaylistSheet
        visible={playlistSheetVisible}
        track={track}
        onClose={() => setPlaylistSheetVisible(false)}
      />

      <OptionsMenuSheet
        visible={optionsMenuVisible}
        track={track}
        onClose={() => setOptionsMenuVisible(false)}
        onSaveToPlaylist={() => setPlaylistSheetVisible(true)}
        onGoToArtist={(artist) => {
          navigation.navigate('Search');
        }}
      />

      <UpNextSheet
        visible={upNextSheetVisible}
        currentTrack={track}
        upcomingTracks={upcomingTracks}
        queueIndex={snapshot.queueIndex}
        onClose={() => setUpNextSheetVisible(false)}
        onSelectTrack={(absoluteIndex) => void playerController.playAt(absoluteIndex)}
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
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    backgroundColor: '#4cc9f0',
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
