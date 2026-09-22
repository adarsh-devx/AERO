import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { navigationRef } from '../../navigation/navigationRef';
import { playerController } from '../../services/composition';
import { MiniPlayer } from '../home/components/MiniPlayer';
import { homeColors } from '../home/theme';

type GlobalPlayerLayerProps = {
  isNowPlayingActive?: boolean;
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
export function GlobalPlayerLayer({ isNowPlayingActive }: GlobalPlayerLayerProps) {
  const insets = useSafeAreaInsets();
  const snapshot = useSyncExternalStore(
    playerController.subscribe,
    playerController.getSnapshot,
  );

  if (!snapshot.currentTrack || isNowPlayingActive) {
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
