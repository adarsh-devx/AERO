import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getTrackArtworkUri, trackIdentityKey } from '../../core/types/track';
import { musicService, playerController } from '../../services/composition';
import { usePrewarmTracks } from '../../playback/usePrewarmTracks';
import { homeColors } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { OptionsMenuSheet } from '../nowplaying/components/OptionsMenuSheet';
import { AddToPlaylistSheet } from '../playlists/components/AddToPlaylistSheet';
import { groupTracksByAlbum, trackMatchesArtist } from '../library/grouping';

type ArtistScreenProps = NativeStackScreenProps<RootStackParamList, 'Artist'>;

/**
 * Bounded result list: enough for a real artist page, small enough to keep
 * these (non-virtualised) rows cheap. Local matches come first — the merged
 * search appends online results behind the device catalogue.
 */
const MAX_ARTIST_SONGS = 50;

/**
 * Dynamic Artist Screen, built from real data only.
 *
 * ONE merged musicService.search(artistName) supplies both the device
 * catalogue (the device provider matches its artist field) and online
 * results — never a direct InnerTube call. Membership is then filtered
 * conservatively through `trackMatchesArtist` (exact normalised artist or
 * its primary segment), so a title-only hit by another artist is never
 * claimed and "Queen" never absorbs "Queen Latifah". Local results stay
 * usable when the network half fails; a total failure offers Retry.
 *
 * No subscriber counts, popularity, biography or genre exist here because
 * no provider supplies them — fabricated metadata has no place on a real
 * page. Play/Shuffle delegate to the ONE PlayerController; track actions
 * are the same OptionsMenuSheet + AddToPlaylistSheet every surface uses.
 */
