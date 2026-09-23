import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../navigation';
import { tabStore } from '../../navigation/tabStore';
import type { Track } from '../../core/types/track';
import { playerController } from '../../services/composition';
import { usePlaylists } from '../playlists/usePlaylists';
import { useLikedSongs } from '../liked/useLikedSongs';
import { usePlaybackHistory } from '../history/usePlaybackHistory';
import { useDownloads } from '../downloads/useDownloads';
import { TactilePressable } from '../common/TactilePressable';
import { homeColors, homeRadius } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { LiquidGlassView } from '../common/LiquidGlassView';

type LibraryScreenProps = NativeStackScreenProps<RootStackParamList, 'Library'>;

type FilterType = 'All' | 'Downloads' | 'Playlists' | 'Songs' | 'Albums' | 'Artists';
type SortType = 'recent' | 'recently_added' | 'alphabetical';

const FILTER_CHIPS: FilterType[] = ['Downloads', 'Playlists', 'Songs', 'Albums', 'Artists'];

const SORT_LABELS: Record<SortType, string> = {
  recent: 'Recent activity',
  recently_added: 'Recently added',
  alphabetical: 'A to Z (Alphabetical)',
};

interface SampleArtist {
  id: string;
  name: string;
  subscribers: string;
  artworkUri?: string;
}

const SAMPLE_ARTISTS: SampleArtist[] = [
  { id: 'art-1', name: 'Talwinder', subscribers: '1.24M subscribers' },
  { id: 'art-2', name: 'Shubh', subscribers: '7.72M subscribers' },
  { id: 'art-3', name: 'Arijit Singh', subscribers: '42.5M subscribers' },
  { id: 'art-4', name: 'AP Dhillon', subscribers: '4.8M subscribers' },
  { id: 'art-5', name: 'Yo Yo Honey Singh', subscribers: '14.5M subscribers' },
];

/**
 * YouTube Music inspired Library Screen.
 *
 * Header:
 * - "Library" bold title + History (🕒), Search (🔍), Profile Avatar.
 * Filter Chips:
 * - Downloads, Playlists, Songs, Albums, Artists.
 * Sort & View Toggle:
 * - "Recent activity ⌄" with working Sort Bottom Sheet + Working Grid/List toggle button.
 * Content List:
 * - Downloads (offline tracks with 1-click play & zero internet).
 * - Pinned Liked Music (gradient card + 📌 Auto playlist).
 * - User created playlists (4-tile cover + track count).
 * - Artists (navigates to full ArtistScreen discography).
 * Floating Action Button:
 * - White "+ New" pill button to create new playlists.
 */
