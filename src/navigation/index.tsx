import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PermissionsAndroid, AppState, Platform, StyleSheet, View } from 'react-native';
import { MainTabsScreen } from './MainTabsScreen';
import { GlobalPlayerLayer } from '../features/player/GlobalPlayerLayer';
import { NowPlayingScreen } from '../features/nowplaying/NowPlayingScreen';
import { LikedSongsScreen } from '../features/liked/LikedSongsScreen';
import { RecentlyPlayedScreen } from '../features/history/RecentlyPlayedScreen';
import { PlaylistsScreen } from '../features/playlists/PlaylistsScreen';
import { PlaylistScreen } from '../features/playlists/PlaylistScreen';
import { ArtistScreen } from '../features/artist/ArtistScreen';
import { AlbumScreen } from '../features/album/AlbumScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { StatisticsScreen } from '../features/statistics/StatisticsScreen';
import { useSharedLinkHandler } from '../features/share/useSharedLinkHandler';
import { SharedLinkStatus } from '../features/share/SharedLinkStatus';
import { SongIdentificationSheet } from '../features/share/SongIdentificationSheet';
import { BottomTabBar } from '../features/home/components/BottomTabBar';
import { UpdateOverlay } from '../features/update/UpdateOverlay';
import { updateService } from '../services/UpdateService';
import { navigationRef, type RootStackParamList } from './navigationRef';
import { tabStore, useActiveTab } from './tabStore';

export { navigationRef, type RootStackParamList };

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Routes that show the shared bottom tab bar. */
const TAB_BAR_ROUTES = new Set(['Home', 'Search', 'Library']);

/**
 * Shared bottom tab bar, rendered from the root layout so it sits in
 * a fixed position across all tab-bar screens (Home, Search & Library) —
 * directly above the global MiniPlayer layer.
 */
function RootTabBar({ activeRouteName }: { activeRouteName: string }) {
  const activeTab = useActiveTab();

  if (!TAB_BAR_ROUTES.has(activeRouteName)) {
    return null;
  }

  return <BottomTabBar activeTab={activeTab} />;
}

/**
 * Root navigation. Infrastructure only — screens own their logic,
 * no provider/playback concerns belong here.
 */
export function AppNavigator() {
  const [currentRouteName, setCurrentRouteName] = useState<string>('Home');

  // Android share-sheet intake: listens for ACTION_SEND text (cold start via
  // getInitialSharedText, warm arrivals via events), resolves the shared
  // YouTube link through the existing provider/playback pipeline and opens
  // Now Playing on success — see useSharedLinkHandler.
  const sharedLink = useSharedLinkHandler();

  useEffect(() => {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
    }
  }, []);

  // In-app updates (spec §12): one TTL-gated GitHub release check starts
  // ~2.5s AFTER first paint — fire-and-forget, never awaited by render,
  // playback or navigation — plus one TTL-gated re-check on foreground.
  // There is no polling timer anywhere; UpdateService owns the 6h TTL.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      void updateService.start();
    }, 2_500);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void updateService.onAppForegrounded();
    });
    return () => {
      clearTimeout(kickoff);
      subscription.remove();
    };
  }, []);

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={() => {
        const currentRoute = navigationRef.getCurrentRoute();
        if (currentRoute) {
          setCurrentRouteName(currentRoute.name);
        }
      }}
    >
      <View style={styles.root}>
        <View style={styles.navArea}>
          <Stack.Navigator initialRouteName="Home">
            <Stack.Screen
              name="Home"
              component={MainTabsScreen}
              options={{ headerShown: false, animation: 'none' }}
            />
            <Stack.Screen
              name="Search"
              component={MainTabsScreen}
              options={{ headerShown: false, animation: 'none' }}
              listeners={{
                focus: () => tabStore.setTab('search'),
              }}
            />
            <Stack.Screen
              name="Library"
              component={MainTabsScreen}
              options={{ headerShown: false, animation: 'none' }}
              listeners={{
                focus: () => tabStore.setTab('library'),
              }}
            />
            <Stack.Screen
              name="LikedSongs"
              component={LikedSongsScreen}
              options={{ headerShown: true, headerTitle: 'Liked Songs' }}
            />
            <Stack.Screen
              name="RecentlyPlayedHistory"
              component={RecentlyPlayedScreen}
              options={{ headerShown: true, headerTitle: 'Recently Played' }}
            />
            <Stack.Screen
              name="Playlists"
              component={PlaylistsScreen}
              options={{ headerShown: true, headerTitle: 'Playlists' }}
            />
            <Stack.Screen
              name="Playlist"
              component={PlaylistScreen}
              options={{ headerShown: true, headerTitle: 'Playlist' }}
            />
            <Stack.Screen
              name="Artist"
              component={ArtistScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Album"
              component={AlbumScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerShown: true, headerTitle: 'Settings' }}
            />
            <Stack.Screen
              name="Statistics"
              component={StatisticsScreen}
              options={{ headerShown: true, headerTitle: 'Listening Statistics' }}
            />
            <Stack.Screen
              name="NowPlaying"
              component={NowPlayingScreen}
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                animation: 'slide_from_bottom',
                animationDuration: 320,
              }}
            />
          </Stack.Navigator>
        </View>
        {/* Global player host: inside NavigationContainer with navigationRef;
            rendered BEFORE the tab bar so the MiniPlayer occupies layout
            space directly ABOVE it on tab-bar screens. */}
        <GlobalPlayerLayer
          isNowPlayingActive={currentRouteName === 'NowPlaying'}
          isSettingsActive={currentRouteName === 'Settings'}
        />
        {/* Shared bottom tab bar: rendered from the root layout so it
            occupies a fixed slot below the global MiniPlayer layer on
            tab-bar screens. */}
        <RootTabBar activeRouteName={currentRouteName} />
        {/* In-app update card: unobtrusive, top-anchored, box-none layer —
            never blocks playback, the MiniPlayer or navigation. Renders
            nothing while checking/failed/idle. */}
        <UpdateOverlay />
        {/* Shared-link processing banner: absolute overlay, rendered last so
            it sits above the player/tab layers while a share resolves. */}
        <SharedLinkStatus visible={sharedLink.processing} message={sharedLink.message} />
        {/* Ambiguous song-identification candidates (shared Reel links):
            glass bottom sheet, rendered at the root so it can appear over
            any screen; closed until the handler actually has candidates. */}
        <SongIdentificationSheet
          candidates={sharedLink.candidates}
          onSelect={sharedLink.selectCandidate}
          onClose={sharedLink.dismissCandidates}
        />
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0b',
  },
  navArea: {
    flex: 1,
  },
});
