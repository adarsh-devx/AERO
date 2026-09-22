import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '../../../core/types/track';
import { ArtworkPlaceholder } from './ArtworkPlaceholder';
import { homeColors, homeRadius } from '../theme';

type TrendingPlaylistSectionProps = {
  playlist: {
    id: string;
    title: string;
    curator: string;
    meta: string;
    topTracks: readonly Track[];
  };
  onSelectTrack: (track: Track, index: number) => void;
  onOptionsPress?: (track: Track) => void;
};

/**
 * YouTube Music "Trending community playlists" featured card.
 */
export function TrendingPlaylistSection({
  playlist,
  onSelectTrack,
  onOptionsPress,
}: TrendingPlaylistSectionProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Trending community playlists</Text>

      <View style={styles.card}>
        {/* Playlist Header Row */}
        <View style={styles.playlistHeader}>
          <View style={styles.playlistCover}>
            <View style={styles.gridRow}>
              <View style={[styles.gridCell, { backgroundColor: '#4a2525' }]} />
              <View style={[styles.gridCell, { backgroundColor: '#254a35' }]} />
            </View>
            <View style={styles.gridRow}>
              <View style={[styles.gridCell, { backgroundColor: '#25354a' }]} />
              <View style={[styles.gridCell, { backgroundColor: '#4a4025' }]} />
            </View>
          </View>

          <View style={styles.playlistInfo}>
            <Text style={styles.playlistTitle} numberOfLines={2}>
              {playlist.title}
            </Text>
            <Text style={styles.playlistCurator} numberOfLines={1}>
              {playlist.curator}
            </Text>
            <Text style={styles.playlistMeta} numberOfLines={1}>
              {playlist.meta}
            </Text>
          </View>
        </View>

        {/* Top Tracks List */}
        <View style={styles.tracksList}>
          {playlist.topTracks.map((track, index) => (
            <Pressable
              key={track.id}
              style={({ pressed }) => [styles.trackRow, pressed && styles.trackRowPressed]}
              onPress={() => onSelectTrack(track, index)}
              accessibilityRole="button"
              accessibilityLabel={`Play ${track.title}`}
            >
              <View style={styles.artwork}>
                <ArtworkPlaceholder track={track} size={44} />
              </View>

              <View style={styles.meta}>
                <Text style={styles.trackTitle} numberOfLines={1}>
                  {track.title}
                </Text>
                <Text style={styles.trackArtist} numberOfLines={1}>
                  {track.artist}
                </Text>
              </View>

              <Pressable
                style={styles.optionsButton}
                hitSlop={8}
                onPress={(e) => {
                  e.stopPropagation();
                  if (onOptionsPress) onOptionsPress(track);
                }}
                accessibilityRole="button"
                accessibilityLabel="Options"
              >
                <Ionicons name="ellipsis-vertical" size={18} color={homeColors.textMuted} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 14,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: homeColors.text,
    marginBottom: 12,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  playlistHeader: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  playlistCover: {
    width: 90,
    height: 90,
    borderRadius: 8,
    overflow: 'hidden',
  },
  gridRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gridCell: {
    flex: 1,
  },
  playlistInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  playlistTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: homeColors.text,
  },
  playlistCurator: {
    fontSize: 13,
    fontWeight: '500',
    color: homeColors.textMuted,
  },
  playlistMeta: {
    fontSize: 12,
    color: homeColors.textFaint,
  },
  tracksList: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 12,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: homeRadius.surface,
  },
  trackRowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  artwork: {
    width: 44,
    height: 44,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  meta: {
    flex: 1,
    gap: 2,
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
  optionsButton: {
    padding: 6,
  },
});