export function LibraryScreen({ navigation }: LibraryScreenProps) {
  const insets = useSafeAreaInsets();
  const { playlists, createPlaylist, deletePlaylist } = usePlaylists();
  const { likedTracks } = useLikedSongs();
  const { downloads, removeDownload } = useDownloads();
  const history = usePlaybackHistory();

  const [activeFilter, setActiveFilter] = useState<FilterType>('All');
  const [isGridView, setIsGridView] = useState(false);
  const [isSortModalVisible, setIsSortModalVisible] = useState(false);
  const [sortType, setSortType] = useState<SortType>('recent');

  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [selectedPlaylistForMenu, setSelectedPlaylistForMenu] = useState<string | null>(null);

  const handleCreatePlaylist = () => {
    const trimmed = newPlaylistName.trim();
    if (trimmed.length > 0) {
      const newId = createPlaylist(trimmed);
      setNewPlaylistName('');
      setIsCreateModalVisible(false);
      if (newId) {
        navigation.navigate('Playlist', { playlistId: newId });
      }
    }
  };

  const handlePlayDownloadedTrack = (index: number) => {
    void (async () => {
      await playerController.playFromQueue(downloads, index);
      navigation.navigate('NowPlaying');
    })();
  };

  const handlePlaySongTrack = (track: Track, index: number) => {
    void (async () => {
      await playerController.playFromQueue(history, index);
      navigation.navigate('NowPlaying');
    })();
  };

  // Sorted items based on active sortType
  const sortedDownloads = useMemo(() => {
    const list = [...downloads];
    if (sortType === 'alphabetical') {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [downloads, sortType]);

  const sortedPlaylists = useMemo(() => {
    const list = [...playlists];
    if (sortType === 'alphabetical') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [playlists, sortType]);

  const sortedArtists = useMemo(() => {
    const list = [...SAMPLE_ARTISTS];
    if (sortType === 'alphabetical') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [sortType]);

  const sortedSongs = useMemo(() => {
    const list = history.slice(0, 20);
    if (sortType === 'alphabetical') {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [history, sortType]);

  const shouldShowDownloads = activeFilter === 'All' || activeFilter === 'Downloads';
  const shouldShowLiked = activeFilter === 'All' || activeFilter === 'Playlists' || activeFilter === 'Songs';
  const shouldShowPlaylists = activeFilter === 'All' || activeFilter === 'Playlists';
  const shouldShowArtists = activeFilter === 'All' || activeFilter === 'Artists';
  const shouldShowSongs = activeFilter === 'Songs';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
      {/* 1. Header (YouTube Music Style) */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        <View style={styles.headerActions}>
          {/* History Icon (🕒) -> Opens Recently Played History */}
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation.navigate('RecentlyPlayedHistory')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Playback history"
          >
            <Ionicons name="time-outline" size={24} color="#ffffff" />
          </Pressable>

          {/* Search Icon (🔍) -> Switches to Search Tab Instantly */}
          <Pressable
            style={styles.iconButton}
            onPress={() => tabStore.setTab('search')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <Ionicons name="search-outline" size={24} color="#ffffff" />
          </Pressable>

          <View style={styles.avatar}>
            <Text style={styles.avatarText}>A</Text>
          </View>
        </View>
      </View>

      {/* 2. Filter Chips */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsScroll}
        >
          {FILTER_CHIPS.map((chip) => {
            const isSelected = activeFilter === chip;
            return (
              <TactilePressable
                key={chip}
                activeScale={0.93}
                onPress={() => setActiveFilter(isSelected ? 'All' : chip)}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${chip}`}
              >
                <LiquidGlassView
                  shape="pill"
                  intensity={isSelected ? 'ultra' : 'subtle'}
                  glowColor={isSelected ? 'rgba(76, 201, 240, 0.45)' : undefined}
                  style={[
                    styles.glassFilterChip,
                    isSelected && styles.glassFilterChipSelected,
                  ]}
                >
                  <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                    {chip}
                  </Text>
                </LiquidGlassView>
              </TactilePressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 3. Sort & View Toggle Row */}
      <View style={styles.controlsRow}>
        {/* Sort Trigger Button */}
        <Pressable
          style={styles.sortButton}
          onPress={() => setIsSortModalVisible(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Sort by: ${SORT_LABELS[sortType]}`}
        >
          <Text style={styles.sortText}>{SORT_LABELS[sortType]}</Text>
          <Ionicons name="chevron-down" size={16} color="#ffffff" />
        </Pressable>

        {/* List / Grid View Toggle Button */}
        <Pressable
          style={styles.viewToggleButton}
          onPress={() => setIsGridView((prev) => !prev)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={isGridView ? 'Switch to list view' : 'Switch to grid view'}
        >
          <Ionicons
            name={isGridView ? 'list-outline' : 'grid-outline'}
            size={20}
            color="#ffffff"
          />
        </Pressable>
      </View>

      {/* 4. Main Content List / Grid */}
      <ScrollView
        style={styles.contentScrollView}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        {isGridView ? (
          // ==================== 2-COLUMN GRID VIEW ====================
          <View style={styles.gridContainer}>
            {/* Liked Music in Grid */}
            {shouldShowLiked ? (
              <Pressable
                style={styles.gridCard}
                onPress={() => navigation.navigate('LikedSongs')}
                accessibilityRole="button"
                accessibilityLabel="Liked music auto playlist"
              >
                <View style={[styles.gridArtwork, styles.likedGridArtwork]}>
                  <Ionicons name="heart" size={36} color="#ffffff" />
                </View>
                <Text style={styles.gridTitle} numberOfLines={1}>Liked music</Text>
                <Text style={styles.gridSubtitle} numberOfLines={1}>Auto playlist • {likedTracks.length} tracks</Text>
              </Pressable>
            ) : null}

            {/* Playlists in Grid */}
            {shouldShowPlaylists &&
              sortedPlaylists.map((playlist) => (
                <Pressable
                  key={`grid-pl-${playlist.id}`}
                  style={styles.gridCard}
                  onPress={() => navigation.navigate('Playlist', { playlistId: playlist.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Playlist ${playlist.name}`}
                >
                  <View style={styles.gridArtwork}>
                    <Ionicons name="musical-notes" size={36} color="#8e8e93" />
                  </View>
                  <Text style={styles.gridTitle} numberOfLines={1}>{playlist.name}</Text>
                  <Text style={styles.gridSubtitle} numberOfLines={1}>Playlist • {playlist.tracks.length} tracks</Text>
                </Pressable>
              ))}

            {/* Downloads in Grid */}
            {shouldShowDownloads &&
              sortedDownloads.map((track, index) => (
                <Pressable
                  key={`grid-dl-${track.id}-${index}`}
                  style={styles.gridCard}
                  onPress={() => handlePlayDownloadedTrack(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play downloaded song ${track.title}`}
                >
                  <View style={styles.gridArtwork}>
                    <ArtworkPlaceholder track={track} size={150} borderRadius={8} />
                    <View style={styles.downloadBadge}>
                      <Ionicons name="arrow-down-circle" size={16} color="#4cc9f0" />
                    </View>
                  </View>
                  <Text style={styles.gridTitle} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.gridSubtitle} numberOfLines={1}>{track.artist} • Offline</Text>
                </Pressable>
              ))}

            {/* Artists in Grid */}
            {shouldShowArtists &&
              sortedArtists.map((artist) => (
                <Pressable
                  key={`grid-art-${artist.id}`}
                  style={styles.gridCard}
                  onPress={() => navigation.navigate('Artist', { artistName: artist.name })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open artist ${artist.name}`}
                >
                  <View style={[styles.gridArtwork, styles.artistGridArtwork]}>
                    <Ionicons name="person" size={36} color="#8e8e93" />
                  </View>
                  <Text style={styles.gridTitle} numberOfLines={1}>{artist.name}</Text>
                  <Text style={styles.gridSubtitle} numberOfLines={1}>{artist.subscribers}</Text>
                </Pressable>
              ))}

            {/* Songs in Grid */}
            {shouldShowSongs &&
              sortedSongs.map((track, index) => (
                <Pressable
                  key={`grid-song-${track.id}-${index}`}
                  style={styles.gridCard}
                  onPress={() => handlePlaySongTrack(track, index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play song ${track.title}`}
                >
                  <View style={styles.gridArtwork}>
                    <ArtworkPlaceholder track={track} size={150} borderRadius={8} />
                  </View>
                  <Text style={styles.gridTitle} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.gridSubtitle} numberOfLines={1}>{track.artist}</Text>
                </Pressable>
              ))}
          </View>
        ) : (
          // ==================== 1-COLUMN LIST VIEW ====================
          <View style={styles.listContainer}>
            {/* Downloads / Offline Tracks Section */}
            {shouldShowDownloads && sortedDownloads.length > 0 ? (
              <View style={styles.sectionBlock}>
                {activeFilter === 'All' ? (
                  <Text style={styles.subSectionHeader}>Downloaded ({sortedDownloads.length})</Text>
                ) : null}
                {sortedDownloads.map((track, index) => (
                  <Pressable
                    key={`dl-${track.id}-${index}`}
                    style={({ pressed }) => [styles.itemRow, pressed && styles.rowPressed]}
                    onPress={() => handlePlayDownloadedTrack(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`Play downloaded song ${track.title}`}
                  >
                    <View style={styles.downloadArtwork}>
                      <ArtworkPlaceholder track={track} size={56} borderRadius={8} />
                      <View style={styles.downloadBadge}>
                        <Ionicons name="arrow-down-circle" size={16} color="#4cc9f0" />
                      </View>
                    </View>

                    <View style={styles.itemMeta}>
                      <Text style={styles.itemTitle} numberOfLines={1}>
                        {track.title}
                      </Text>
                      <Text style={styles.itemSubtitle} numberOfLines={1}>
                        {track.artist} • Offline
                      </Text>
                    </View>

                    <Pressable
                      style={styles.itemMenuButton}
                      hitSlop={8}
                      onPress={(e) => {
                        e.stopPropagation();
                        removeDownload(track);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Remove download"
                    >
                      <Ionicons name="trash-outline" size={18} color="#8e8e93" />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            ) : activeFilter === 'Downloads' ? (
              <View style={styles.emptyFilterState}>
                <Ionicons name="arrow-down-circle-outline" size={54} color="rgba(255, 255, 255, 0.2)" />
                <Text style={styles.emptyFilterTitle}>No downloads yet</Text>
                <Text style={styles.emptyFilterSubtitle}>
                  Tap the 3-dots menu on any song and select "Download" to save songs for offline playback.
                </Text>
              </View>
            ) : null}

            {/* Pinned Liked Music */}
            {shouldShowLiked ? (
              <Pressable
                style={({ pressed }) => [styles.itemRow, pressed && styles.rowPressed]}
                onPress={() => navigation.navigate('LikedSongs')}
                accessibilityRole="button"
                accessibilityLabel="Liked music auto playlist"
              >
                <View style={styles.likedArtwork}>
                  <Ionicons name="heart" size={28} color="#ffffff" />
                </View>

                <View style={styles.itemMeta}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    Liked music
                  </Text>
                  <View style={styles.subtitleRow}>
                    <Ionicons name="pin" size={13} color="#8e8e93" style={styles.pinIcon} />
                    <Text style={styles.itemSubtitle} numberOfLines={1}>
                      Auto playlist • {likedTracks.length} tracks
                    </Text>
                  </View>
                </View>

                <Pressable
                  style={styles.itemMenuButton}
                  hitSlop={8}
                  onPress={(e) => {
                    e.stopPropagation();
                    navigation.navigate('LikedSongs');
                  }}
                >
                  <Ionicons name="ellipsis-vertical" size={18} color="#8e8e93" />
                </Pressable>
              </Pressable>
            ) : null}

            {/* User Playlists */}
            {shouldShowPlaylists &&
              sortedPlaylists.map((playlist) => (
                <Pressable
                  key={playlist.id}
                  style={({ pressed }) => [styles.itemRow, pressed && styles.rowPressed]}
                  onPress={() => navigation.navigate('Playlist', { playlistId: playlist.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Playlist ${playlist.name}`}
                >
                  <View style={styles.playlistArtwork}>
                    <Ionicons name="musical-notes" size={26} color="#8e8e93" />
                  </View>

                  <View style={styles.itemMeta}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {playlist.name}
                    </Text>
                    <Text style={styles.itemSubtitle} numberOfLines={1}>
                      Playlist • Aero • {playlist.tracks.length} tracks
                    </Text>
                  </View>

                  <Pressable
                    style={styles.itemMenuButton}
                    hitSlop={8}
                    onPress={(e) => {
                      e.stopPropagation();
                      setSelectedPlaylistForMenu(playlist.id);
                    }}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color="#8e8e93" />
                  </Pressable>
                </Pressable>
              ))}

            {/* Artists Section */}
            {shouldShowArtists &&
              sortedArtists.map((artist) => (
                <Pressable
                  key={artist.id}
                  style={({ pressed }) => [styles.itemRow, pressed && styles.rowPressed]}
                  onPress={() => {
                    navigation.navigate('Artist', { artistName: artist.name });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open artist ${artist.name}`}
                >
                  <View style={styles.artistAvatar}>
                    <Ionicons name="person" size={24} color="#8e8e93" />
                  </View>

                  <View style={styles.itemMeta}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {artist.name}
                    </Text>
                    <Text style={styles.itemSubtitle} numberOfLines={1}>
                      Artist • {artist.subscribers}
                    </Text>
                  </View>

                  <Pressable style={styles.itemMenuButton} hitSlop={8}>
                    <Ionicons name="ellipsis-vertical" size={18} color="#8e8e93" />
                  </Pressable>
                </Pressable>
              ))}

            {/* Songs View */}
            {shouldShowSongs &&
              sortedSongs.map((track, index) => (
                <Pressable
                  key={`song-${track.id}-${index}`}
                  style={({ pressed }) => [styles.itemRow, pressed && styles.rowPressed]}
                  onPress={() => handlePlaySongTrack(track, index)}
                >
                  <View style={styles.songArtwork}>
                    <ArtworkPlaceholder track={track} size={54} borderRadius={8} />
                  </View>

                  <View style={styles.itemMeta}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {track.title}
                    </Text>
                    <Text style={styles.itemSubtitle} numberOfLines={1}>
                      {track.artist}
                    </Text>
                  </View>

                  <Pressable style={styles.itemMenuButton} hitSlop={8}>
                    <Ionicons name="ellipsis-vertical" size={18} color="#8e8e93" />
                  </Pressable>
                </Pressable>
              ))}
          </View>
        )}
      </ScrollView>

      {/* 5. Floating Action Button: + New in Liquid Glass */}
      <View style={[styles.fabContainer, { bottom: insets.bottom + 76 }]}>
        <TactilePressable
          activeScale={0.92}
          onPress={() => setIsCreateModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Create new playlist"
        >
          <LiquidGlassView
            shape="pill"
            intensity="ultra"
            glowColor="rgba(76, 201, 240, 0.55)"
            style={styles.fabGlassPill}
          >
            <Ionicons name="add" size={20} color="#ffffff" />
            <Text style={styles.fabText}>New</Text>
          </LiquidGlassView>
        </TactilePressable>
      </View>

      {/* 6. Sort Selection Modal Bottom Sheet */}
      <Modal
        visible={isSortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSortModalVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setIsSortModalVisible(false)}
        >
          <View style={styles.optionsSheetCard}>
            <Text style={styles.sortModalHeader}>Sort by</Text>
            {(['recent', 'recently_added', 'alphabetical'] as SortType[]).map((type) => {
              const isSelected = sortType === type;
              return (
                <Pressable
                  key={type}
                  style={styles.sortOptionRow}
                  onPress={() => {
                    setSortType(type);
                    setIsSortModalVisible(false);
                  }}
                >
                  <Ionicons
                    name={
                      type === 'recent'
                        ? 'time-outline'
                        : type === 'recently_added'
                          ? 'calendar-outline'
                          : 'text-outline'
                    }
                    size={20}
                    color={isSelected ? '#4cc9f0' : '#8e8e93'}
                  />
                  <Text
                    style={[
                      styles.sortOptionText,
                      isSelected && styles.sortOptionTextActive,
                    ]}
                  >
                    {SORT_LABELS[type]}
                  </Text>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={18} color="#4cc9f0" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* 7. Create Playlist Dialog Modal */}
      <Modal
        visible={isCreateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsCreateModalVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setIsCreateModalVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>New playlist</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter playlist title"
              placeholderTextColor="#8e8e93"
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalActionCancel}
                onPress={() => setIsCreateModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalActionCreate,
                  newPlaylistName.trim().length === 0 && styles.modalActionDisabled,
                ]}
                disabled={newPlaylistName.trim().length === 0}
                onPress={handleCreatePlaylist}
              >
                <Text style={styles.modalCreateText}>Create</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 8. Playlist Options Sheet (Delete) */}
      <Modal
        visible={selectedPlaylistForMenu !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPlaylistForMenu(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSelectedPlaylistForMenu(null)}
        >
          <View style={styles.optionsSheetCard}>
            <Pressable
              style={styles.optionsRow}
              onPress={() => {
                if (selectedPlaylistForMenu) {
                  deletePlaylist(selectedPlaylistForMenu);
                  setSelectedPlaylistForMenu(null);
                }
              }}
            >
              <Ionicons name="trash-outline" size={20} color="#ff4d4d" />
              <Text style={[styles.optionsRowText, { color: '#ff4d4d' }]}>
                Delete playlist
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconButton: {
    padding: 4,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#9c27b0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  filterBar: {
    marginTop: 10,
  },
  filterChipsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  glassFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.28)',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  glassFilterChipSelected: {
    backgroundColor: 'rgba(76, 201, 240, 0.22)',
    borderTopColor: '#4cc9f0',
    borderBottomColor: '#4cc9f0',
    borderLeftColor: '#4cc9f0',
    borderRightColor: '#4cc9f0',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.75)',
  },
  filterChipTextActive: {
    color: '#4cc9f0',
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sortText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  viewToggleButton: {
    padding: 4,
  },
  contentScrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  listContainer: {
    gap: 14,
  },
  sectionBlock: {
    gap: 14,
  },
  subSectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  rowPressed: {
    opacity: 0.7,
  },
  downloadArtwork: {
    width: 56,
    height: 56,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
  },
  downloadBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: '#000000',
    borderRadius: 8,
  },
  emptyFilterState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyFilterTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  emptyFilterSubtitle: {
    fontSize: 13,
    color: '#8e8e93',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 18,
  },
  gridCard: {
    width: '47.5%',
    gap: 6,
  },
  gridArtwork: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  likedGridArtwork: {
    backgroundColor: '#ff4d6d',
    borderWidth: 0,
  },
  artistGridArtwork: {
    borderRadius: 999,
  },
  gridTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  gridSubtitle: {
    fontSize: 12,
    color: '#8e8e93',
  },
  likedArtwork: {
    width: 56,
    height: 56,
    borderRadius: 6,
    backgroundColor: '#ff4d6d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistArtwork: {
    width: 56,
    height: 56,
    borderRadius: 6,
    backgroundColor: homeColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  artistAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: homeColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  songArtwork: {
    width: 54,
    height: 54,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
  },
  itemMeta: {
    flex: 1,
    gap: 3,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pinIcon: {
    marginRight: 2,
  },
  itemSubtitle: {
    fontSize: 13,
    color: '#8e8e93',
  },
  itemMenuButton: {
    padding: 8,
  },
  fabContainer: {
    position: 'absolute',
    right: 16,
  },
  fabGlassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  fabText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#212121',
    borderRadius: 14,
    padding: 20,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  modalInput: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.3)',
    color: '#ffffff',
    fontSize: 16,
    paddingVertical: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 8,
  },
  modalActionCancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalCancelText: {
    color: '#8e8e93',
    fontWeight: '600',
    fontSize: 15,
  },
  modalActionCreate: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    borderRadius: 8,
  },
  modalActionDisabled: {
    opacity: 0.4,
  },
  modalCreateText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 15,
  },
  optionsSheetCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  sortModalHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 4,
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  sortOptionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
  },
  sortOptionTextActive: {
    color: '#4cc9f0',
    fontWeight: '700',
  },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  optionsRowText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
});
