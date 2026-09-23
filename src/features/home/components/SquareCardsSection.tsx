import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CardItem } from '../data';
import { homeColors } from '../theme';
import { TactilePressable } from '../../common/TactilePressable';

type SquareCardsSectionProps = {
  title: string;
  subtitle?: string;
  items: readonly CardItem[];
  onSelectItem: (item: CardItem, index: number) => void;
};

function SquareArtwork({ item }: { item: CardItem }) {
  const [loadError, setLoadError] = useState(false);
  const artworkUri = item.artworkUri ?? (item.tracks && item.tracks[0]?.artworkUri);

  React.useEffect(() => {
    setLoadError(false);
  }, [artworkUri]);

  if (artworkUri && !loadError) {
    return (
      <View style={styles.artwork}>
        <Image
          source={{ uri: artworkUri }}
          style={styles.artworkImage}
          resizeMode="cover"
          onError={() => setLoadError(true)}
        />
        {item.badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.badge}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // Styled fallback when image is unavailable or failed to load
  return (
    <View style={[styles.artwork, styles.fallbackContainer]}>
      <Ionicons name="musical-notes" size={36} color={homeColors.accent} />
      {item.badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * YouTube Music style square card carousel (Albums, Community playlists, Moods).
 */
export function SquareCardsSection({
  title,
  subtitle,
  items,
  onSelectItem,
}: SquareCardsSectionProps) {
  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((item, index) => (
          <TactilePressable
            key={item.id}
            activeScale={0.94}
            style={styles.card}
            onPress={() => onSelectItem(item, index)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${item.title}`}
          >
            <SquareArtwork item={item} />
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {item.subtitle}
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
  sectionSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: homeColors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: homeColors.text,
    marginBottom: 12,
  },
  scrollContent: {
    gap: 14,
    paddingRight: 16,
  },
  card: {
    width: 140,
    gap: 4,
  },
  artwork: {
    width: 140,
    height: 140,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
    position: 'relative',
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  fallbackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f1f23',
  },
  badge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ff4d6d',
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.text,
    marginTop: 4,
  },
  cardSubtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
});
