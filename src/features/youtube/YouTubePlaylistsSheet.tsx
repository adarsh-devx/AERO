import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '../../core/types/track';
import { homeColors, homeRadius } from '../home/theme';
import { TactilePressable } from '../common/TactilePressable';
import { playerController } from '../../services/composition';
import {
  youtubeAccountService,
  type YouTubePlaylistSummary,
} from './YouTubeAccountService';
import { useYouTubeAuth } from './useYouTubeAuth';

interface YouTubePlaylistsSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onPlayPlaylist?: (playlist: YouTubePlaylistSummary) => void;
}

export function YouTubePlaylistsSheet({
  visible,
  onClose,
}: YouTubePlaylistsSheetProps) {
  const insets = useSafeAreaInsets();
  const auth = useYouTubeAuth();
  const [playlists, setPlaylists] = useState<readonly YouTubePlaylistSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  // Selected playlist for full Track List View
  const [selectedPlaylist, setSelectedPlaylist] = useState<YouTubePlaylistSummary | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<readonly Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);

  useEffect(() => {
    if (visible && auth.isConnected) {
      setLoading(true);
      setSelectedPlaylist(null);
      setPlaylistTracks([]);
      youtubeAccountService
        .fetchUserPlaylists()
        .then((items) => {
          setPlaylists(items);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [visible, auth.isConnected]);

  const handleOpenPlaylistDetail = async (item: YouTubePlaylistSummary) => {
    setSelectedPlaylist(item);
    setLoadingTracks(true);
    try {
      const tracks = await youtubeAccountService.fetchPlaylistTracks(item.id);
      setPlaylistTracks(tracks);
    } catch {
      Alert.alert('Error', 'Failed to load tracks.');
    } finally {
      setLoadingTracks(false);
    }
  };

  const handleImport = async (item: YouTubePlaylistSummary) => {
    setImportingId(item.id);
    try {
      const result = await youtubeAccountService.importPlaylistToAero(item);
      if (result.success) {
        Alert.alert(
          'Imported successfully! 🎉',
          `"${item.title}" (${result.trackCount} songs) added to your Aero Library.`,
        );
      } else {
        Alert.alert("Couldn't import", 'No songs found in this playlist.');
      }
    } catch {
      Alert.alert('Import error', 'Failed to import playlist.');
    } finally {
      setImportingId(null);
    }
  };

  const handlePlayNow = async (item: YouTubePlaylistSummary) => {
    setImportingId(item.id);
    try {
      const tracks =
        selectedPlaylist?.id === item.id && playlistTracks.length > 0
          ? playlistTracks
          : await youtubeAccountService.fetchPlaylistTracks(item.id);

      if (tracks.length > 0) {
        void playerController.playFromQueue(tracks, 0);
        onClose();
      } else {
        Alert.alert('Empty playlist', 'Could not load tracks for this playlist.');
      }
    } catch {
      Alert.alert('Playback error', 'Failed to load tracks.');
    } finally {
      setImportingId(null);
    }
  };

  const handlePlayTrack = (trackIndex: number) => {
    if (playlistTracks.length > 0) {
      void playerController.playFromQueue(playlistTracks, trackIndex);
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (selectedPlaylist) {
          setSelectedPlaylist(null);
        } else {
          onClose();
        }
      }}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {selectedPlaylist ? (
              <Pressable
                onPress={() => setSelectedPlaylist(null)}
                hitSlop={8}
                style={styles.backButton}
              >
                <Ionicons name="chevron-back" size={24} color="#ffffff" />
              </Pressable>
            ) : (
              <Ionicons name="logo-youtube" size={24} color="#ff0000" />
            )}
            <Text style={styles.headerTitle} numberOfLines={1}>
              {selectedPlaylist ? selectedPlaylist.title : 'YouTube Playlists'}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={22} color="#ffffff" />
          </Pressable>
        </View>

        {/* Content */}
        {selectedPlaylist ? (
          /* ================= Detail Song List View ================= */
          <ScrollView
            style={styles.content}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          >
            {/* Playlist Hero Banner */}
            <View style={styles.heroCard}>
              {selectedPlaylist.thumbnailUrl ? (
                <Image
                  source={{ uri: selectedPlaylist.thumbnailUrl }}
                  style={styles.heroArtwork}
                />
              ) : (
                <View
                  style={[
                    styles.heroArtwork,
                    { backgroundColor: '#22222e' },
                  ]}
                >
                  <Ionicons
                    name="musical-notes"
                    size={36}
                    color="#ffffff"
                  />
                </View>
              )}
              <View style={styles.heroInfo}>
                <Text style={styles.heroTitle}>{selectedPlaylist.title}</Text>
                <Text style={styles.heroSubtitle}>
                  {playlistTracks.length > 0
                    ? `${playlistTracks.length} Songs found`
                    : selectedPlaylist.subtitle || 'YouTube Playlist'}
                </Text>

                {/* Actions: Play All & Import */}
                <View style={styles.heroActions}>
                  <TactilePressable
                    activeScale={0.95}
                    style={styles.playAllButton}
                    onPress={() => handlePlayNow(selectedPlaylist)}
                    disabled={importingId !== null}
                  >
                    <Ionicons name="play" size={16} color="#000000" />
                    <Text style={styles.playAllButtonText}>Play All</Text>
                  </TactilePressable>

                  <TactilePressable
                    activeScale={0.95}
                    style={styles.importAllButton}
                    onPress={() => handleImport(selectedPlaylist)}
                    disabled={importingId !== null}
                  >
                    {importingId === selectedPlaylist.id ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Ionicons name="cloud-download-outline" size={16} color="#ffffff" />
                        <Text style={styles.importAllButtonText}>Import</Text>
                      </>
                    )}
                  </TactilePressable>
                </View>
              </View>
            </View>

            {/* Songs List */}
            <Text style={styles.sectionHeading}>Tracks</Text>

            {loadingTracks ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color="#4cc9f0" />
                <Text style={styles.loadingText}>Loading songs…</Text>
              </View>
            ) : playlistTracks.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No songs found in this playlist</Text>
              </View>
            ) : (
              playlistTracks.map((track, idx) => (
                <TactilePressable
                  key={`${track.id}_${idx}`}
                  activeScale={0.97}
                  style={styles.trackRow}
                  onPress={() => handlePlayTrack(idx)}
                >
                  <Text style={styles.trackIndex}>{idx + 1}</Text>
                  {track.artworkUri ? (
                    <Image source={{ uri: track.artworkUri }} style={styles.trackArtwork} />
                  ) : (
                    <View style={styles.trackArtworkFallback}>
                      <Ionicons name="musical-note" size={16} color="#8e8e93" />
                    </View>
                  )}
                  <View style={styles.trackDetails}>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                      {track.title}
                    </Text>
                    <Text style={styles.trackArtist} numberOfLines={1}>
                      {track.artist}
                    </Text>
                  </View>
                  <Ionicons name="play-circle-outline" size={24} color="#4cc9f0" />
                </TactilePressable>
              ))
            )}
          </ScrollView>
        ) : (
          /* ================= All Playlists List ================= */
          <ScrollView
            style={styles.content}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 30 }]}
          >
            {loading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color="#ff0000" />
                <Text style={styles.loadingText}>Fetching your YouTube playlists…</Text>
              </View>
            ) : playlists.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="musical-notes-outline" size={54} color="#555" />
                <Text style={styles.emptyTitle}>No playlists found</Text>
                <Text style={styles.emptyText}>
                  Create playlists on YouTube or YouTube Music to see them here.
                </Text>
              </View>
            ) : (
              playlists.map((item) => (
                <TactilePressable
                  key={item.id}
                  activeScale={0.97}
                  style={styles.playlistCard}
                  onPress={() => handleOpenPlaylistDetail(item)}
                >
                  {/* Artwork */}
                  {item.thumbnailUrl ? (
                    <Image source={{ uri: item.thumbnailUrl }} style={styles.cardArtwork} />
                  ) : (
                    <View
                      style={[
                        styles.cardArtwork,
                        { backgroundColor: '#22222e' },
                      ]}
                    >
                      <Ionicons
                        name="musical-notes"
                        size={26}
                        color="#ffffff"
                      />
                    </View>
                  )}

                  {/* Info */}
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.cardSubtitle} numberOfLines={1}>
                      {item.subtitle || 'YouTube Playlist'}
                    </Text>
                  </View>

                  {/* Right chevron indicator */}
                  <Ionicons name="chevron-forward" size={20} color="#8e8e93" />
                </TactilePressable>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0c',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#121218',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
  },
  backButton: {
    padding: 4,
  },
  closeButton: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  centerBox: {
    paddingVertical: 50,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: homeColors.textMuted,
    fontSize: 13,
  },
  emptyBox: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyText: {
    color: homeColors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  playlistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 14,
  },
  cardArtwork: {
    width: 56,
    height: 56,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a24',
  },
  cardInfo: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  cardSubtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  heroCard: {
    flexDirection: 'row',
    backgroundColor: '#161622',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  heroArtwork: {
    width: 80,
    height: 80,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroInfo: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  heroSubtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  heroActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  playAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  playAllButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  importAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  importAllButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 8,
    marginBottom: 4,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  trackIndex: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    width: 20,
    textAlign: 'center',
  },
  trackArtwork: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#1e1e28',
  },
  trackArtworkFallback: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#1e1e28',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trackDetails: {
    flex: 1,
    gap: 2,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  trackArtist: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
});
