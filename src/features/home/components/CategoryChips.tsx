import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { homeColors } from '../theme';
import { TactilePressable } from '../../common/TactilePressable';
import { LiquidGlassView } from '../../common/LiquidGlassView';

const CATEGORIES = [
  'Podcasts',
  'Work out',
  'Feel good',
  'Energise',
  'Relax',
  'Focus',
  'Party',
  'Romance',
];

type CategoryChipsProps = {
  onSelectCategory?: (category: string | null) => void;
};

/**
 * YouTube Music horizontal scrolling mood / category filter chips with Liquid Glass aesthetics.
 */
export function CategoryChips({ onSelectCategory }: CategoryChipsProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handlePress = (category: string) => {
    const next = selected === category ? null : category;
    setSelected(next);
    if (onSelectCategory) {
      onSelectCategory(next);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {CATEGORIES.map((category) => {
          const isSelected = selected === category;
          return (
            <TactilePressable
              key={category}
              activeScale={0.93}
              onPress={() => handlePress(category)}
              accessibilityRole="button"
              accessibilityLabel={category}
            >
              <LiquidGlassView
                shape="pill"
                intensity={isSelected ? 'ultra' : 'subtle'}
                glowColor={isSelected ? 'rgba(76, 201, 240, 0.45)' : undefined}
                style={[
                  styles.glassChip,
                  isSelected && styles.glassChipSelected,
                ]}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                  {category}
                </Text>
              </LiquidGlassView>
            </TactilePressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  scrollContent: {
    gap: 8,
    paddingRight: 16,
  },
  glassChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.28)',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  glassChipSelected: {
    backgroundColor: 'rgba(76, 201, 240, 0.22)',
    borderTopColor: '#4cc9f0',
    borderBottomColor: '#4cc9f0',
    borderLeftColor: '#4cc9f0',
    borderRightColor: '#4cc9f0',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.75)',
  },
  chipTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
