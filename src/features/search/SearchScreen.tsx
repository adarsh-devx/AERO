import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
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
import { trackIdentityKey, type Track } from '../../core/types/track';
import { songKey, alternateVersionCount } from '../../core/types/songKey';
import { EXPERIMENTAL_SEARCH_PREWARM } from '../../core/constants/experimental';
import { prewarmTrack } from '../../playback/ExperimentalTrackPreloader';
import { musicService, playerController, searchHistory } from '../../services/composition';
import { usePlaybackHistory } from '../history/usePlaybackHistory';
import { useSearchHistory } from './useSearchHistory';
import { useSearchSuggestions } from './useSearchSuggestions';
import { useSettings } from '../settings/useSettings';
import { startVoiceSearch } from './voiceSearch';
import { homeColors, homeRadius } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { OptionsMenuSheet } from '../nowplaying/components/OptionsMenuSheet';
import { AddToPlaylistSheet } from '../playlists/components/AddToPlaylistSheet';
import { LiquidGlassView } from '../common/LiquidGlassView';

type SearchScreenProps = NativeStackScreenProps<RootStackParamList, 'Search'>;

/**
 * Maps a merged search's provider error map to an honest one-line notice —
 * only ever shown alongside usable results. A failed online provider while
 * local hits exist is a degraded result, NOT a failed search.
 */
function partialFailureNotice(errors: ReadonlyMap<string, Error>): string | null {
  if (errors.size === 0) return null;
  const parts: string[] = [];
  if (errors.has('online')) parts.push('online results');
  if (errors.has('local')) parts.push('device music');
  if (parts.length === 0) parts.push('some results');
  return `Couldn't load ${parts.join(' or ')} — showing the rest.`;
}

/**
 * One friendly, fixed failure line for every search error. Raw provider
 * messages can carry HTTP status codes, endpoint names or resolver
 * internals and must never reach the screen; the real cause is logged for
 * debugging instead.
 */
const SEARCH_ERROR_MESSAGE = "Couldn't search right now. Please try again.";

/**
 * Duplicate-detection key for submitted queries: trimmed, inner whitespace
 * collapsed, case-insensitive. Used ONLY to decide whether a submission is a
 * repeat of one already displayed/in flight — the text sent to providers and
 * stored in history is the plain trimmed query, unchanged.
 */
function queryKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** m:ss for a genuinely present duration; rows without one render no time. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

