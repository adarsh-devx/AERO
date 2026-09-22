import React, { useState } from 'react';
import { Image, StyleSheet, Text, View, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Track, getTrackArtworkUri } from '../../../core/types/track';
import { homeColors, homeRadius } from '../theme';

type ArtworkPlaceholderProps = {
  track: Track;
  size: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  borderRadius?: number;
};

/**
 * Universal Artwork Component:
 * - Renders remote cover image (YouTube thumbnail or custom artworkUri)
 * - Automatically derives YouTube thumbnail if missing
 * - Gracefully falls back to stylized initial or musical note on error/offline
 */
export function ArtworkPlaceholder({
  track,
  size,
  style,
  imageStyle,
  borderRadius = homeRadius.artwork,
}: ArtworkPlaceholderProps) {
  const [loadError, setLoadError] = useState(false);
  const artworkUri = getTrackArtworkUri(track);

  if (artworkUri && !loadError) {
    return (
      <View
        style={[
          styles.container,
          { width: size, height: size, borderRadius },
          style,
        ]}
      >
        <Image
          source={{ uri: artworkUri }}
          style={[
            styles.image,
            { width: size, height: size, borderRadius },
            imageStyle,
          ]}
          resizeMode="cover"
          onError={() => setLoadError(true)}
        />
      </View>
    );
  }

  // Fallback for local tracks or when image is unavailable
  const initial = track.title ? track.title.trim().charAt(0).toUpperCase() : '?';

  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius },
        style,
      ]}
    >
      {initial && initial !== '?' ? (
        <Text style={[styles.initial, { fontSize: Math.max(14, size * 0.38) }]}>
          {initial}
        </Text>
      ) : (
        <Ionicons name="musical-note" size={size * 0.45} color={homeColors.textFaint} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: homeColors.surfaceRaised,
  },
  image: {
    backgroundColor: homeColors.surfaceRaised,
  },
  tile: {
    backgroundColor: '#202020',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  initial: {
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
  },
});

