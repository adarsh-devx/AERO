import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Route parameter types for the root stack.
 * Add new params here as features come online; keep this the single
 * source of truth for navigation typing.
 */
export type RootStackParamList = {
  Home: undefined;
  Search: undefined;
  NowPlaying: undefined;
  LikedSongs: undefined;
  RecentlyPlayedHistory: undefined;
  Library: undefined;
  Playlists: undefined;
  Playlist: { playlistId: string };
  Artist: { artistName: string };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
