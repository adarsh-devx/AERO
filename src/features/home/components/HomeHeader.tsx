import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../../navigation';
import { homeColors } from '../theme';

const APP_ICON = require('../../../../assets/icon.png');

/**
 * Aero App Bar Header:
 * Left: App Icon Image Logo + "Aero" brand name.
 * Right: Settings Button.
 */
export function HomeHeader() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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

      {/* Right: Settings Icon */}
      <Pressable
        style={styles.settingsButton}
        onPress={() => navigation.navigate('Settings')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Settings"
      >
        <Ionicons name="settings-outline" size={22} color="rgba(255, 255, 255, 0.85)" />
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
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
