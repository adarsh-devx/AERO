import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../navigation';
import type { Track } from '../../core/types/track';
import { EXPERIMENTAL_SEARCH_PREWARM } from '../../core/constants/experimental';
import { prewarmTrack } from '../../playback/ExperimentalTrackPreloader';
import { musicService, playerController, searchHistory } from '../../services/composition';
import { usePlaybackHistory } from '../history/usePlaybackHistory';
import { useSearchHistory } from './useSearchHistory';
import { homeColors, homeRadius } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { OptionsMenuSheet } from '../nowplaying/components/OptionsMenuSheet';
import { AddToPlaylistSheet } from '../playlists/components/AddToPlaylistSheet';
import { LiquidGlassView } from '../common/LiquidGlassView';

type SearchScreenProps = NativeStackScreenProps<RootStackParamList, 'Search'>;

/**
 * YouTube Music inspired Search Screen.
 *
 * Header: Back arrow (←) + Pill Search Input ("Type to search") + Mic icon (🎤).
 * Recent Searches:
 * - Dynamic persistent queries from searchHistory.
 * - Horizontal rail of recent song cards (Thumbnail + Title).
 * - Vertical query list with clock icon (🕒) and diagonal arrow (↖).
 * Results:
 * - YouTube Music style song rows with artwork, title, subtitle & 3-dots menu (⋮).
 */
