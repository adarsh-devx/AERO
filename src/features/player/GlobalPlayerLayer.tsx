import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { navigationRef } from '../../navigation/navigationRef';
import { usePlayerSelector } from '../../playback/usePlayerSelector';
import { MiniPlayer } from '../home/components/MiniPlayer';

type GlobalPlayerLayerProps = {
  isNowPlayingActive?: boolean;
  /**
   * Route-aware visibility for the Settings screen: Settings is a utility
   * screen, so the floating MiniPlayer hides there (the ROOT navigation's
   * onStateChange already reports the active route — no second navigation
   * listener exists). Playback itself is untouched: only this floating
   * view unmounts, and returning to Home/Search/Library restores it.
   */
  isSettingsActive?: boolean;
};

/**
 * Global player host: the single app-level mount point for the
 * MiniPlayer. Rendered below the navigator in real layout space, so
 * it is visible on every screen (Home, Search, future Library)
 * whenever the global PlayerController has a currentTrack — without
 * covering screen content or the bottom tab bar.
 *
 * Exactly one MiniPlayer instance exists in the app; screens must not
 * mount their own. Visibility is driven entirely by the global
 * playback state (hidden only when currentTrack is null).
 */
export function GlobalPlayerLayer({ isNowPlayingActive, isSettingsActive }: GlobalPlayerLayerProps) {
  const insets = useSafeAreaInsets();
  // Selected on currentTrack only: position ticks (~2x/s) never rebuild
  // this layer — only a new selection (or its clearing) does.
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);

  if (!currentTrack || isNowPlayingActive || isSettingsActive === true) {
    return null;
  }

  return (
    <View
      style={[styles.layer, { paddingBottom: Math.max(insets.bottom, 12) + 76 }]}
      pointerEvents="box-none"
    >
      <MiniPlayer
        onPress={() => {
          if (navigationRef.isReady()) {
            navigationRef.navigate('NowPlaying');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 4,
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
});
