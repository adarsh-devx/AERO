import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Track } from '../../../core/types/track';
import { trackIdentityKey } from '../../../core/types/track';
import { musicService } from '../../../services/composition';
import type { Playlist } from '../types';
import { usePlaylists } from '../usePlaylists';
import { ArtworkPlaceholder } from '../../home/components/ArtworkPlaceholder';
import { homeColors, homeRadius } from '../../home/theme';

/**
 * How long the input must be quiet before the merged provider search runs.
 * Same value as the search-bar suggestion debounce: a typing burst costs one
 * request instead of one per keystroke.
 */
const SEARCH_DEBOUNCE_MS = 250;

type AddTracksSheetProps = {
  visible: boolean;
  /** Live playlist snapshot from the store — membership updates reactively. */
  playlist: Playlist;
  onClose: () => void;
};

/**
 * "Add tracks" picker for ONE playlist. Follows the AddToPlaylistSheet
 * visual language (same backdrop/sheet/row styles) but reversed: instead of
 * picking a playlist for a track, it searches for tracks and appends them to
 * this playlist.
 *
 * Data source is the existing MusicService only — no new provider:
 * - empty input → `search('')` returns the FULL local catalogue with no
 *   network traffic (the online provider answers empty needles with zero
 *   results), so the sheet opens with real songs immediately;
 * - typed input → debounced merged local + online search, same as Search.
 *
 * Membership uses `trackIdentityKey` (origin + id), so `local:X` and
 * `online:X` never collide. Already-added rows are shown as "Added" and
 * disabled; the store itself also refuses duplicates, so a double-tap is a
 * harmless no-op either way. Adding never touches playback: this sheet only
 * mutates the persistent playlists store.
 */
/**
 * One friendly, fixed failure line — raw provider/exception messages can
 * carry HTTP status codes, endpoint names or stack details and must never
 * be rendered. The technical cause is logged instead.
 */
const SEARCH_ERROR_MESSAGE = "Couldn't search right now. Please try again.";

export function AddTracksSheet({ visible, playlist, onClose }: AddTracksSheetProps) {
  const { addTrack } = usePlaylists();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** Latest-wins guard: only the newest request may touch results/loading. */
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fresh sheet on every open: clearing the query makes the search effect
  // below refire (its deps include query/visible) and reload the local
  // catalogue; closing mid-search leaves the stale request to be dropped by
  // the id guard when the sheet reopens.
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  // Debounced, latest-wins merged search. Empty query still goes through
  // musicService.search('') — that is the documented "full local catalogue"
  // call, and it never reaches the network.
  useEffect(() => {
    if (!visible) return;
    const trimmed = query.trim();
    const requestId = (requestIdRef.current += 1);
    setLoading(true);
    setErrorMessage(null);
    const timer = setTimeout(() => {
      void musicService.search(trimmed).then(
        ({ tracks, errors }) => {
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          setResults(tracks);
          // Only surface an error when there is nothing to show: partial
          // provider failures degrade to fewer results, same as Search.
          // Raw provider messages can carry HTTP codes / endpoint names and
          // never reach the screen — the real cause stays in the log.
          const firstError = errors.values().next().value;
          if (tracks.length === 0 && firstError) {
            console.warn('[ADD_TRACKS] provider search failed:', firstError);
            setErrorMessage(SEARCH_ERROR_MESSAGE);
          } else {
            setErrorMessage(null);
          }
          setLoading(false);
        },
        (err: unknown) => {
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          setResults([]);
          // Never render raw exception text (HTTP codes, endpoints, stacks).
          console.warn('[ADD_TRACKS] search failed:', err);
          setErrorMessage(SEARCH_ERROR_MESSAGE);
        },
      );
    }, trimmed.length === 0 ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [visible, query]);

  // Identity set of what the playlist already contains — membership checks
  // never use object reference equality.
  const addedKeys = new Set(playlist.tracks.map((track) => trackIdentityKey(track)));

  const handleAdd = (track: Track) => {
    // Store dedupes by identity and persists + notifies subscribers, so the
    // row flips to "Added" through the same reactive path as every edit.
    addTrack(playlist.id, track);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Add to {playlist.name}</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search your music"
            placeholderTextColor={homeColors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
            accessibilityLabel="Search tracks to add"
          />
          {loading && results.length === 0 ? (
            <ActivityIndicator style={styles.status} color={homeColors.textMuted} />
          ) : errorMessage !== null ? (
            <Text style={styles.error}>{errorMessage}</Text>
          ) : results.length === 0 ? (
            <Text style={styles.status}>No tracks found.</Text>
          ) : null}
          <FlatList
            data={results}
            keyExtractor={(track) => trackIdentityKey(track)}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            renderItem={({ item }) => {
              const isAdded = addedKeys.has(trackIdentityKey(item));
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                    isAdded && styles.rowAdded,
                  ]}
                  disabled={isAdded}
                  onPress={() => handleAdd(item)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isAdded ? `${item.title} is already in ${playlist.name}` : `Add ${item.title}`
                  }
                >
                  <ArtworkPlaceholder track={item} size={40} />
                  <View style={styles.rowMeta}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                      {item.artist}
                    </Text>
                  </View>
                  <Text style={isAdded ? styles.addedText : styles.addText}>
                    {isAdded ? 'Added' : 'Add'}
                  </Text>
                </Pressable>
              );
            }}
          />
          <Pressable
            style={styles.doneButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done adding tracks"
          >
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: homeColors.surfaceRaised,
    borderTopLeftRadius: homeRadius.surface,
    borderTopRightRadius: homeRadius.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 10,
    maxHeight: '85%',
  },
  sheetTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: homeColors.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: homeColors.border,
    borderRadius: homeRadius.artwork,
    backgroundColor: homeColors.surface,
    color: homeColors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  status: {
    fontSize: 12,
    color: homeColors.textFaint,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  error: {
    fontSize: 12,
    color: homeColors.textMuted,
    paddingVertical: 4,
  },
  list: {
    alignSelf: 'stretch',
    maxHeight: 360,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: homeRadius.artwork,
    gap: 12,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  rowAdded: {
    opacity: 0.6,
  },
  rowMeta: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  rowSubtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  addText: {
    fontSize: 13,
    fontWeight: '600',
    color: homeColors.text,
  },
  addedText: {
    fontSize: 12,
    color: homeColors.textFaint,
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: homeRadius.artwork,
    borderWidth: 1,
    borderColor: homeColors.border,
    backgroundColor: homeColors.surface,
  },
  doneText: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.text,
  },
});
