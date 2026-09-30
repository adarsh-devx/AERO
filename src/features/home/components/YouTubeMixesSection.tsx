import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { homeColors, homeRadius, homeSpacing, sectionHeading } from '../theme';
import { TactilePressable } from '../../common/TactilePressable';
import type { YouTubeMixCard } from '../../youtube/YouTubeAccountService';

interface YouTubeMixesSectionProps {
  readonly mixes: readonly YouTubeMixCard[];
  readonly onSelectMix: (mix: YouTubeMixCard) => void;
}

export function YouTubeMixesSection({ mixes, onSelectMix }: YouTubeMixesSectionProps) {
  if (mixes.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleWithIcon}>
          <Ionicons name="sparkles" size={18} color="#4cc9f0" />
          <Text style={styles.heading}>Mixed for you</Text>
        </View>
        <Text style={styles.badgeLabel}>YouTube Mixes</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {mixes.map((mix) => (
          <TactilePressable
            key={mix.id}
            activeScale={0.95}
            style={styles.card}
            onPress={() => onSelectMix(mix)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${mix.title}`}
          >
            {/* Mix Artwork with "▶| Mix" Badge */}
            <View style={styles.artworkContainer}>
              {mix.thumbnailUrl ? (
                <Image source={{ uri: mix.thumbnailUrl }} style={styles.artwork} />
              ) : (
                <View style={[styles.artwork, styles.artworkPlaceholder]}>
                  <Ionicons name="disc-outline" size={40} color="#8e8e93" />
                </View>
              )}

              {/* YouTube "▶| Mix" Badge */}
              <View style={styles.mixBadge}>
                <Ionicons name="play" size={10} color="#ffffff" style={{ marginRight: 2 }} />
                <View style={styles.mixBadgeDivider} />
                <Text style={styles.mixBadgeText}>Mix</Text>
              </View>
            </View>

            {/* Metadata */}
            <Text style={styles.title} numberOfLines={2}>
              {mix.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {mix.subtitle || 'Playlist • Auto Mix'}
            </Text>
          </TactilePressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: homeSpacing.screenX,
    marginBottom: 14,
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heading: {
    ...sectionHeading,
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ff4d4d',
    backgroundColor: 'rgba(255, 77, 77, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  scrollContent: {
    paddingHorizontal: homeSpacing.screenX,
    gap: 14,
  },
  card: {
    width: 170,
    gap: 6,
  },
  artworkContainer: {
    width: 170,
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#181822',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  artwork: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  artworkPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  mixBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  mixBadgeDivider: {
    width: 1.5,
    height: 9,
    backgroundColor: '#ffffff',
    marginRight: 4,
    opacity: 0.8,
  },
  mixBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: homeColors.text,
    lineHeight: 17,
  },
  subtitle: {
    fontSize: 11,
    color: homeColors.textMuted,
  },
});
