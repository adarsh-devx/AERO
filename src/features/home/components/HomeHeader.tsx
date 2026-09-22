import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { homeColors } from '../theme';

const APP_ICON = require('../../../../assets/icon.png');

/**
 * Aero App Bar Header:
 * Left: Exact App Icon Image Logo + "Aero" brand name.
 * Right: Profile Avatar (NO Notification Bell).
 */
export function HomeHeader() {
  return (
    <View style={styles.header}>
      {/* Brand Logo & Name */}
      <View style={styles.brand}>
        <View style={styles.logoFrame}>
          <Image
            source={APP_ICON}
            style={styles.logoImage}
            resizeMode="cover"
          />
        </View>
        <Text style={styles.brandTitle}>Aero</Text>
      </View>

      {/* Right: Profile Avatar ONLY (No notification bell) */}
      <Pressable
        style={styles.avatar}
        accessibilityRole="button"
        accessibilityLabel="Profile"
      >
        <Text style={styles.avatarText}>A</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoFrame: {
    width: 28,
    height: 28,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: homeColors.surface,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: homeColors.text,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: homeColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: homeColors.text,
  },
});
