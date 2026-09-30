import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import appConfig from '../../../app.json';
import {
  downloadService,
  listeningStats,
  playbackHistory,
  searchHistory,
  settings,
} from '../../services/composition';
import { updateService } from '../../services/UpdateService';
import { useDownloads } from '../downloads/useDownloads';
import { homeColors, homeRadius, homeSpacing, sectionHeading } from '../home/theme';
import { useYouTubeAuth } from '../youtube/useYouTubeAuth';
import { youtubeAuthStore } from '../youtube/YouTubeAuthStore';
import { ConnectYouTubeModal } from '../youtube/ConnectYouTubeModal';
import { YouTubePlaylistsSheet } from '../youtube/YouTubePlaylistsSheet';
import {
  SETTINGS_DEFINITIONS,
  type SettingDefinition,
  type SettingsKey,
  type SettingsSection,
} from './SettingsStore';
import { useSettings } from './useSettings';

interface SettingsAction {
  readonly title: string;
  readonly description: string;
  readonly onPress: () => void;
}

/** Sections that render boolean settings, in display order. */
const VALUE_SECTIONS: readonly SettingsSection[] = ['Search', 'Privacy', 'Now Playing', 'Playback'];

/** Only boolean definitions render here (every current setting is a
 *  switch — no other setting types exist anymore). */
type BooleanSettingDefinition = Extract<SettingDefinition, { readonly type: 'boolean' }>;

function definitionsFor(section: SettingsSection): readonly BooleanSettingDefinition[] {
  return SETTINGS_DEFINITIONS.filter(
    (definition): definition is BooleanSettingDefinition =>
      definition.section === section && definition.type === 'boolean',
  );
}

