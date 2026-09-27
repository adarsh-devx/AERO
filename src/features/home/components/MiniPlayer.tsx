import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { navigationRef } from '../../../navigation/navigationRef';
import { playerController } from '../../../services/composition';
import { shallowEqual, usePlayerSelector } from '../../../playback/usePlayerSelector';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from './Icons';
import { LiquidGlassView } from '../../common/LiquidGlassView';

type MiniPlayerProps = {
  onPress?: () => void;
};

const MINI_ARTWORK = 44;

/**
 * Global MiniPlayer — a normal, static surface. Opening Now Playing happens
 * only through the plain tap on the meta area (an explicit navigation
 * action); there are no drag/transition gestures, no transition store and
 * no animated open/close on this component.
 */
export function MiniPlayer({ onPress }: MiniPlayerProps) {
  const playScale = useRef(new Animated.Value(1)).current;

  const { currentTrack, status, hasNext, hasPrevious } = usePlayerSelector(
    (snapshot) => ({
      currentTrack: snapshot.currentTrack,
      status: snapshot.status,
      hasNext: snapshot.hasNext,
      hasPrevious: snapshot.hasPrevious,
    }),
    shallowEqual,
  );

  if (!currentTrack) {
    return null;
  }

  const track = currentTrack;
  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';

  const openNowPlaying = () => {
    if (onPress) {
      onPress();
    } else if (navigationRef.isReady()) {
      navigationRef.navigate('NowPlaying');
    }
  };

  const handleTogglePlay = (e: any) => {
    e?.stopPropagation?.();
    Animated.sequence([
      Animated.timing(playScale, { toValue: 0.82, duration: 60, useNativeDriver: true }),
      Animated.spring(playScale, { toValue: 1.15, friction: 3, tension: 150, useNativeDriver: true }),
      Animated.spring(playScale, { toValue: 1.0, friction: 4, tension: 100, useNativeDriver: true }),
    ]).start();
    void playerController.togglePlayPause();
  };

  const handleNext = (e: any) => {
    e?.stopPropagation?.();
    if (hasNext) {
      void playerController.next();
    }
  };

  const handlePrevious = (e: any) => {
    e?.stopPropagation?.();
    if (hasPrevious) {
      void playerController.previous();
    }
  };

  return (
    <View style={styles.container}>
      <LiquidGlassView
        shape="pill"
        intensity="ultra"
        style={styles.glassPill}
      >
        <View style={styles.contentRow}>
          {/* Tappable Area (Artwork + Title + Artist) */}
          <Pressable
            style={styles.metaContainer}
            onPress={openNowPlaying}
            accessibilityRole="button"
            accessibilityLabel="Open Now Playing"
          >
            <ArtworkPlaceholder
              track={track}
              size={MINI_ARTWORK}
              borderRadius={999}
            />
            <View style={styles.meta}>
              <Text style={styles.title} numberOfLines={1}>
                {track.title}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {track.artist}
              </Text>
            </View>
          </Pressable>

          {/* Previous Button */}
          <Pressable
            style={styles.prevButton}
            accessibilityRole="button"
            accessibilityLabel="Previous track"
            disabled={!hasPrevious}
            onPress={handlePrevious}
            hitSlop={8}
          >
            <PrevIcon
              size={16}
              color={hasPrevious ? '#ffffff' : 'rgba(255, 255, 255, 0.3)'}
            />
          </Pressable>

          {/* Glass Play / Pause Orb */}
          <Pressable
            onPress={handleTogglePlay}
            style={styles.orbButton}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel={
              isLoading
                ? 'Loading selected track'
                : status === 'error'
                  ? 'Retry playback'
                  : isPlaying
                    ? 'Pause'
                    : 'Play'
            }
            hitSlop={8}
          >
            <Animated.View style={[styles.orbGlass, { transform: [{ scale: playScale }] }]}>
              {isLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : status === 'error' ? (
                // Same retry affordance as the Now Playing play orb: a tap
                // re-runs the selection through PlayerController (never a
                // direct engine call), so both surfaces retry identically.
                <Ionicons name="refresh" size={15} color="#ffffff" />
              ) : isPlaying ? (
                <PauseIcon size={16} color="#ffffff" />
              ) : (
                <PlayIcon size={16} color="#ffffff" />
              )}
            </Animated.View>
          </Pressable>

          {/* Next Button */}
          <Pressable
            style={styles.nextButton}
            accessibilityRole="button"
            accessibilityLabel="Next track"
            disabled={!hasNext}
            onPress={handleNext}
            hitSlop={8}
          >
            <NextIcon size={16} color={hasNext ? '#ffffff' : 'rgba(255, 255, 255, 0.3)'} />
          </Pressable>
        </View>
      </LiquidGlassView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  glassPill: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 16,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  metaContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  meta: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.1,
  },
  artist: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  orbButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbGlass: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  nextButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prevButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
