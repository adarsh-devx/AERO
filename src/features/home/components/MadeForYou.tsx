import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Track } from '../../../core/types/track';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { homeColors, homeSpacing, mutedText } from '../theme';

const RAIL_ARTWORK = 148;
const CARD_WIDTH = RAIL_ARTWORK + homeSpacing.screenX;
const CARD_COUNT_BUFFER = 2;

type MadeForYouProps = {
  tracks: readonly Track[];
};

/**
 * Horizontally scrollable rail of large artwork cards:
 * big square artwork, album/title, artist.
 * Content width is sized from the screen so cards peek on either
 * side without hardcoding a single device viewport.
 */
export function MadeForYou({ tracks }: MadeForYouProps) {
  const railWidth = Dimensions.get('window').width;
  const snapWidth = railWidth / CARD_COUNT_BUFFER;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={snapWidth}
      decelerationRate="fast"
      contentContainerStyle={styles.rail}
    >
      {tracks.map((track) => (
        <View key={track.id} style={styles.card}>
          <ArtworkPlaceholder track={track} size={RAIL_ARTWORK} />
          <View style={styles.meta}>
            <Text style={mutedText.title} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={mutedText.subtitle} numberOfLines={1}>
              {track.artist}
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: {
    paddingRight: homeSpacing.screenX,
  },
  card: {
    width: CARD_WIDTH,
    marginRight: homeSpacing.itemGap,
  },
  meta: {
    marginTop: 10,
    gap: 3,
  },
});

