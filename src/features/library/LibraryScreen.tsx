import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
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
import { tabStore, useActiveTab } from '../../navigation/tabStore';
import type { Track } from '../../core/types/track';
import { trackIdentityKey } from '../../core/types/track';
import type { DownloadActivity } from '../downloads/Downloads';
import { playerController } from '../../services/composition';
import { usePlaylists } from '../playlists/usePlaylists';
import { OptionsMenuSheet } from '../nowplaying/components/OptionsMenuSheet';
import { AddToPlaylistSheet } from '../playlists/components/AddToPlaylistSheet';
import { useLikedSongs } from '../liked/useLikedSongs';
import { useDownloads } from '../downloads/useDownloads';
import { useLibraryTracks } from './useLibraryTracks';
import { groupTracksByArtist } from './grouping';
import { TactilePressable } from '../common/TactilePressable';
import { homeColors } from '../home/theme';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { LiquidGlassView } from '../common/LiquidGlassView';
import { useYouTubeAuth } from '../youtube/useYouTubeAuth';
import { ConnectYouTubeModal } from '../youtube/ConnectYouTubeModal';
import { YouTubePlaylistsSheet } from '../youtube/YouTubePlaylistsSheet';

type LibraryScreenProps = NativeStackScreenProps<RootStackParamList, 'Library'>;

type FilterType = 'All' | 'Downloads' | 'Playlists' | 'Songs' | 'Local' | 'Artists';
type SortType = 'recent' | 'recently_added' | 'alphabetical' | 'artist' | 'size';
/** Status filter inside the Downloads section (§13). */
type DownloadStatusFilter = 'all' | 'downloaded' | 'queued' | 'downloading' | 'failed';

const FILTER_CHIPS: FilterType[] = ['Downloads', 'Playlists', 'Local'];

const SORT_LABELS: Record<SortType, string> = {
  recent: 'Recent activity',
  recently_added: 'Recently added',
  alphabetical: 'A to Z (Alphabetical)',
  artist: 'Artist',
  size: 'Download size',
};

/**
 * Sorts that only mean something for downloads (stored size / artist
 * metadata of a completed download). Offered only while the Downloads
 * filter is active and reset when leaving it, so no other section ever
 * renders under a sort it cannot honor.
 */
const DOWNLOADS_ONLY_SORTS: readonly SortType[] = ['artist', 'size'];

/** Status pills over the Downloads section — every count is real store
 *  state (completed entries + transient activity), never fabricated. */
const DOWNLOAD_STATUS_FILTERS: readonly DownloadStatusFilter[] = [
  'all',
  'downloaded',
  'queued',
  'downloading',
  'failed',
];

const DOWNLOAD_STATUS_LABELS: Record<DownloadStatusFilter, string> = {
  all: 'All',
  downloaded: 'Downloaded',
  queued: 'Queued',
  downloading: 'Downloading',
  failed: 'Failed',
};

