import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { CardItem } from '../data';
import { homeColors } from '../theme';

type SquareCardsSectionProps = {
  title: string;
  subtitle?: string;
  items: readonly CardItem[];
  onSelectItem: (item: CardItem, index: number) => void;
};

/**
 * YouTube Music style square card carousel (Albums, Community playlists, Moods).
 */
import { TactilePressable } from '../../common/TactilePressable';

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
            accessibilityLabel={`Open ${item.title}`}
          >
            <View style={styles.artwork}>
              {item.artworkUri ? (
                <Image
                  source={{ uri: item.artworkUri }}
                  style={styles.artworkImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.gridPlaceholder}>
                  {/* Multi-cover / Playlist 4-grid look */}
                  <View style={styles.gridRow}>
                    <View style={[styles.gridCell, { backgroundColor: '#332222' }]} />
                    <View style={[styles.gridCell, { backgroundColor: '#223322' }]} />
                  </View>
                  <View style={styles.gridRow}>
                    <View style={[styles.gridCell, { backgroundColor: '#222233' }]} />
                    <View style={[styles.gridCell, { backgroundColor: '#333322' }]} />
                  </View>
                  {item.badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>
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
  cardPressed: {
    opacity: 0.8,
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
  gridPlaceholder: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  gridRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gridCell: {
    flex: 1,
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
