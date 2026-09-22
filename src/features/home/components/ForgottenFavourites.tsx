import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Track } from '../../../core/types/track';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { homeColors, homeRadius } from '../theme';

type ForgottenFavouritesProps = {
  tracks: readonly Track[];
  onSelectTrack: (track: Track, index: number) => void;
};

/**
 * YouTube Music "Forgotten favourites" carousel section.
 *
 * Horizontal rail of large artwork cards with title and artist below.
 */
export function ForgottenFavourites({ tracks, onSelectTrack }: ForgottenFavouritesProps) {
  if (tracks.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Forgotten favourites</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tracks.map((track, index) => (
          <Pressable
            key={track.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onSelectTrack(track, index)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${track.title}`}
          >
            <View style={styles.artwork}>
              <ArtworkPlaceholder track={track} size={140} borderRadius={8} />
            </View>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={styles.trackArtist} numberOfLines={1}>
              {track.artist}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 14,
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
    gap: 6,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.text,
  },
  trackArtist: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
});
