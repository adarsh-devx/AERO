import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../navigation';
import type { Track } from '../../core/types/track';
import { trackIdentityKey } from '../../core/types/track';
import { playerController } from '../../services/composition';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import { useLibraryTracks } from '../library/useLibraryTracks';
import { groupTracksByAlbum } from '../library/grouping';
import { homeColors } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { OptionsMenuSheet } from '../nowplaying/components/OptionsMenuSheet';
import { AddToPlaylistSheet } from '../playlists/components/AddToPlaylistSheet';

type AlbumScreenProps = NativeStackScreenProps<RootStackParamList, 'Album'>;

/**
 * Album detail — the Library's album grouping looked up by its stable key.
 *
 * Real metadata only: artwork comes from the existing deterministic rule
 * (the group's first-seen `artworkTrack` through ArtworkPlaceholder), the
 * release line shows only a release date the source actually tagged, and
 * the track list uses the group's existing stable order — reordered by
 * disc/track number ONLY when the source genuinely tagged track numbers
 * (then the tagged number is what the row shows; the plain list position
 * is shown otherwise, never presented as a tagged number). Identity is the
 * exact same `groupTracksByAlbum` key the Library renders —
 * `id:<albumId>` when the source has one, otherwise
 * `title:<normalized>|artist:<normalized>`, so same-titled albums by
 * different artists can never collide.
 *
 * Playback delegates entirely to PlayerController: rows and Play build a
 * queue context from the SAME displayed order, so the tapped row is the
 * track that plays; Shuffle uses the ONE existing shuffle mechanism.
 * Track actions are the shared OptionsMenuSheet + AddToPlaylistSheet —
 * no local copies of like/download/playlist logic.
 */