export function SearchScreen({ navigation }: SearchScreenProps) {
  const insets = useSafeAreaInsets();
  const history = usePlaybackHistory();
  const recentQueries = useSearchHistory();

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<readonly Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [selectedTrackForOptions, setSelectedTrackForOptions] = useState<Track | null>(null);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<Track | null>(null);

  const openingRef = useRef(false);

  const runSearch = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (q.length === 0) {
        setSubmittedQuery('');
        setResults([]);
        return;
      }

      setSubmittedQuery(q);
      setLoading(true);
      setErrorMessage(null);

      // Save to persistent recent search queries
      searchHistory.record(q);

      // Warm the first playable online result as soon as the online results
      // exist — NOT when the merged search returns.
      //
      // search() merges every provider behind one Promise.allSettled, and the
      // device provider does a permission round-trip (which can open a
      // permission prompt) followed by a full MediaStore scan. Waiting for that
      // merge held the online results — ready in a few hundred ms — for however
      // long the local scan took, so prewarm could only start afterwards.
      // onProviderResults fires per provider instead, so the resolve now starts
      // at the earliest moment the online Track object exists.
      //
      // Exactly one prewarm target per search: the first online result, which is
      // also what the merged array would have yielded first, so the resolver
      // key (and therefore tap-time adoption) is unchanged.
      let prewarmStarted = false;
      const prewarmFirstOnline = (candidates: readonly Track[]) => {
        if (prewarmStarted || !EXPERIMENTAL_SEARCH_PREWARM) return;
        // Online only — never issue a network resolve for a local file.
        const firstOnline = candidates.find((t) => t.origin === 'online');
        if (!firstOnline) return;
        prewarmStarted = true;

        // Best effort: this never starts playback, never mutates the queue or
        // the current track, and never navigates. It resolves through the
        // existing resolver, so it reuses that resolver's cache and in-flight
        // de-duplication, and a tap during the resolve adopts the same promise.
        prewarmTrack(firstOnline);
      };

      try {
        const { tracks, errors } = await musicService.search(q, {
          onProviderResults: (_providerId, providerTracks) => prewarmFirstOnline(providerTracks),
        });
        if (tracks.length === 0) {
          const firstError = errors.values().next().value;
          if (firstError) {
            setErrorMessage(firstError.message ?? 'Search failed. Please try again.');
          }
        }
        setResults(tracks);

        // Fallback for online results that only ever appear in the merged
        // array. No-op when the hook already fired for this search.
        prewarmFirstOnline(tracks);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to search');
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handlePlayTrack = useCallback(
    (track: Track, explicitQueue?: readonly Track[], explicitIndex?: number) => {
      if (openingRef.current) return;
      openingRef.current = true;
      void (async () => {
        try {
          let queueTracks: readonly Track[];
          let targetIndex: number;

          if (explicitQueue && explicitQueue.length > 0) {
            queueTracks = explicitQueue;
            targetIndex = explicitIndex ?? queueTracks.findIndex((t) => t.id === track.id);
            if (targetIndex === -1) targetIndex = 0;
          } else if (results.length > 0) {
            queueTracks = results;
            targetIndex = explicitIndex ?? queueTracks.findIndex((t) => t.id === track.id);
            if (targetIndex === -1) targetIndex = 0;
          } else {
            queueTracks = history.length > 0 ? history : [track];
            targetIndex = queueTracks.findIndex((t) => t.id === track.id);
            if (targetIndex === -1) targetIndex = 0;
          }

          await playerController.playFromQueue(queueTracks, targetIndex);
          navigation.navigate('NowPlaying');
        } finally {
          openingRef.current = false;
        }
      })();
    },
    [navigation, results, history],
  );

  const handleClear = () => {
    setQuery('');
    setSubmittedQuery('');
    setResults([]);
    setErrorMessage(null);
  };

  const isShowingResults = submittedQuery.length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      {/* Top Search Bar with Liquid Glass */}
      <View style={styles.searchBarRow}>
        {/* Full-width Liquid Glass Input Box Pill */}
        <LiquidGlassView shape="pill" intensity="high" style={styles.inputBox}>
          <Ionicons name="search" size={18} color="rgba(255, 255, 255, 0.45)" />
          <TextInput
            style={styles.textInput}
            placeholder="Search songs, artists, albums"
            placeholderTextColor="rgba(255, 255, 255, 0.45)"
            value={query}
            onChangeText={(text) => setQuery(text)}
            onSubmitEditing={() => void runSearch(query)}
            returnKeyType="search"
          />

          {query.length > 0 ? (
            <Pressable style={styles.clearButton} onPress={handleClear} hitSlop={8}>
              <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.6)" />
            </Pressable>
          ) : null}

          {/* Mic Icon */}
          <Pressable
            style={styles.micButton}
            onPress={() => {
              /* Voice search trigger */
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Voice search"
          >
            <Ionicons name="mic" size={20} color="#4cc9f0" />
          </Pressable>
        </LiquidGlassView>
      </View>

      {/* Main Content: Results or Recent Searches */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color="#ffffff" size="large" />
        </View>
      ) : isShowingResults ? (
        // Results View
        <View style={styles.resultsContainer}>
          {errorMessage ? (
            <View style={styles.centerContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.centerContainer}>
              <Text style={styles.emptyText}>No results found for “{submittedQuery}”</Text>
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item, index) => `${item.origin ?? 'search'}:${item.id}:${index}`}
              contentContainerStyle={[styles.resultsList, { paddingBottom: insets.bottom + 110 }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => (
                <Pressable
                  style={({ pressed }) => [styles.resultRow, pressed && styles.rowPressed]}
                  onPress={() => handlePlayTrack(item, results, index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${item.title}`}
                >
                  <View style={styles.artwork}>
                    <ArtworkPlaceholder track={item} size={48} />
                  </View>


                  <View style={styles.resultMeta}>
                    <Text style={styles.resultTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.resultSubtitle} numberOfLines={1}>
                      {item.artist}
                      {item.album ? ` • ${item.album}` : ''}
                    </Text>
                  </View>

                  <Pressable
                    style={styles.optionsButton}
                    hitSlop={8}
                    onPress={(e) => {
                      e.stopPropagation();
                      setSelectedTrackForOptions(item);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Options"
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={homeColors.textMuted} />
                  </Pressable>
                </Pressable>
              )}
            />
          )}
        </View>
      ) : history.length > 0 || recentQueries.length > 0 ? (
        // Recent Searches View (YouTube Music Style)
        <ScrollView
          style={styles.recentScrollView}
          contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Section Header: Recent searches */}
          <Text style={styles.recentSectionTitle}>Recent searches</Text>

          {/* 1. Horizontal Rail of Recent Song Thumbnails */}
          {history.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbnailsRail}
            >
              {history.slice(0, 8).map((track) => (
                <Pressable
                  key={`recent-card-${track.id}`}
                  style={({ pressed }) => [styles.thumbnailCard, pressed && styles.cardPressed]}
                  onPress={() => handlePlayTrack(track, history)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${track.title}`}
                >
                  <View style={styles.thumbnailArtwork}>
                    <ArtworkPlaceholder track={track} size={100} borderRadius={8} />
                  </View>
                  <Text style={styles.thumbnailTitle} numberOfLines={1}>
                    {track.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* 2. Vertical List of Real Search Queries */}
          {recentQueries.length > 0 ? (
            <View style={styles.queriesList}>
              {recentQueries.map((queryItem, index) => (
                <Pressable
                  key={`query-${index}-${queryItem}`}
                  style={({ pressed }) => [styles.queryRow, pressed && styles.rowPressed]}
                  onPress={() => {
                    setQuery(queryItem);
                    void runSearch(queryItem);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Search for ${queryItem}`}
                >
                  {/* Clock / Time Icon */}
                  <Ionicons name="time-outline" size={22} color="#8e8e93" style={styles.queryIcon} />

                  <Text style={styles.queryText} numberOfLines={1}>
                    {queryItem}
                  </Text>

                  {/* Diagonal Arrow Icon (↖) to populate input */}
                  <Pressable
                    style={styles.diagonalArrowButton}
                    hitSlop={8}
                    onPress={(e) => {
                      e.stopPropagation();
                      setQuery(queryItem);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Fill search box with ${queryItem}`}
                  >
                    <Ionicons
                      name="arrow-back-outline"
                      size={20}
                      color="#8e8e93"
                      style={{ transform: [{ rotate: '45deg' }] }}
                    />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : (
        // Clean Initial State when no history exists yet
        <View style={styles.initialEmptyState}>
          <Ionicons name="search" size={56} color="rgba(255, 255, 255, 0.15)" />
          <Text style={styles.initialEmptyTitle}>Find what you love</Text>
          <Text style={styles.initialEmptySubtitle}>
            Search for songs, artists, albums, or music videos.
          </Text>
        </View>
      )}

      {/* 3-Dots Options Menu Modal */}
      <OptionsMenuSheet
        visible={selectedTrackForOptions !== null}
        track={selectedTrackForOptions}
        onClose={() => setSelectedTrackForOptions(null)}
        onSaveToPlaylist={() => {
          setSelectedTrackForPlaylist(selectedTrackForOptions);
        }}
        onGoToArtist={(artist) => {
          setQuery(artist);
          void runSearch(artist);
        }}
      />

      {/* Add To Playlist Sheet */}
      <AddToPlaylistSheet
        visible={selectedTrackForPlaylist !== null}
        track={selectedTrackForPlaylist}
        onClose={() => setSelectedTrackForPlaylist(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0c',
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 16,
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: '#ffffff',
    paddingVertical: 0,
  },
  clearButton: {
    padding: 4,
  },
  micButton: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentScrollView: {
    flex: 1,
  },
  recentSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 14,
  },
  thumbnailsRail: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 16,
  },
  thumbnailCard: {
    width: 100,
    gap: 6,
  },
  cardPressed: {
    opacity: 0.8,
  },
  thumbnailArtwork: {
    width: 100,
    height: 100,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#ffffff',
  },
  queriesList: {
    paddingTop: 4,
  },
  queryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 16,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  queryIcon: {
    width: 24,
  },
  queryText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    color: '#ffffff',
  },
  diagonalArrowButton: {
    padding: 6,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: 15,
    color: '#ff4d6d',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#8e8e93',
    textAlign: 'center',
  },
  resultsContainer: {
    flex: 1,
  },
  resultsList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  artwork: {
    width: 48,
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultMeta: {
    flex: 1,
    gap: 3,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  resultSubtitle: {
    fontSize: 13,
    color: '#8e8e93',
  },
  optionsButton: {
    padding: 8,
  },
  initialEmptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
    paddingBottom: 60,
  },
  initialEmptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 8,
  },
  initialEmptySubtitle: {
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    lineHeight: 20,
  },
});