/** Formats a Track.durationMs value as m:ss (e.g. "4:07"). */
function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** Formats a byte count as a compact size ("860 KB", "12.4 MB"). */
function formatBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * YouTube Music inspired Library Screen.
 *
 * Header:
 * - "Library" bold title + History (🕒), Search (🔍), Profile Avatar.
 * Filter Chips:
 * - Downloads, Playlists, Songs, Local, Artists.
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
  const { downloads, activityList, removeDownload, cancelDownload, downloadTrack, clearAllDownloads } =
    useDownloads();

  // The device music catalogue: loaded once, the first time the Library tab
  // is actually opened (the tab host mounts every screen up-front, so loading
  // is gated on the active tab instead of running at app start). Songs,
  // Local and Artists below are pure memoized derivations of this ONE
  // collection — no screen owns a private copy and nothing is re-fetched on
  // filter switches. Pull-to-refresh triggers the explicit `reload`.
  const activeTab = useActiveTab();
  const {
    tracks: libraryTracks,
    loading: libraryLoading,
    error: libraryError,
    reload: reloadLibrary,
  } = useLibraryTracks(activeTab === 'library');

  const ytAuth = useYouTubeAuth();
  const [isConnectYtVisible, setIsConnectYtVisible] = useState(false);
  const [isYtPlaylistsVisible, setIsYtPlaylistsVisible] = useState(false);

  const [activeFilter, setActiveFilter] = useState<FilterType>('All');
  const [isGridView, setIsGridView] = useState(false);
  const [isSortModalVisible, setIsSortModalVisible] = useState(false);
  const [sortType, setSortType] = useState<SortType>('recent');
  // Shared track options menu (Play next / Add to queue / Download / Save),
  // the exact same sheet Search and Home use — one queue, same entry points.
  const [optionsTrack, setOptionsTrack] = useState<Track | null>(null);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

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

  /**
   * Deleting a download is destructive (the local file goes away), so it
   * asks first — the same Alert pattern playlist deletion uses. Removes
   * only the file + download entry: MediaStore originals, playlists, liked
   * songs, history and the active queue are separate systems, untouched.
   */
  const confirmRemoveDownload = (track: Track) => {
    Alert.alert(
      'Delete download?',
      `"${track.title}" will be removed from offline storage. The song itself stays in your library.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeDownload(track) },
      ],
    );
  };

  /**
   * Bulk delete (§14): completed files AND every queued/active/failed
   * attempt, through the one service path — with a confirmation first.
   * Only the download subsystem's own files go away: MediaStore music,
   * playlists, likes and history are separate systems, untouched.
   */
  const confirmDeleteAllDownloads = () => {
    const count = downloads.length + activityList.length;
    if (count === 0) return;
    Alert.alert(
      'Delete all downloads?',
      `${count} download${count === 1 ? '' : 's'} will be removed from offline storage. Your songs, playlists, likes and history stay untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void clearAllDownloads().then(({ failed }) => {
              if (failed > 0) {
                Alert.alert(
                  "Couldn't delete some downloads",
                  `${failed} download${failed === 1 ? '' : 's'} could not be removed. Nothing else was touched.`,
                );
              }
            });
          },
        },
      ],
    );
  };

  /**
   * Queue first, then navigate: `playFromQueue` publishes the new current
   * track synchronously (status 'loading'). The queue passed is always the
   * DISPLAYED list, so alphabetical sorting cannot start a different song
   * than the row the user tapped.
   */
  const handlePlayDownloadedTrack = (index: number) => {
    void playerController.playFromQueue(sortedDownloads, index);
    navigation.navigate('NowPlaying');
  };

  const handlePlaySongTrack = (index: number) => {
    void playerController.playFromQueue(sortedSongs, index);
    navigation.navigate('NowPlaying');
  };

  // Sorted items based on active sortType. Downloads additionally honor
  // artist and download size (real stored metadata); the other sections
  // never receive those sorts (they reset when leaving Downloads).
  const sortedDownloads = useMemo(() => {
    const list = [...downloads];
    if (sortType === 'alphabetical') {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortType === 'artist') {
      list.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    } else if (sortType === 'size') {
      list.sort((a, b) => (b.fileSizeBytes ?? 0) - (a.fileSizeBytes ?? 0));
    }
    return list;
  }, [downloads, sortType]);

  // Offline-library summary: arithmetic over the PERSISTED entries only
  // (file sizes recorded at download time) — no filesystem reads during
  // render, no directory scans.
  const downloadsSummary = useMemo(() => {
    const bytes = downloads.reduce((sum, item) => sum + (item.fileSizeBytes ?? 0), 0);
    return { count: downloads.length, bytes };
  }, [downloads]);

  // ── Downloads status filtering (§13) ─────────────────────────────────
  // A small pill row scoped to the Downloads section: counts and rows are
  // derived from the SAME store snapshot every screen shares — this screen
  // keeps no private download state, only which filter the user picked.
  const [downloadFilter, setDownloadFilter] = useState<DownloadStatusFilter>('all');

  const activityCounts = useMemo(() => {
    const counts = { queued: 0, downloading: 0, failed: 0 };
    for (const { activity } of activityList) {
      if (activity.status === 'queued') counts.queued += 1;
      else if (activity.status === 'downloading') counts.downloading += 1;
      else counts.failed += 1;
    }
    return counts;
  }, [activityList]);

  // Derived fallback: if the selected status no longer has any members
  // (everything finished or was cleared), fall back to 'all' — the pills
  // row only exists while transient work does, so a stale selection must
  // never strand the section on an empty list.
  const effectiveDownloadFilter: DownloadStatusFilter =
    (downloadFilter === 'queued' && activityCounts.queued === 0) ||
    (downloadFilter === 'downloading' && activityCounts.downloading === 0) ||
    (downloadFilter === 'failed' && activityCounts.failed === 0) ||
    (downloadFilter === 'downloaded' && downloads.length === 0)
      ? 'all'
      : downloadFilter;

  const visibleActivities = useMemo(
    () =>
      activityList.filter(
        ({ activity }) =>
          effectiveDownloadFilter === 'all' ||
          (effectiveDownloadFilter === 'queued' && activity.status === 'queued') ||
          (effectiveDownloadFilter === 'downloading' && activity.status === 'downloading') ||
          (effectiveDownloadFilter === 'failed' && activity.status === 'failed'),
      ),
    [activityList, effectiveDownloadFilter],
  );
  // Same reference as sortedDownloads when unfiltered, so play-index math
  // keeps pointing at the displayed list (mirrors the effective filter, so
  // the two lists can never disagree).
  const visibleDownloads =
    effectiveDownloadFilter === 'all' || effectiveDownloadFilter === 'downloaded'
      ? sortedDownloads
      : [];

  /** Section chip change; downloads-only sorts reset when leaving Downloads. */
  const handleFilterChange = (next: FilterType) => {
    setActiveFilter(next);
    if (next !== 'Downloads' && DOWNLOADS_ONLY_SORTS.includes(sortType)) {
      setSortType('recent');
    }
  };

  const sortedPlaylists = useMemo(() => {
    const list = [...playlists];
    if (sortType === 'alphabetical') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [playlists, sortType]);

  // ── Device-library derivations (one collection, memoized) ──────────────
  const artistGroups = useMemo(() => groupTracksByArtist(libraryTracks), [libraryTracks]);

  const sortedArtists = useMemo(() => {
    const list = [...artistGroups];
    if (sortType === 'alphabetical') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [artistGroups, sortType]);

  const sortedSongs = useMemo(() => {
    const list = [...libraryTracks];
    if (sortType === 'alphabetical') {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [libraryTracks, sortType]);

  const shouldShowDownloads = activeFilter === 'All' || activeFilter === 'Downloads';
  const shouldShowLiked = activeFilter === 'All' || activeFilter === 'Playlists' || activeFilter === 'Songs';
  const shouldShowPlaylists = activeFilter === 'All' || activeFilter === 'Playlists';
  const shouldShowArtists = activeFilter === 'All' || activeFilter === 'Artists';
  // Local shows the SAME MediaStore catalogue as Songs — every device track
  // as an individual row (never grouped by album, no album cards). The
  // Liked/Playlists/Downloads sections stay out of it: Local is strictly
  // the device music library.
  const shouldShowSongs = activeFilter === 'Songs' || activeFilter === 'Local';
  // Empty copy differs only for Local (device framing). Permission denial
  // is NOT this branch — renderLibraryState surfaces it as an honest error.
  const songsEmptyTitle = activeFilter === 'Local' ? 'No music on this device' : 'No songs found';
  const songsEmptySubtitle =
    activeFilter === 'Local'
      ? 'Songs stored on this phone will appear here.'
      : 'Songs from this device will appear here.';

  // Section header with the storage summary (count + approximate bytes).
  const downloadsSize = formatBytes(downloadsSummary.bytes);
  const downloadsHeader =
    downloadsSummary.count > 0
      ? `Downloaded (${downloadsSummary.count})${downloadsSize ? ` • ${downloadsSize}` : ''}`
      : 'Downloads';

  /**
   * Shared loading / error / empty presentation for every section that
   * reads the device library. Permission denial surfaces as an honest error
   * (from the provider's errors map), never as a fake empty library.
   */
  const renderLibraryState = (emptyTitle: string, emptySubtitle: string, fullWidth: boolean) => {
    if (libraryLoading) {
      return (
        <View style={[styles.emptyFilterState, fullWidth && styles.fullWidthState]}>
          <ActivityIndicator color="#ffffff" size="large" />
        </View>
      );
    }
    if (libraryError !== null) {
      return (
        <View style={[styles.emptyFilterState, fullWidth && styles.fullWidthState]}>
          <Ionicons name="lock-closed-outline" size={54} color="rgba(255, 255, 255, 0.2)" />
          <Text style={styles.emptyFilterTitle}>Couldn&apos;t load device music</Text>
          <Text style={styles.emptyFilterSubtitle}>{libraryError}</Text>
        </View>
      );
    }
    return (
      <View style={[styles.emptyFilterState, fullWidth && styles.fullWidthState]}>
        <Text style={styles.emptyFilterTitle}>{emptyTitle}</Text>
        <Text style={styles.emptyFilterSubtitle}>{emptySubtitle}</Text>
      </View>
    );
  };

  /**
   * One queued / in-flight / failed download row for the offline library.
   * Reads only the store's transient activity snapshot: a QUEUED row says
   * "Waiting…" and claims no progress; percent/bytes come from real native
   * progress (coalesced to 1% steps); an unknown total size shows an
   * indeterminate spinner and NO fabricated percentage. Failed rows keep
   * the original track metadata for Retry and offer a dismiss.
   */
  const renderDownloadActivityRow = (track: Track, activity: DownloadActivity) => (
    <View key={`act-${trackIdentityKey(track)}`} style={[styles.itemRow, styles.activityRow]}>
      <View style={styles.downloadArtwork}>
        <ArtworkPlaceholder track={track} size={56} borderRadius={8} />
      </View>

      <View style={styles.itemMeta}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {track.title}
        </Text>
        {activity.status === 'downloading' ? (
          <>
            <Text style={styles.itemSubtitle} numberOfLines={1}>
              {track.artist} • Downloading…
            </Text>
            {activity.totalBytes > 0 ? (
              <View style={styles.progressRow}>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.round(activity.progress * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.progressLabel}>
                  {Math.round(activity.progress * 100)}%
                </Text>
              </View>
            ) : (
              <View style={styles.progressRow}>
                <ActivityIndicator size="small" color="#4cc9f0" />
                <Text style={styles.progressLabelStatic}>Downloading…</Text>
              </View>
            )}
            {activity.totalBytes > 0 ? (
              <Text style={styles.progressBytes}>
                {formatBytes(Math.round(activity.progress * activity.totalBytes)) ?? '0 KB'} of{' '}
                {formatBytes(activity.totalBytes) ?? 'unknown size'}
              </Text>
            ) : null}
            <Pressable
              style={styles.rowActionButton}
              onPress={() => cancelDownload(track)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Cancel download of ${track.title}`}
            >
              <Text style={styles.rowActionText}>Cancel</Text>
            </Pressable>
          </>
        ) : activity.status === 'queued' ? (
          <>
            <Text style={styles.itemSubtitle} numberOfLines={1}>
              {track.artist} • Waiting…
            </Text>
            <Pressable
              style={styles.rowActionButton}
              onPress={() => cancelDownload(track)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Cancel queued download of ${track.title}`}
            >
              <Text style={styles.rowActionText}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.itemSubtitle} numberOfLines={1}>
              {track.artist} • Download failed
            </Text>
            <Text style={styles.failedText} numberOfLines={2}>
              {activity.error}
            </Text>
            <View style={styles.failedActions}>
              <Pressable
                style={styles.rowActionButton}
                onPress={() => downloadTrack(track)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Retry download of ${track.title}`}
              >
                <Text style={styles.rowActionText}>Retry</Text>
              </Pressable>
              <Pressable
                onPress={() => cancelDownload(track)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss failed download of ${track.title}`}
              >
                <Ionicons name="close" size={16} color="#8e8e93" />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );

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

          {/* Statistics Icon (📊) -> Opens Listening Statistics */}
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation.navigate('Statistics')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Listening statistics"
          >
            <Ionicons name="stats-chart-outline" size={24} color="#ffffff" />
          </Pressable>

          {/* Settings Icon (⚙) -> Opens the Settings screen */}
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation.navigate('Settings')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={24} color="#ffffff" />
          </Pressable>
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
                onPress={() => handleFilterChange(isSelected ? 'All' : chip)}
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

      {/* YouTube Connection / Playlists Banner */}
      <View style={styles.ytBannerContainer}>
        {ytAuth.isConnected ? (
          <TactilePressable
            activeScale={0.97}
            style={styles.ytBanner}
            onPress={() => setIsYtPlaylistsVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="View YouTube Playlists"
          >
            <View style={styles.ytBannerIcon}>
              <Ionicons name="logo-youtube" size={22} color="#ff0000" />
            </View>
            <View style={styles.ytBannerText}>
              <Text style={styles.ytBannerTitle}>YouTube Playlists</Text>
              <Text style={styles.ytBannerSubtitle}>
                {ytAuth.profile?.name ? `Connected as ${ytAuth.profile.name}` : 'Tap to play or import'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
          </TactilePressable>
        ) : (
          <TactilePressable
            activeScale={0.97}
            style={styles.ytBanner}
            onPress={() => setIsConnectYtVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Connect with YouTube"
          >
            <View style={styles.ytBannerIcon}>
              <Ionicons name="logo-youtube" size={22} color="#ff0000" />
            </View>
            <View style={styles.ytBannerText}>
              <Text style={styles.ytBannerTitle}>Connect with YouTube</Text>
              <Text style={styles.ytBannerSubtitle}>Sync &amp; play your YouTube playlists</Text>
            </View>
            <Ionicons name="add-circle-outline" size={20} color="#4cc9f0" />
          </TactilePressable>
        )}
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
        refreshControl={
          <RefreshControl
            refreshing={libraryLoading}
            onRefresh={reloadLibrary}
            tintColor="#4cc9f0"
            colors={['#4cc9f0']}
          />
        }
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

            {/* Queued / active / failed downloads in Grid (tap: cancel or retry) */}
            {shouldShowDownloads &&
              activityList.map(({ track, activity }) => {
                const isFailed = activity.status === 'failed';
                return (
                <Pressable
                  key={`grid-act-${trackIdentityKey(track)}`}
                  style={styles.gridCard}
                  onPress={() => (isFailed ? downloadTrack(track) : cancelDownload(track))}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isFailed
                      ? `Retry download of ${track.title}`
                      : activity.status === 'queued'
                        ? `Cancel queued download of ${track.title}`
                        : `Cancel download of ${track.title}`
                  }
                >
                  <View style={styles.gridArtwork}>
                    <ArtworkPlaceholder track={track} size={150} borderRadius={8} />
                    <View style={styles.downloadBadge}>
                      <Ionicons
                        name={
                          isFailed
                            ? 'refresh'
                            : activity.status === 'queued'
                              ? 'time-outline'
                              : 'arrow-down-circle'
                        }
                        size={16}
                        color={isFailed ? '#ff4d6d' : '#4cc9f0'}
                      />
                    </View>
                  </View>
                  <Text style={styles.gridTitle} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.gridSubtitle} numberOfLines={1}>
                    {activity.status === 'downloading'
                      ? activity.totalBytes > 0
                        ? `Downloading ${Math.round(activity.progress * 100)}% • tap to cancel`
                        : 'Downloading… • tap to cancel'
                      : activity.status === 'queued'
                        ? 'Waiting… • tap to cancel'
                        : 'Failed • tap to retry'}
                  </Text>
                </Pressable>
                );
              })}

            {/* Downloads in Grid */}
            {shouldShowDownloads &&
              sortedDownloads.map((track, index) => {
                const duration = formatDuration(track.durationMs);
                return (
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
                    <Text style={styles.gridSubtitle} numberOfLines={1}>
                      {track.artist}{duration ? ` • ${duration}` : ''} • Offline
                    </Text>
                  </Pressable>
                );
              })}

            {/* Artists in Grid */}
            {shouldShowArtists &&
              (sortedArtists.length > 0
                ? sortedArtists.map((artist) => (
                    <Pressable
                      key={`grid-art-${artist.key}`}
                      style={styles.gridCard}
                      onPress={() => {
                        navigation.navigate('Artist', { artistName: artist.name });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Open artist ${artist.name}`}
                    >
                      <View style={[styles.gridArtwork, styles.artistGridArtwork]}>
                        <Ionicons name="person" size={36} color="#8e8e93" />
                      </View>
                      <Text style={styles.gridTitle} numberOfLines={1}>{artist.name}</Text>
                      <Text style={styles.gridSubtitle} numberOfLines={1}>
                        {artist.tracks.length} {artist.tracks.length === 1 ? 'song' : 'songs'}
                      </Text>
                    </Pressable>
                  ))
                : renderLibraryState('No artists found', 'Artists from the songs on this device will appear here.', true))}

            {/* Songs / Local in Grid — individual device tracks */}
            {shouldShowSongs &&
              (sortedSongs.length > 0
                ? sortedSongs.map((track, index) => (
                    <Pressable
                      key={`grid-song-${track.id}-${index}`}
                      style={styles.gridCard}
                      onPress={() => handlePlaySongTrack(index)}
                      accessibilityRole="button"
                      accessibilityLabel={`Play song ${track.title}`}
                    >
                      <View style={styles.gridArtwork}>
                        <ArtworkPlaceholder track={track} size={150} borderRadius={8} />
                      </View>
                      <Text style={styles.gridTitle} numberOfLines={1}>{track.title}</Text>
                      <Text style={styles.gridSubtitle} numberOfLines={1}>{track.artist}</Text>
                    </Pressable>
                  ))
                : renderLibraryState(songsEmptyTitle, songsEmptySubtitle, true))}
          </View>
        ) : (
          // ==================== 1-COLUMN LIST VIEW ====================
          <View style={styles.listContainer}>
            {/* Downloads / Offline Tracks Section */}
            {shouldShowDownloads && (sortedDownloads.length > 0 || activityList.length > 0) ? (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.subSectionHeader}>{downloadsHeader}</Text>
                  {downloads.length > 0 ? (
                    <Pressable
                      onPress={confirmDeleteAllDownloads}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Delete all downloads"
                    >
                      <Text style={styles.deleteAllText}>Delete all</Text>
                    </Pressable>
                  ) : null}
                </View>
                {/* Status pills (§13): only while transient work exists;
                    every count is real store state (§12). */}
                {activityList.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.statusPillsRow}
                    contentContainerStyle={styles.statusPillsScroll}
                  >
                    {DOWNLOAD_STATUS_FILTERS.map((status) => {
                      const isSelected = effectiveDownloadFilter === status;
                      const count =
                        status === 'all'
                          ? downloads.length + activityList.length
                          : status === 'downloaded'
                            ? downloads.length
                            : status === 'queued'
                              ? activityCounts.queued
                              : status === 'downloading'
                                ? activityCounts.downloading
                                : activityCounts.failed;
                      const label =
                        DOWNLOAD_STATUS_LABELS[status] + (count > 0 ? ` ${count}` : '');
                      return (
                        <TactilePressable
                          key={status}
                          activeScale={0.93}
                          onPress={() => setDownloadFilter(status)}
                          accessibilityRole="button"
                          accessibilityLabel={`Filter downloads: ${DOWNLOAD_STATUS_LABELS[status]}`}
                        >
                          <LiquidGlassView
                            shape="pill"
                            intensity={isSelected ? 'ultra' : 'subtle'}
                            glowColor={isSelected ? 'rgba(76, 201, 240, 0.45)' : undefined}
                            style={[
                              styles.glassFilterChip,
                              styles.statusPill,
                              isSelected && styles.glassFilterChipSelected,
                            ]}
                          >
                            <Text
                              style={[
                                styles.filterChipText,
                                styles.statusPillText,
                                isSelected && styles.filterChipTextActive,
                              ]}
                            >
                              {label}
                            </Text>
                          </LiquidGlassView>
                        </TactilePressable>
                      );
                    })}
                  </ScrollView>
                ) : null}
                {/* Queued / in-flight / failed downloads — transient store
                    state, visible here no matter which screen started them,
                    filtered by the status pills above. */}
                {visibleActivities.map(({ track, activity }) =>
                  renderDownloadActivityRow(track, activity),
                )}
                {visibleActivities.length === 0 && visibleDownloads.length === 0 ? (
                  <Text style={styles.filterEmptyText}>No downloads match this filter.</Text>
                ) : null}
                {visibleDownloads.map((track, index) => {
                  const duration = formatDuration(track.durationMs);
                  return (
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
                        {track.artist}{duration ? ` • ${duration}` : ''} • Offline
                      </Text>
                    </View>

                    <Pressable
                      style={styles.itemMenuButton}
                      hitSlop={8}
                      onPress={(e) => {
                        e.stopPropagation();
                        confirmRemoveDownload(track);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete download of ${track.title}`}
                    >
                      <Ionicons name="trash-outline" size={18} color="#8e8e93" />
                    </Pressable>
                  </Pressable>
                  );
                })}
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

            {/* User Playlists (list header links the full Playlists screen) */}
            {shouldShowPlaylists && sortedPlaylists.length > 0 ? (
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.subSectionHeader}>Playlists ({sortedPlaylists.length})</Text>
                <Pressable
                  onPress={() => navigation.navigate('Playlists')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="See all playlists"
                >
                  <Text style={styles.seeAllText}>See all</Text>
                </Pressable>
              </View>
            ) : null}
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

            {/* Artists (derived from the device library) */}
            {shouldShowArtists &&
              (sortedArtists.length > 0
                ? sortedArtists.map((artist) => (
                    <Pressable
                      key={artist.key}
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
                          Artist • {artist.tracks.length} {artist.tracks.length === 1 ? 'song' : 'songs'}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                : renderLibraryState('No artists found', 'Artists from the songs on this device will appear here.', false))}

            {/* Songs / Local view (full device catalogue, individual tracks) */}
            {shouldShowSongs &&
              (sortedSongs.length > 0
                ? sortedSongs.map((track, index) => {
                    const duration = formatDuration(track.durationMs);
                    return (
                      <Pressable
                        key={`song-${track.id}-${index}`}
                        style={({ pressed }) => [styles.itemRow, pressed && styles.rowPressed]}
                        onPress={() => handlePlaySongTrack(index)}
                        accessibilityRole="button"
                        accessibilityLabel={`Play ${track.title} by ${track.artist}`}
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
                            {duration ? ` • ${duration}` : ''}
                          </Text>
                        </View>

                        <Pressable
                          style={styles.itemMenuButton}
                          hitSlop={8}
                          onPress={(e) => {
                            e.stopPropagation();
                            setOptionsTrack(track);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Options for ${track.title}`}
                        >
                          <Ionicons name="ellipsis-vertical" size={18} color="#8e8e93" />
                        </Pressable>
                      </Pressable>
                    );
                  })
                : renderLibraryState(songsEmptyTitle, songsEmptySubtitle, false))}
          </View>
        )}
      </ScrollView>

      {/* 5. Floating Action Button: Circular + button in Liquid Glass */}
      <View style={[styles.fabContainer, { bottom: insets.bottom + 98 }]}>
        <TactilePressable
          activeScale={0.9}
          onPress={() => setIsCreateModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Create new playlist"
        >
          <LiquidGlassView
            shape="circle"
            intensity="ultra"
            glowColor="rgba(76, 201, 240, 0.55)"
            style={styles.fabGlassCircle}
          >
            <Ionicons name="add" size={26} color="#ffffff" />
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
            {(activeFilter === 'Downloads'
              ? (['recent', 'recently_added', 'alphabetical', 'artist', 'size'] as SortType[])
              : (['recent', 'recently_added', 'alphabetical'] as SortType[])
            ).map((type) => {
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
                          : type === 'artist'
                            ? 'person-outline'
                            : type === 'size'
                              ? 'archive-outline'
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

      {/* 9. Track Options Sheet — Add to queue / Remove from queue mutate
          the ONE PlayerController queue. */}
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

      {/* Connect with YouTube Modal */}
      <ConnectYouTubeModal
        visible={isConnectYtVisible}
        onClose={() => setIsConnectYtVisible(false)}
        onSuccess={() => setIsYtPlaylistsVisible(true)}
      />

      {/* YouTube Playlists Sheet */}
      <YouTubePlaylistsSheet
        visible={isYtPlaylistsVisible}
        onClose={() => setIsYtPlaylistsVisible(false)}
      />
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
  deleteAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ff4d6d',
  },
  statusPillsRow: {
    marginTop: 8,
  },
  statusPillsScroll: {
    gap: 8,
    paddingRight: 8,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusPillText: {
    fontSize: 12,
  },
  filterEmptyText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.45)',
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4cc9f0',
    marginTop: 4,
  },
  fullWidthState: {
    width: '100%',
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
  activityRow: {
    alignItems: 'flex-start',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    alignSelf: 'stretch',
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#4cc9f0',
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4cc9f0',
    minWidth: 32,
    textAlign: 'right',
  },
  progressLabelStatic: {
    fontSize: 11,
    color: '#8e8e93',
  },
  progressBytes: {
    fontSize: 11,
    color: '#8e8e93',
    marginTop: 4,
  },
  failedText: {
    fontSize: 12,
    color: '#ff4d6d',
    marginTop: 4,
  },
  failedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  rowActionButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  rowActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4cc9f0',
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
    right: 18,
    zIndex: 10,
  },
  fabGlassCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
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
  ytBannerContainer: {
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
  },
  ytBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 12,
  },
  ytBannerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ytBannerText: {
    flex: 1,
    gap: 2,
  },
  ytBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  ytBannerSubtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
});