export function AlbumScreen({ route, navigation }: AlbumScreenProps) {
  const insets = useSafeAreaInsets();
  const { albumKey } = route.params;

  // Same one-fetch-per-session catalogue hook the Library tab uses — no
  // second library state system, no per-render provider calls.
  const { tracks: libraryTracks, loading, error, reload } = useLibraryTracks(true);
  const [optionsTrack, setOptionsTrack] = useState<Track | null>(null);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  // The ONE grouping rule, memoized — lookup is by stable key, never by
  // object reference.
  const album = useMemo(
    () => groupTracksByAlbum(libraryTracks).find((candidate) => candidate.key === albumKey),
    [libraryTracks, albumKey],
  );

  // Display order + release, computed from REAL tagged metadata only:
  //
  // - Ordering: disc → track number when ANY track in the group carries a
  //   tagged trackNumber (files partially tagged keep their original
  //   relative order and sort after numbered ones). When no track is
  //   tagged — the common online/untagged case — the existing stable
  //   first-seen/MediaStore order is preserved exactly. Sorting is stable
  //   (original index breaks every tie), so this never reshuffles a list
  //   that has no real numbers to order by.
  // - Release: the first releaseDate any track in the group states. Absent
  //   → null → the hero simply shows no year (never a guessed one).
  const { displayTracks, releaseLabel } = useMemo(() => {
    const tracks = album?.tracks ?? [];
    const anyTagged = tracks.some((track) => typeof track.trackNumber === 'number');
    let ordered = tracks;
    if (anyTagged) {
      ordered = tracks
        .map((track, index) => ({ track, index }))
        .sort((a, b) => {
          const discA = a.track.discNumber ?? 1;
          const discB = b.track.discNumber ?? 1;
          if (discA !== discB) return discA - discB;
          const numA = typeof a.track.trackNumber === 'number' ? a.track.trackNumber : Number.MAX_SAFE_INTEGER;
          const numB = typeof b.track.trackNumber === 'number' ? b.track.trackNumber : Number.MAX_SAFE_INTEGER;
          if (numA !== numB) return numA - numB;
          return a.index - b.index;
        })
        .map((entry) => entry.track);
    }
    const release = tracks.find((track) => track.releaseDate)?.releaseDate ?? null;
    return { displayTracks: ordered, releaseLabel: release };
  }, [album]);

  // Shared prewarm seam: warm the album's first playable online track.
  // Called before the early returns so hook order stays stable.
  usePrewarmTracks(displayTracks);

  const handlePlay = useCallback(
    (index: number) => {
      if (!album) return;
      // Queue the DISPLAYED order so row N plays the track shown at row N.
      void playerController.playFromQueue(displayTracks, index);
      navigation.navigate('NowPlaying');
    },
    [album, displayTracks, navigation],
  );

  const handleShuffle = () => {
    if (displayTracks.length === 0) return;
    // Same delegation as Playlist/Artist: load the album as the source
    // queue, then let the ONE PlayerController shuffle mechanism order it.
    const shuffleWasEnabled = playerController.getSnapshot().shuffleEnabled;
    void playerController.playFromQueue(displayTracks, 0);
    if (!shuffleWasEnabled) {
      void playerController.toggleShuffle();
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#ffffff" size="large" />
      </View>
    );
  }

  if (!album) {
    // Distinguish "the library couldn't load" from "this album key doesn't
    // exist (stale navigation)" — never fill the screen with fake content.
    if (error !== null) {
      return (
        <View style={[styles.container, styles.centered]}>
          <Text style={styles.emptyText}>Couldn't load your music library.</Text>
          <Pressable
            style={({ pressed }) => [styles.pillButton, pressed && styles.pressed]}
            onPress={reload}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.pillText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.missingTitle}>Album not found</Text>
        <Text style={styles.emptyText}>It may have been removed from your library.</Text>
      </View>
    );
  }

  const isEmpty = album.tracks.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Navigation Bar */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {album.title}
        </Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: album artwork (existing deterministic artworkTrack +
            ArtworkPlaceholder fallback), title, artist, real track count. */}
        <View style={styles.heroSection}>
          <View style={styles.albumArtwork}>
            <ArtworkPlaceholder track={album.artworkTrack} size={180} borderRadius={8} />
          </View>
          <Text style={styles.albumTitle} numberOfLines={2}>
            {album.title}
          </Text>
          <Text style={styles.albumArtist} numberOfLines={1}>
            {album.artist}
          </Text>
          <Text style={styles.albumCount}>
            {[releaseLabel, `${album.tracks.length} ${album.tracks.length === 1 ? 'song' : 'songs'}`]
              .filter(Boolean)
              .join(' • ')}
          </Text>

          <View style={styles.heroActions}>
            <Pressable
              style={({ pressed }) => [
                styles.playButton,
                pressed && styles.pressed,
                isEmpty && styles.buttonDisabled,
              ]}
              disabled={isEmpty}
              onPress={() => handlePlay(0)}
              accessibilityRole="button"
              accessibilityLabel={`Play ${album.title}`}
            >
              <Ionicons name="play" size={18} color="#000000" />
              <Text style={styles.playText}>Play</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.shuffleButton,
                pressed && styles.pressed,
                isEmpty && styles.buttonDisabled,
              ]}
              disabled={isEmpty}
              onPress={handleShuffle}
              accessibilityRole="button"
              accessibilityLabel={`Shuffle ${album.title}`}
            >
              <Ionicons name="shuffle" size={18} color="#ffffff" />
              <Text style={styles.shuffleText}>Shuffle</Text>
            </Pressable>
          </View>
        </View>

        {/* Track list — real tagged disc/track numbers when the source has
            them (see displayTracks), stable group order otherwise. The
            leading number is the tagged track number when one exists and
            the visual list position when it does not. */}
        {isEmpty ? (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>This album has no playable tracks.</Text>
          </View>
        ) : (
          <View style={styles.songsList}>
            {displayTracks.map((song, index) => (
              <Pressable
                key={trackIdentityKey(song)}
                style={({ pressed }) => [styles.songRow, pressed && styles.pressed]}
                onPress={() => handlePlay(index)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${song.title}`}
              >
                <Text style={styles.songIndex}>
                  {typeof song.trackNumber === 'number' ? song.trackNumber : index + 1}
                </Text>
                <View style={styles.songArtwork}>
                  <ArtworkPlaceholder track={song} size={48} />
                </View>
                <View style={styles.songMeta}>
                  <Text style={styles.songTitle} numberOfLines={1}>
                    {song.title}
                  </Text>
                  <Text style={styles.songSubtitle} numberOfLines={1}>
                    {song.artist}
                  </Text>
                </View>
                <Pressable
                  style={styles.songMenuButton}
                  hitSlop={8}
                  onPress={(e) => {
                    e.stopPropagation();
                    setOptionsTrack(song);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Options for ${song.title}`}
                >
                  <Ionicons name="ellipsis-vertical" size={18} color="#8e8e93" />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Track Options Sheet — same actions as every other surface */}
      <OptionsMenuSheet
        visible={optionsTrack !== null}
        track={optionsTrack}
        onClose={() => setOptionsTrack(null)}
        onGoToArtist={(artistName) => navigation.navigate('Artist', { artistName })}
      />
      <AddToPlaylistSheet
        visible={addToPlaylistVisible}
        track={optionsTrack}
        onClose={() => setAddToPlaylistVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030303',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 52,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  albumArtwork: {
    width: 180,
    height: 180,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
    marginBottom: 16,
    elevation: 8,
  },
  albumTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  },
  albumArtist: {
    fontSize: 14,
    color: '#ffffff',
    marginBottom: 2,
  },
  albumCount: {
    fontSize: 13,
    color: '#8e8e93',
    marginBottom: 18,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  playText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
  },
  shuffleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  shuffleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  pillButton: {
    paddingVertical: 9,
    paddingHorizontal: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surfaceRaised,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  missingTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  emptyText: {
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
  },
  songsList: {
    paddingHorizontal: 16,
    gap: 6,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  songIndex: {
    width: 20,
    fontSize: 15,
    fontWeight: '600',
    color: '#8e8e93',
    textAlign: 'center',
  },
  songArtwork: {
    width: 48,
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
  },
  songMeta: {
    flex: 1,
    gap: 3,
  },
  songTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  songSubtitle: {
    fontSize: 13,
    color: '#8e8e93',
  },
  songMenuButton: {
    padding: 8,
  },
});
