import React, { useRef, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { navigationRef } from '../../../navigation/navigationRef';
import { playerController } from '../../../services/composition';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { NextIcon, PauseIcon, PlayIcon } from './Icons';
import { LiquidGlassView } from '../../common/LiquidGlassView';

type MiniPlayerProps = {
  onPress?: () => void;
};

const MINI_ARTWORK = 44;

export function MiniPlayer({ onPress }: MiniPlayerProps) {
  const playScale = useRef(new Animated.Value(1)).current;

  const openNowPlaying =
    onPress ??
    (() => {
      if (navigationRef.isReady()) {
        navigationRef.navigate('NowPlaying');
      }
    });
  const snapshot = useSyncExternalStore(
    playerController.subscribe,
    playerController.getSnapshot,
  );

  if (!snapshot.currentTrack) {
    return null;
  }

  const track = snapshot.currentTrack;
  const isPlaying = snapshot.status === 'playing';

  const handleTogglePlay = (e: any) => {
    e.stopPropagation?.();
    Animated.sequence([
      Animated.timing(playScale, { toValue: 0.82, duration: 60, useNativeDriver: true }),
      Animated.spring(playScale, { toValue: 1.15, friction: 3, tension: 150, useNativeDriver: true }),
      Animated.spring(playScale, { toValue: 1.0, friction: 4, tension: 100, useNativeDriver: true }),
    ]).start();
    void playerController.togglePlayPause();
  };

  const handleNext = (e: any) => {
    e.stopPropagation?.();
    if (snapshot.hasNext) {
      void playerController.next();
    }
  };

  return (
    <Pressable
      style={styles.container}
      onPress={openNowPlaying}
      accessibilityRole="button"
      accessibilityLabel="Open Now Playing"
    >
      <LiquidGlassView
        shape="pill"
        intensity="ultra"
        style={styles.glassPill}
      >
        <View style={styles.contentRow}>
          {/* Circular Cover Artwork */}
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

          {/* Glass Play / Pause Orb */}
          <Pressable
            onPress={handleTogglePlay}
            style={styles.orbButton}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          >
            <Animated.View style={[styles.orbGlass, { transform: [{ scale: playScale }] }]}>
              {isPlaying ? <PauseIcon size={16} color="#ffffff" /> : <PlayIcon size={16} color="#ffffff" />}
            </Animated.View>
          </Pressable>

          {/* Next Button */}
          <Pressable
            style={styles.nextButton}
            accessibilityRole="button"
            accessibilityLabel="Next track"
            disabled={!snapshot.hasNext}
            onPress={handleNext}
          >
            <NextIcon size={16} color={snapshot.hasNext ? '#ffffff' : 'rgba(255, 255, 255, 0.3)'} />
          </Pressable>
        </View>
      </LiquidGlassView>
    </Pressable>
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
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 2,
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
});
