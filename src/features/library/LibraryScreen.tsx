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

const FILTER_CHIPS: FilterType[] = ['Downloads', 'Playlists', 'Songs', 'Albums', 'Artists'];

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
 * - "Recent activity ⌄" + Grid/List toggle button.
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
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation.navigate('RecentlyPlayedHistory')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Playback history"
          >
            <Ionicons name="time-outline" size={24} color="#ffffff" />
          </Pressable>

          <Pressable
            style={styles.iconButton}
            onPress={() => navigation.navigate('Search')}
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
        <Pressable style={styles.sortButton} hitSlop={6}>
          <Text style={styles.sortText}>Recent activity</Text>
          <Ionicons name="chevron-down" size={16} color="#ffffff" />
        </Pressable>

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

      {/* 4. Main Content List */}
      <ScrollView
        style={styles.contentScrollView}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Downloads / Offline Tracks Section */}
        {shouldShowDownloads && downloads.length > 0 ? (
          <View style={styles.sectionBlock}>
            {activeFilter === 'All' ? (
              <Text style={styles.subSectionHeader}>Downloaded ({downloads.length})</Text>
            ) : null}
            {downloads.map((track, index) => (
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
          playlists.map((playlist) => (
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

        {/* Artists Section - Tapping opens full ArtistScreen */}
        {shouldShowArtists &&
          SAMPLE_ARTISTS.map((artist) => (
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

        {/* Songs only view */}
        {shouldShowSongs &&
          history.slice(0, 15).map((track, index) => (
            <Pressable
              key={`song-${track.id}-${index}`}
              style={({ pressed }) => [styles.itemRow, pressed && styles.rowPressed]}
              onPress={() => navigation.navigate('NowPlaying')}
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
            <Ionicons name="add" size={22} color="#4cc9f0" />
            <Text style={styles.fabText}>New</Text>
          </LiquidGlassView>
        </TactilePressable>
      </View>

      {/* 6. Create Playlist Modal */}
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
              placeholder="Title"
              placeholderTextColor="#8e8e93"
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreatePlaylist}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalActionCancel}
                onPress={() => {
                  setNewPlaylistName('');
                  setIsCreateModalVisible(false);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalActionCreate,
                  newPlaylistName.trim().length === 0 && styles.modalActionDisabled,
                ]}
                onPress={handleCreatePlaylist}
                disabled={newPlaylistName.trim().length === 0}
              >
                <Text style={styles.modalCreateText}>Create</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 7. Playlist Options Menu Modal */}
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
          <Pressable style={styles.optionsSheetCard} onPress={(e) => e.stopPropagation()}>
            <Pressable
              style={styles.optionsRow}
              onPress={() => {
                if (selectedPlaylistForMenu) {
                  deletePlaylist(selectedPlaylistForMenu);
                }
                setSelectedPlaylistForMenu(null);
              }}
            >
              <Ionicons name="trash-outline" size={22} color="#ff4d6d" />
              <Text style={[styles.optionsRowText, { color: '#ff4d6d' }]}>Delete playlist</Text>
            </Pressable>

            <Pressable
              style={styles.optionsRow}
              onPress={() => setSelectedPlaylistForMenu(null)}
            >
              <Ionicons name="close-outline" size={22} color="#ffffff" />
              <Text style={styles.optionsRowText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030303',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
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
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#7b2cbf',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  filterBar: {
    marginBottom: 12,
  },
  filterChipsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterChipActive: {
    backgroundColor: '#ffffff',
  },
  glassFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    color: '#ffffff',
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    gap: 16,
  },
  gridCard: {
    width: '47%',
    gap: 8,
  },
  gridArtwork: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
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
  likedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
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
  imageFill: {
    width: '100%',
    height: '100%',
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
    backgroundColor: '#212121',
    borderRadius: 14,
    padding: 12,
    gap: 4,
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
