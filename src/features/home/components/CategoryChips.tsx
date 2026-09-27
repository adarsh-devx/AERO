import { ScrollView, StyleSheet, Text, View } from 'react-native';

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
  /** Controlled selection so Home's feed state and the chip UI can never drift
   *  (pull-to-refresh refreshes exactly what is selected). */
  selectedCategory: string | null;
  /** `null` clears the filter and returns Home to its default feed. */
  onSelectCategory?: (category: string | null) => void;
};

/**
 * YouTube Music horizontal scrolling mood / category filter chips with Liquid Glass aesthetics.
 */
export function CategoryChips({ selectedCategory, onSelectCategory }: CategoryChipsProps) {
  const handlePress = (category: string) => {
    const next = selectedCategory === category ? null : category;
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
          const isSelected = selectedCategory === category;
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