/**
 * Settings screen — the user-facing surface of the ONE SettingsStore.
 *
 * Every row is backed by a real implementation: switches write the
 * single persisted record through SettingsStore.set (persist-only-on-
 * change), and the data actions call the EXISTING store/service APIs —
 * PlaybackHistory.clear, SearchHistory.clear, DownloadService.removeDownload
 * and SettingsStore.reset. This screen never touches the KeyValueStore,
 * files, storage keys or the playback engine directly, and it never
 * claims an operation succeeded before the underlying store resolved.
 */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const snapshot = useSettings();
  const ytAuth = useYouTubeAuth();
  const [isConnectModalVisible, setIsConnectModalVisible] = useState(false);
  const [isPlaylistsSheetVisible, setIsPlaylistsSheetVisible] = useState(false);
  const { downloads: downloadList, activityList } = useDownloads();

  // Downloads eligible for removal: completed entries plus in-flight or
  // failed attempts (the two lists are disjoint by construction).
  const clearableDownloads = [
    ...downloadList,
    ...activityList.map((entry) => entry.track),
  ];

  const handleToggle = useCallback((key: SettingsKey, value: boolean) => {
    void settings.set(key, value).catch(() => {
      Alert.alert(
        "Couldn't save setting",
        'The change is active now, but it could not be written to storage. It may not persist after a restart.',
      );
    });
  }, []);

  /**
   * ONE service path (§30): cancels every queued/active job, deletes
   * every completed file and drops every entry — counts keep the same
   * honest error report as before. MediaStore music, playlists, likes,
   * both histories and settings are separate systems, never touched.
   */
  const clearDownloads = async (): Promise<void> => {
    const { removed, failed } = await downloadService.clearAll();
    if (failed > 0) {
      Alert.alert(
        "Couldn't clear downloads",
        `${failed} of ${removed + failed} downloads could not be removed. Nothing else was touched.`,
      );
    }
  };

  const resetSettings = async (): Promise<void> => {
    try {
      await settings.reset();
    } catch {
      Alert.alert(
        "Couldn't save settings",
        'Defaults are active for this session, but they could not be written to storage. They may not persist after a restart.',
      );
    }
  };

  // ── Destructive confirmations (§11/§12) ─────────────────────────────
  const confirmClearPlaybackHistory = () => {
    Alert.alert(
      'Clear playback history?',
      'Your recently played tracks will be removed. Playlists, likes, downloads, search history and the playback session stay untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => playbackHistory.clear() },
      ],
    );
  };

  const confirmClearListeningStatistics = () => {
    Alert.alert(
      'Clear listening statistics?',
      'Your listening statistics (plays, listening time and daily activity) will be removed. Playback history, search history, playlists, likes, downloads and settings stay untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => listeningStats.clear() },
      ],
    );
  };

  const confirmClearSearchHistory = () => {
    Alert.alert(
      'Clear search history?',
      'Your recent search queries will be removed. Playback history, playlists, likes and downloads stay untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => searchHistory.clear() },
      ],
    );
  };

  const confirmClearDownloads = () => {
    if (clearableDownloads.length === 0) return;
    const count = clearableDownloads.length;
    Alert.alert(
      'Clear downloads?',
      `All ${count} download${count === 1 ? '' : 's'} will be removed from this device. Playlists, likes and both histories stay untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => { void clearDownloads(); } },
      ],
    );
  };

  const confirmResetSettings = () => {
    Alert.alert(
      'Reset settings?',
      'Every preference returns to its default. Playlists, liked songs, downloads, playback history, search history and the playback session are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => { void resetSettings(); } },
      ],
    );
  };

  const dataActions: readonly SettingsAction[] = [
    {
      title: 'Clear playback history',
      description: 'Remove every recently played track.',
      onPress: confirmClearPlaybackHistory,
    },
    {
      title: 'Clear listening statistics',
      description: 'Reset listening plays, time and daily activity.',
      onPress: confirmClearListeningStatistics,
    },
    {
      title: 'Clear search history',
      description: 'Remove every saved search query.',
      onPress: confirmClearSearchHistory,
    },
    {
      title: 'Clear downloads',
      description:
        clearableDownloads.length > 0
          ? `${clearableDownloads.length} track${clearableDownloads.length === 1 ? '' : 's'} stored on this device.`
          : 'No downloads on this device.',
      onPress: confirmClearDownloads,
    },
    {
      title: 'Reset settings',
      description: 'Restore every preference to its default.',
      onPress: confirmResetSettings,
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* YouTube Account Integration (TOP) */}
        <View style={[styles.section, { marginTop: 12 }]}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="logo-youtube" size={18} color="#ff0000" />
            <Text style={styles.sectionTitle}>YouTube</Text>
          </View>
          <View style={styles.card}>
            {ytAuth.isConnected ? (
              <>
                <View style={styles.row}>
                  <View style={styles.userAvatarContainer}>
                    <Ionicons name="person-circle" size={36} color="#4cc9f0" />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{ytAuth.profile?.name || 'Connected to YouTube'}</Text>
                    <Text style={styles.rowDescription}>
                      {ytAuth.profile?.handle || ytAuth.profile?.email || 'Account connected'}
                    </Text>
                  </View>
                  <View style={styles.connectedBadge}>
                    <Ionicons name="checkmark-circle" size={12} color="#4cc9f0" style={{ marginRight: 4 }} />
                    <Text style={styles.connectedBadgeText}>Connected</Text>
                  </View>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.row,
                    styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => setIsPlaylistsSheetVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="View YouTube Playlists"
                >
                  <View style={styles.rowLeadingIcon}>
                    <Ionicons name="musical-notes-outline" size={20} color="#4cc9f0" />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>YouTube Playlists</Text>
                    <Text style={styles.rowDescription}>Play or import your YouTube playlists</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255, 255, 255, 0.4)" />
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.row,
                    styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => {
                    Alert.alert(
                      'Disconnect YouTube?',
                      'Your personal playlists will remain on YouTube, but Aero will switch to guest mode.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Disconnect',
                          style: 'destructive',
                          onPress: () => void youtubeAuthStore.disconnect(),
                        },
                      ],
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect YouTube account"
                >
                  <View style={styles.rowLeadingIcon}>
                    <Ionicons name="log-out-outline" size={20} color="#ff4d4d" />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.actionTitle}>Disconnect Account</Text>
                    <Text style={styles.rowDescription}>Switch back to guest mode</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255, 77, 77, 0.4)" />
                </Pressable>
              </>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => setIsConnectModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Connect with YouTube"
              >
                <View style={[styles.rowLeadingIcon, styles.ytConnectIcon]}>
                  <Ionicons name="logo-youtube" size={22} color="#ff0000" />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Connect with YouTube</Text>
                  <Text style={styles.rowDescription}>
                    Sync and play your personal YouTube playlists
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255, 255, 255, 0.4)" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Boolean settings, grouped by their central definitions */}
        {VALUE_SECTIONS.map((section) => {
          const definitions = definitionsFor(section);
          if (definitions.length === 0) return null;

          const getSectionIcon = (sec: string) => {
            switch (sec) {
              case 'Playback':
                return 'play-circle-outline';
              case 'Now Playing':
                return 'disc-outline';
              case 'Search':
                return 'search-outline';
              case 'Privacy':
                return 'shield-checkmark-outline';
              default:
                return 'options-outline';
            }
          };

          return (
            <View key={section} style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name={getSectionIcon(section) as any} size={18} color="#4cc9f0" />
                <Text style={styles.sectionTitle}>{section}</Text>
              </View>
              <View style={styles.card}>
                {definitions.map((definition, index) => (
                  <View
                    key={definition.key}
                    style={[styles.row, index > 0 && styles.rowDivider]}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{definition.title}</Text>
                      <Text style={styles.rowDescription}>{definition.description}</Text>
                    </View>
                    <Switch
                      value={snapshot[definition.key]}
                      onValueChange={(next) => handleToggle(definition.key, next)}
                      trackColor={{ false: 'rgba(255, 255, 255, 0.16)', true: '#4cc9f0' }}
                      thumbColor="#ffffff"
                      ios_backgroundColor="rgba(255, 255, 255, 0.16)"
                      accessibilityRole="switch"
                      accessibilityLabel={definition.title}
                    />
                  </View>
                ))}
              </View>
            </View>
          );
        })}

        {/* Data management — destructive actions through existing APIs */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="server-outline" size={18} color="#ffb703" />
            <Text style={styles.sectionTitle}>Data Management</Text>
          </View>
          <View style={styles.card}>
            {dataActions.map((action, index) => (
              <Pressable
                key={action.title}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.title}
              >
                <View style={styles.rowText}>
                  <Text style={styles.actionTitle}>{action.title}</Text>
                  <Text style={styles.rowDescription}>{action.description}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255, 77, 77, 0.4)" />
              </Pressable>
            ))}
          </View>
        </View>

        {/* About — real app metadata (app.json), read-only */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="information-circle-outline" size={18} color="#8e8e93" />
            <Text style={styles.sectionTitle}>About</Text>
          </View>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>App Name</Text>
              </View>
              <Text style={styles.rowValue}>{appConfig.expo.name}</Text>
            </View>
            <View style={[styles.row, styles.rowDivider]}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Version</Text>
              </View>
              <View style={styles.versionBadge}>
                <Text style={styles.versionBadgeText}>v{appConfig.expo.version}</Text>
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                styles.rowDivider,
                pressed && styles.rowPressed,
              ]}
              onPress={() => {
                void updateService.check().then(() => {
                  const state = updateService.getSnapshot().state;
                  if (state === 'idle') {
                    Alert.alert('Up to date', `Aero is currently on the latest version (v${appConfig.expo.version}).`);
                  }
                }).catch(() => {
                  Alert.alert('Update check failed', 'Could not reach GitHub releases at the moment.');
                });
              }}
              accessibilityRole="button"
              accessibilityLabel="Check for updates"
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Check for updates</Text>
                <Text style={styles.rowDescription}>Check GitHub releases for latest APK</Text>
              </View>
              <Ionicons name="cloud-download-outline" size={18} color="#4cc9f0" />
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Connect with YouTube Modal */}
      <ConnectYouTubeModal
        visible={isConnectModalVisible}
        onClose={() => setIsConnectModalVisible(false)}
        onSuccess={() => setIsPlaylistsSheetVisible(true)}
      />

      {/* YouTube Playlists Sheet */}
      <YouTubePlaylistsSheet
        visible={isPlaylistsSheetVisible}
        onClose={() => setIsPlaylistsSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0d',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  section: {
    marginTop: 22,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#ffffff',
  },
  card: {
    backgroundColor: '#12121a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  rowLeadingIcon: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ytConnectIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
  },
  userAvatarContainer: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  rowDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  versionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(76, 201, 240, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(76, 201, 240, 0.25)',
  },
  versionBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4cc9f0',
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ff5c5c',
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(76, 201, 240, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(76, 201, 240, 0.25)',
  },
  connectedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4cc9f0',
  },
});
