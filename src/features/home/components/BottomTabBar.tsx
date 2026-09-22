import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { navigationRef, type RootStackParamList } from '../../../navigation';
import { tabStore } from '../../../navigation/tabStore';
import { HomeIcon, LibraryIcon, SearchIcon } from './Icons';
import { homeColors } from '../theme';
import { LiquidGlassView } from '../../common/LiquidGlassView';

type BottomTabBarProps = {
  activeTab: 'home' | 'search' | 'library';
  navigation: NativeStackNavigationProp<RootStackParamList>;
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
}: {
  tab: TabDef;
  isActive: boolean;
  onPress: () => void;
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
        {tab.key === 'home' && <HomeIcon color={color} />}
        {tab.key === 'search' && <SearchIcon color={color} />}
        {tab.key === 'library' && <LibraryIcon color={color} />}
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
export function BottomTabBar({ activeTab, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

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
  label: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