export function ArtistScreen({ route, navigation }: ArtistScreenProps) {
  const insets = useSafeAreaInsets();
  const artistName = route.params?.artistName ?? 'Artist';

  const [songs, setSongs] = useState<readonly Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [optionsTrack, setOptionsTrack] = useState<Track | null>(null);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  // Shared prewarm seam: warm the artist list's first playable online track
  // as soon as the list arrives, so the first tap is cached or in flight.
  usePrewarmTracks(songs);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setLoadFailed(false);

    void (async () => {
      try {
        // Bare artist name through the ONE service: local + online behind a
        // single Promise.allSettled — a failed provider degrades to fewer
        // results instead of an error screen over usable local content.
        const { tracks, errors } = await musicService.search(artistName);
        if (!isMounted) return;
        const matched = tracks.filter((track) => trackMatchesArtist(track, artistName));
        setSongs(matched.slice(0, MAX_ARTIST_SONGS));
        // Honest failure: nothing came back at all AND a provider broke.
        setLoadFailed(tracks.length === 0 && errors.size > 0);
      } catch (err) {
        console.warn('[ARTIST] failed to load real tracks for', artistName, err);
        if (isMounted) {
          setSongs([]);
          setLoadFailed(true);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [artistName, reloadCount]);

  // Deterministic artist artwork: the first matched track with effective
  // artwork. Otherwise the existing letter avatar — nothing is fetched
  // just for the header.
  const coverTrack = songs.find((track) => getTrackArtworkUri(track));

  // Albums by this artist: a pure derivation over the matched tracks, using
  // the SAME groupTracksByAlbum the Library uses — so the keys it produces
  // are exactly what the Album screen looks up (online search results carry
  // no album metadata and naturally drop out).
  const artistAlbums = useMemo(() => groupTracksByAlbum(songs), [songs]);

  /**
   * Queue first, then navigate. `playFromQueue` publishes the new current
   * track synchronously (status 'loading'), so Now Playing opens on the
   * tapped song immediately and stream resolution finishes in the background.
   *
   * No in-flight guard here: a second tap must be allowed to win (the
   * controller supersedes the older request).
   */
  const handlePlaySong = useCallback(
    (index: number) => {
      if (songs.length === 0) return;
      void playerController.playFromQueue(songs, index);
      navigation.navigate('NowPlaying');
    },
    [songs, navigation],
  );

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    void playerController.playFromQueue(songs, 0);
  };

  const handleShuffle = () => {
    if (songs.length === 0) return;
    // Same delegation as PlaylistScreen: load the list as the source queue,
    // then let the ONE PlayerController shuffle mechanism order it — no
    // second shuffle algorithm lives here.
    const shuffleWasEnabled = playerController.getSnapshot().shuffleEnabled;
    void playerController.playFromQueue(songs, 0);
    if (!shuffleWasEnabled) {
      void playerController.toggleShuffle();
    }
  };

  const isEmpty = songs.length === 0;

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
          {artistName}
        </Text>

        <Pressable
          style={styles.backButton}
          onPress={() => navigation.navigate('Search')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Search artist"
        >
          <Ionicons name="search-outline" size={22} color="#ffffff" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Artist Hero: real artwork (when any matched track has it), name,
            real song count, Play + Shuffle. No channel banners, subscriber
            lines or decorative Subscribe buttons — none of that data exists. */}
        <View style={styles.heroSection}>
          {coverTrack ? (
            <ArtworkPlaceholder
              track={coverTrack}
              size={140}
              borderRadius={70}
              style={styles.artistAvatarLarge}
            />
          ) : (
            <View style={styles.artistAvatarLarge}>
              <Text style={styles.avatarLetter}>{artistName.charAt(0)}</Text>
            </View>
          )}
          <Text style={styles.artistName}>{artistName}</Text>
          {!loading ? (
            <Text style={styles.songCount}>
              {songs.length} {songs.length === 1 ? 'song' : 'songs'}
            </Text>
          ) : null}

          <View style={styles.heroActions}>
            <Pressable
              style={({ pressed }) => [
                styles.playButton,
                pressed && styles.buttonPressed,
                isEmpty && styles.buttonDisabled,
              ]}
              disabled={isEmpty}
              onPress={handlePlayAll}
              accessibilityRole="button"
              accessibilityLabel={`Play songs by ${artistName}`}
            >
              <Ionicons name="play" size={18} color="#000000" />
              <Text style={styles.playText}>Play</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.shuffleButton,
                pressed && styles.buttonPressed,
                isEmpty && styles.buttonDisabled,
              ]}
              disabled={isEmpty}
              onPress={handleShuffle}
              accessibilityRole="button"
              accessibilityLabel={`Shuffle songs by ${artistName}`}
            >
              <Ionicons name="shuffle" size={18} color="#ffffff" />
              <Text style={styles.shuffleText}>Shuffle</Text>
            </Pressable>
          </View>
        </View>

        {/* Songs Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Songs</Text>
          {!isEmpty ? (
            <Pressable
              onPress={handlePlayAll}
              accessibilityRole="button"
              accessibilityLabel="Play all songs"
            >
              <Text style={styles.seeAllText}>Play all</Text>
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color="#ffffff" size="large" />
          </View>
        ) : isEmpty ? (
          <View style={styles.centerContainer}>
            <Text style={styles.emptyText}>
              {loadFailed
                ? "Couldn't load songs right now."
                : `No songs found for ${artistName}`}
            </Text>
            {loadFailed ? (
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                onPress={() => setReloadCount((count) => count + 1)}
                accessibilityRole="button"
                accessibilityLabel="Try again"
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.songsList}>
            {songs.map((song, index) => (
              <Pressable
                key={trackIdentityKey(song)}
                style={({ pressed }) => [styles.songRow, pressed && styles.rowPressed]}
                onPress={() => handlePlaySong(index)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${song.title}`}
              >
                <Text style={styles.songIndex}>{index + 1}</Text>

                <View style={styles.songArtwork}>
                  {/* Same artwork treatment as Home/Library: reads the Track's
                      artwork field and degrades to the shared placeholder when
                      it is missing or fails to load. */}
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

        {/* Albums by this artist — real derivations, navigates to the Album
            screen through the shared grouping key. Hidden when there are none. */}
        {artistAlbums.length > 0 ? (
          <View>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Albums</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.albumRail}
            >
              {artistAlbums.map((album) => (
                <Pressable
                  key={album.key}
                  style={({ pressed }) => [styles.albumCard, pressed && styles.rowPressed]}
                  onPress={() => navigation.navigate('Album', { albumKey: album.key })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open album ${album.title}`}
                >
                  <View style={styles.albumArtwork}>
                    <ArtworkPlaceholder track={album.artworkTrack} size={132} borderRadius={8} />
                  </View>
                  <Text style={styles.albumTitle} numberOfLines={1}>
                    {album.title}
                  </Text>
                  <Text style={styles.albumSubtitle} numberOfLines={1}>
                    {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>

      {/* Track Options Sheet — the same actions as every other surface */}
      <OptionsMenuSheet
        visible={optionsTrack !== null}
        track={optionsTrack}
        onClose={() => setOptionsTrack(null)}
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
  artistAvatarLarge: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    elevation: 8,
    backgroundColor: '#240046',
    overflow: 'hidden',
  },
  avatarLetter: {
    fontSize: 54,
    fontWeight: '800',
    color: '#ffffff',
  },
  artistName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  songCount: {
    fontSize: 14,
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
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  centerContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  emptyText: {
    fontSize: 15,
    color: '#8e8e93',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  retryButton: {
    paddingVertical: 9,
    paddingHorizontal: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surfaceRaised,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
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
  rowPressed: {
    opacity: 0.7,
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
  albumRail: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 8,
  },
  albumCard: {
    width: 132,
    gap: 6,
  },
  albumArtwork: {
    width: 132,
    height: 132,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
  },
  albumTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  albumSubtitle: {
    fontSize: 12,
    color: '#8e8e93',
  },
});
