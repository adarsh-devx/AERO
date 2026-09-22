import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { VideoItem } from '../data';
import { homeColors } from '../theme';

type VideoCardsSectionProps = {
  title: string;
  videos: readonly VideoItem[];
  onSelectVideo: (video: VideoItem, index: number) => void;
  onPlayAll?: () => void;
};

/**
 * YouTube Music "Music videos for you" horizontal rail of 16:9 widescreen cards.
 */
import { TactilePressable } from '../../common/TactilePressable';

export function VideoCardsSection({
  title,
  videos,
  onSelectVideo,
  onPlayAll,
}: VideoCardsSectionProps) {
  if (videos.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {onPlayAll ? (
          <TactilePressable
            activeScale={0.92}
            style={styles.playAllButton}
            onPress={onPlayAll}
            accessibilityRole="button"
            accessibilityLabel={`Play all ${title}`}
          >
            <Text style={styles.playAllText}>Play all</Text>
          </TactilePressable>
        ) : null}
      </View>

      {/* 16:9 Widescreen Cards Scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {videos.map((video, index) => (
          <TactilePressable
            key={video.id}
            activeScale={0.95}
            style={styles.card}
            onPress={() => onSelectVideo(video, index)}
            accessibilityRole="button"
            accessibilityLabel={`Play video ${video.title} by ${video.artist}`}
          >
            {/* Widescreen 16:9 Thumbnail Frame */}
            <View style={styles.thumbnailFrame}>
              {video.thumbnailUri ? (
                <Image
                  source={{ uri: video.thumbnailUri }}
                  style={styles.thumbnailImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.placeholderBg}>
                  <Ionicons name="videocam" size={28} color="rgba(255, 255, 255, 0.4)" />
                </View>
              )}
              {/* Subtle play badge */}
              <View style={styles.playBadge}>
                <Ionicons name="play" size={12} color="#ffffff" style={{ marginLeft: 2 }} />
              </View>
            </View>

            <Text style={styles.videoTitle} numberOfLines={1}>
              {video.title}
            </Text>
            <Text style={styles.videoMeta} numberOfLines={1}>
              {video.artist} • {video.views}
            </Text>
          </TactilePressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: homeColors.text,
  },
  playAllButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  playAllButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  playAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: homeColors.text,
  },
  scrollContent: {
    gap: 14,
    paddingRight: 16,
  },
  card: {
    width: 220,
    gap: 4,
  },
  cardPressed: {
    opacity: 0.8,
  },
  thumbnailFrame: {
    width: 220,
    height: 124, // 16:9 approx
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
    position: 'relative',
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  placeholderBg: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.text,
    marginTop: 4,
  },
  videoMeta: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
});
