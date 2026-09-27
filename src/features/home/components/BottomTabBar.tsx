import { useMemo, useRef, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { navigationRef } from '../../../navigation/navigationRef';
import { tabStore } from '../../../navigation/tabStore';
import { downloads } from '../../../services/composition';
import { HomeIcon, LibraryIcon, SearchIcon } from './Icons';
import { LiquidGlassView } from '../../common/LiquidGlassView';

type BottomTabBarProps = {
  activeTab: 'home' | 'search' | 'library';
};

type TabDef = {
  key: 'home' | 'search' | 'library';
  label: string;
};

const TABS: readonly TabDef[] = [
  { key: 'home', label: 'Home' },
  { key: 'search', label: 'Search' },
  { key: 'library', label: 'Library' },
];

function TabItem({
  tab,
  isActive,
  onPress,
  badge = false,
}: {
  tab: TabDef;
  isActive: boolean;
  onPress: () => void;
  /** Small dot over the Library icon while downloads are queued/active. */
  badge?: boolean;
}) {
  const pressScale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(pressScale, {
      toValue: 0.92,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 4,
      tension: 200,
    }).start();
  };

  const color = isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.45)';

  return (
    <Pressable
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Animated.View style={[styles.tabContent, { transform: [{ scale: pressScale }] }]}>
        <View style={styles.iconWrap}>
          {tab.key === 'home' ? <HomeIcon color={color} /> : null}
          {tab.key === 'search' ? <SearchIcon color={color} /> : null}
          {tab.key === 'library' ? <LibraryIcon color={color} /> : null}
          {badge ? <View style={styles.badgeDot} /> : null}
        </View>
        <Text style={[styles.label, { color, fontWeight: isActive ? '700' : '500' }]}>
          {tab.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Floating Liquid Glass Bottom Navigation Island.
 */
export function BottomTabBar({ activeTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  // Global download indicator (§18): a small dot on the Library tab while
  // anything is queued or transferring — read from the ONE downloads
  // store's transient snapshot (no hydration needed: activity only exists
  // within the session that created it). No new UI surface, no navigation
  // change; details stay in Library → Downloads.
  const activitySnapshot = useSyncExternalStore(
    downloads.subscribe,
    downloads.getActivitySnapshot,
  );
  const downloadsActive = useMemo(
    () =>
      Object.values(activitySnapshot).some(
        (activity) => activity.status === 'downloading' || activity.status === 'queued',
      ),
    [activitySnapshot],
  );

  return (
    <View
      style={[
        styles.floatingContainer,
        { paddingBottom: Math.max(insets.bottom, 10) },
      ]}
      pointerEvents="box-none"
    >
      <LiquidGlassView
        shape="pill"
        intensity="ultra"
        style={styles.glassIsland}
      >
        <View style={styles.islandContent}>
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            const handlePress = () => {
              tabStore.setTab(tab.key);
              if (navigationRef.isReady()) {
                const currentRoute = navigationRef.getCurrentRoute();
                if (
                  currentRoute &&
                  currentRoute.name !== 'Home' &&
                  currentRoute.name !== 'Search' &&
                  currentRoute.name !== 'Library'
                ) {
                  navigationRef.navigate('Home');
                }
              }
            };

            return (
              <TabItem
                key={tab.key}
                tab={tab}
                isActive={isActive}
                onPress={handlePress}
                badge={tab.key === 'library' && downloadsActive}
              />
            );
          })}
        </View>
      </LiquidGlassView>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    zIndex: 20,
  },
  glassIsland: {
    width: '100%',
    maxWidth: 380,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 16,
  },
  islandContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  tabContent: {
    alignItems: 'center',
    gap: 3,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4cc9f0',
    borderWidth: 1,
    borderColor: 'rgba(10, 10, 11, 0.85)',
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
