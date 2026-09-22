import { useEffect, useState } from 'react';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { MainTabsScreen } from './MainTabsScreen';
import { GlobalPlayerLayer } from '../features/player/GlobalPlayerLayer';
import { NowPlayingScreen } from '../features/nowplaying/NowPlayingScreen';
import { LikedSongsScreen } from '../features/liked/LikedSongsScreen';
import { RecentlyPlayedScreen } from '../features/history/RecentlyPlayedScreen';
import { PlaylistsScreen } from '../features/playlists/PlaylistsScreen';
import { PlaylistScreen } from '../features/playlists/PlaylistScreen';
import { ArtistScreen } from '../features/artist/ArtistScreen';
import { BottomTabBar } from '../features/home/components/BottomTabBar';
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const activeTab = useActiveTab();

  if (!TAB_BAR_ROUTES.has(activeRouteName)) {
    return null;
  }

  return (
    <BottomTabBar
      activeTab={activeTab}
      navigation={navigation}
    />
  );
}

/**
 * Root navigation. Infrastructure only — screens own their logic,
 * no provider/playback concerns belong here.
 */
export function AppNavigator() {
  const [currentRouteName, setCurrentRouteName] = useState<string>('Home');

  useEffect(() => {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
    }
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
        <GlobalPlayerLayer isNowPlayingActive={currentRouteName === 'NowPlaying'} />
        {/* Shared bottom tab bar: rendered from the root layout so it
            occupies a fixed slot below the global MiniPlayer layer on
            tab-bar screens. */}
        <RootTabBar activeRouteName={currentRouteName} />
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