/**
 * YouTube Music inspired Search Screen.
 *
 * Header: Liquid-glass Search Input pill (search glyph / suggestions
 * spinner, Clear ✕, Mic 🎤) — no back arrow, Search is a root tab.
 * Suggestions: provider-backed rows while the input diverges from the
 * submitted query (see useSearchSuggestions).
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
  // Reactive view of the two Search settings — flips apply immediately
  // through the ONE SettingsStore subscription, no restart needed.
  const { searchHistoryEnabled, searchSuggestionsEnabled } = useSettings();
  const persistedRecentQueries = useSearchHistory();
  // "Save search history" gates DISPLAY as well as recording: while it is
  // off, persisted queries are never shown (SearchHistory.record is already
  // gated at write time by the same setting), so the recent list reads empty.
  const recentQueries = searchHistoryEnabled ? persistedRecentQueries : [];

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<readonly Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Partial-failure notice: results are usable, but a provider was missing. */
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedTrackForOptions, setSelectedTrackForOptions] = useState<Track | null>(null);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<Track | null>(null);

  // Debounced provider suggestions for whatever is currently typed.
  const { suggestions, loading: suggestionsLoading, settled: suggestionsSettled } =
    useSearchSuggestions(query);
  const trimmedQuery = query.trim();
  /**
   * Suggestions replace the results/recent panes as soon as the input diverges
   * from the submitted query — i.e. while the user is still composing a search.
   * Once a search is submitted (input === submittedQuery) the results are shown,
   * and an empty input falls back to recent searches.
   */
  const showSuggestions =
    // "Search suggestions" off → no suggestion UI at all (the hook
    // additionally issues no requests while off).
    searchSuggestionsEnabled &&
    trimmedQuery.length > 0 &&
    trimmedQuery !== submittedQuery;

  /**
   * Stale-request guard for the full search flow (suggestions have their own
   * inside useSearchSuggestions). Every started search bumps the id; only the
   * LATEST request may touch results/error/loading — so a slow "blin" that
   * finishes after "blinding" is dropped instead of overwriting it.
   */
  const searchIdRef = useRef(0);
  /** Query whose results are on screen, or whose request is in flight. */
  const activeSearchRef = useRef<string | null>(null);
  /** True when `activeSearchRef`'s search failed — a failed query may be retried. */
  const activeSearchFailedRef = useRef(false);

  const runSearch = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (q.length === 0) {
        // Invalidate anything in flight: a late response must never repopulate
        // a box the user has emptied.
        searchIdRef.current += 1;
        activeSearchRef.current = null;
        activeSearchFailedRef.current = false;
        setSubmittedQuery('');
        setResults([]);
        setErrorMessage(null);
        setNotice(null);
        setLoading(false);
        return;
      }

      // Duplicate suppression: this NORMALISED form of the query (trim +
      // collapse whitespace + case, see queryKey) is already displayed or
      // already in flight (double-tapping a suggestion, re-submitting
      // "Queen" after "queen "). A previously FAILED query falls through —
      // that path is the retry.
      if (
        activeSearchRef.current !== null &&
        queryKey(q) === queryKey(activeSearchRef.current) &&
        !activeSearchFailedRef.current
      ) {
        Keyboard.dismiss();
        return;
      }

      // A submitted search is a deliberate action: get the keyboard out of the
      // way so the results are visible.
      Keyboard.dismiss();
      const requestId = (searchIdRef.current += 1);
      setSubmittedQuery(q);
      setLoading(true);
      setErrorMessage(null);
      setNotice(null);
      activeSearchRef.current = q;
      activeSearchFailedRef.current = false;

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
        // A superseded search must not cause side effects (prewarm).
        if (requestId !== searchIdRef.current) return;
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
        // Stale: a newer search superseded this one — only the latest may
        // update the UI (results, error, loading).
        if (requestId !== searchIdRef.current) return;
        // Conservative result de-duplication by the EXISTING track identity
        // (origin:id): first occurrence wins, provider order preserved.
        // local:X and online:X are different keys, so distinct sources never
        // merge, and trackIdentityKey semantics are untouched.
        const seenKeys = new Set<string>();
        const idDedupedTracks = tracks.filter((track) => {
          const key = trackIdentityKey(track);
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
        // Second pass: song-level dedup by folded title so the same song
        // uploaded by different YouTube channels (T-Series, Topic, lyrics
        // channels…) collapses to ONE result. When two uploads share a
        // songKey the one with fewer alternate-recording markers wins,
        // preferring the canonical upload.
        const bySong = new Map<string, Track>();
        for (const track of idDedupedTracks) {
          const sk = songKey(track);
          const held = bySong.get(sk);
          if (held === undefined) {
            bySong.set(sk, track);
          } else if (alternateVersionCount(track.title) < alternateVersionCount(held.title)) {
            bySong.set(sk, track);
          }
        }
        const dedupedTracks = [...bySong.values()];
        // Partial provider failure with usable results: keep the results AND
        // say what is missing — never a generic error over good local hits.
        setNotice(dedupedTracks.length > 0 ? partialFailureNotice(errors) : null);
        if (dedupedTracks.length === 0) {
          const firstError = errors.values().next().value;
          if (firstError) {
            activeSearchFailedRef.current = true;
            // Real cause stays in the log; the screen shows friendly text only.
            console.warn('[SEARCH] provider search failed:', firstError);
            setErrorMessage(SEARCH_ERROR_MESSAGE);
          }
        }
        setResults(dedupedTracks);

        // Fallback for online results that only ever appear in the merged
        // array. No-op when the hook already fired for this search.
        prewarmFirstOnline(dedupedTracks);
      } catch (err) {
        if (requestId !== searchIdRef.current) return; // stale failure: irrelevant now
        activeSearchFailedRef.current = true;
        // Never surface raw exception text (HTTP codes, endpoints, stacks).
        console.warn('[SEARCH] search failed:', err);
        setErrorMessage(SEARCH_ERROR_MESSAGE);
        setResults([]);
      } finally {
        // Only the latest request owns the loading flag: a superseded request
        // finishing early must not clear the indicator of the one still running.
        if (requestId === searchIdRef.current) setLoading(false);
      }
    },
    [],
  );

  /**
   * Queue first, then navigate — NEVER wait for the stream.
   *
   * `playFromQueue` publishes the new current track synchronously (status
   * 'loading'), so the Mini Player and Now Playing switch to the tapped song on
   * this frame; stream resolution continues in the background. Navigating first
   * and awaiting second is what previously kept the UI on the old song (and off
   * Now Playing) for the whole resolve.
   */
  const handlePlayTrack = useCallback(
    (track: Track, explicitQueue?: readonly Track[], explicitIndex?: number) => {
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

      // Fire-and-forget: the controller supersedes older requests, so rapid taps
      // simply move the selection on instead of queueing behind a slow resolve.
      void playerController.playFromQueue(queueTracks, targetIndex);
      navigation.navigate('NowPlaying');
    },
    [navigation, results, history],
  );

  /**
   * Clearing persistent search history is destructive → confirm first
   * (same Alert pattern as playlist/download deletion). Playback history
   * is a separate store and is not touched here.
   */
  const confirmClearHistory = () => {
    Alert.alert('Clear search history?', 'Your recent search queries will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => searchHistory.clear() },
    ]);
  };

  const handleClear = () => {
    // Invalidate any in-flight search: a late response must not repopulate
    // a box the user just emptied.
    searchIdRef.current += 1;
    activeSearchRef.current = null;
    activeSearchFailedRef.current = false;
    setLoading(false);
    setQuery('');
    setSubmittedQuery('');
    setResults([]);
    setErrorMessage(null);
    setNotice(null);
  };

  const handleVoiceSearch = async () => {
    const res = await startVoiceSearch();
    if (res.success && res.query) {
      setQuery(res.query);
      void runSearch(res.query);
    }
  };

  /**
   * Results are shown only while the box still holds text. Emptying the
   * input — the clear button or backspacing it all away — returns to
   * recent searches, so an empty box never leaves stale results on screen.
   */
  const isShowingResults = submittedQuery.length > 0 && trimmedQuery.length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      {/* Top Search Bar with Liquid Glass */}
      <View style={styles.searchBarRow}>
        {/* Full-width Liquid Glass Input Box Pill */}
        <LiquidGlassView shape="pill" intensity="high" style={styles.inputBox}>
          {showSuggestions && suggestionsLoading ? (
            // Subtle fetch indicator in a constant slot (swapped with the
            // search glyph): no layout jump, never a screen-wide spinner.
            <ActivityIndicator size="small" color="rgba(255, 255, 255, 0.55)" />
          ) : (
            <Ionicons name="search" size={18} color="rgba(255, 255, 255, 0.45)" />
          )}
          <TextInput
            style={styles.textInput}
            placeholder="Search songs, artists, albums"
            placeholderTextColor="rgba(255, 255, 255, 0.45)"
            value={query}
            onChangeText={(text) => setQuery(text)}
            onSubmitEditing={() => void runSearch(query)}
            returnKeyType="search"
            accessibilityRole="search"
            accessibilityLabel="Search"
          />

          {query.length > 0 ? (
            <Pressable
              style={styles.clearButton}
              onPress={handleClear}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.6)" />
            </Pressable>
          ) : null}

          {/* Mic Icon */}
          <Pressable
            style={styles.micButton}
            onPress={() => void handleVoiceSearch()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Voice search"
          >
            <Ionicons name="mic" size={20} color="rgba(255, 255, 255, 0.75)" />
          </Pressable>
        </LiquidGlassView>
      </View>

      {/* Main Content: Suggestions while typing, otherwise Results / Recent Searches */}
      {showSuggestions ? (
        <ScrollView
          style={styles.recentScrollView}
          contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {suggestionsLoading && suggestions.length === 0 ? (
            // First fetch in progress: one row of exactly the height a
            // suggestion row occupies, so nothing below jumps when the list
            // arrives. Never a full-screen spinner.
            <View
              style={styles.queryRow}
              accessibilityRole="progressbar"
              accessibilityLabel="Loading suggestions"
            >
              <View style={styles.queryIcon}>
                <ActivityIndicator size="small" color="#8e8e93" />
              </View>
            </View>
          ) : null}
          {!suggestionsLoading && suggestionsSettled && suggestions.length === 0 ? (
            // A finished request with nothing to offer — an honest hint that
            // distinguishes "settled empty" from "still fetching" (the row
            // above) and from "suggestions disabled" (no pane at all).
            // Suggestion failures land here too: non-critical UI, never an
            // error state for the screen.
            <View style={styles.queryRow} accessibilityRole="text">
              <Ionicons name="search" size={22} color="#8e8e93" style={styles.queryIcon} />
              <Text style={styles.queryText} numberOfLines={1}>
                No suggestions
              </Text>
            </View>
          ) : null}
          {suggestions.map((suggestion, index) => (
              <Pressable
                key={`suggestion-${index}-${suggestion}`}
                style={({ pressed }) => [styles.queryRow, pressed && styles.rowPressed]}
                onPress={() => {
                  setQuery(suggestion);
                  void runSearch(suggestion);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${suggestion}`}
              >
                <Ionicons name="search" size={22} color="#8e8e93" style={styles.queryIcon} />

                <Text style={styles.queryText} numberOfLines={1}>
                  {suggestion}
                </Text>

                {/* Same affordance as a recent query: fill the box, don't search. */}
                <Pressable
                  style={styles.diagonalArrowButton}
                  hitSlop={8}
                  onPress={(e) => {
                    e.stopPropagation();
                    setQuery(suggestion);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Fill search box with ${suggestion}`}
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
        </ScrollView>
      ) : loading && trimmedQuery.length > 0 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color="#ffffff" size="large" />
        </View>
      ) : isShowingResults ? (
        // Results View
        <View style={styles.resultsContainer}>
          {notice !== null ? (
            // Degraded-but-usable search: real results below, one honest
            // line about what failed to load above them.
            <View style={styles.noticeBanner} accessibilityRole="alert">
              <Ionicons name="cloud-offline-outline" size={14} color="#f5a623" />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}
          {errorMessage ? (
            <View style={styles.centerContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
              {/* Failed search → retry through the normal submit path (the
                  failed-query guard lets it bypass duplicate suppression). */}
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.rowPressed]}
                onPress={() => void runSearch(submittedQuery)}
                accessibilityRole="button"
                accessibilityLabel="Retry search"
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.centerContainer}>
              <Text style={styles.emptyText}>No results found for “{submittedQuery}”</Text>
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => trackIdentityKey(item)}
              contentContainerStyle={[styles.resultsList, { paddingBottom: insets.bottom + 110 }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
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

                  {/* Real duration when the provider/MediaStore supplied one;
                      omitted entirely otherwise — never a fabricated time. */}
                  {typeof item.durationMs === 'number' && item.durationMs > 0 ? (
                    <Text style={styles.resultDuration} numberOfLines={1}>
                      {formatDuration(item.durationMs)}
                    </Text>
                  ) : null}

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
          {/* Section Header: Recent searches (+ clear action) */}
          <View style={styles.recentHeaderRow}>
            <Text style={styles.recentSectionTitle}>Recent searches</Text>
            {recentQueries.length > 0 ? (
              <Pressable
                hitSlop={8}
                onPress={confirmClearHistory}
                accessibilityRole="button"
                accessibilityLabel="Clear search history"
              >
                <Text style={styles.clearAllText}>Clear all</Text>
              </Pressable>
            ) : null}
          </View>

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

                  {/* Remove this one query from persistent history */}
                  <Pressable
                    style={styles.diagonalArrowButton}
                    hitSlop={8}
                    onPress={(e) => {
                      e.stopPropagation();
                      searchHistory.remove(queryItem);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${queryItem} from search history`}
                  >
                    <Ionicons name="close" size={20} color="#8e8e93" />
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
        onGoToArtist={(artistName) => {
          // Real artist destination: the Artist screen resolves the actual
          // name through the one search path — never a re-run of this
          // screen's search box pretending to be an artist page.
          navigation.navigate('Artist', { artistName });
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
  recentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 14,
  },
  recentSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  clearAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: homeColors.accent,
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
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: homeRadius.artwork,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.35)',
    backgroundColor: 'rgba(245, 166, 35, 0.10)',
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: '#f5a623',
  },
  retryButton: {
    marginTop: 16,
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
  resultDuration: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
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
