import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { homeColors, homeRadius } from '../home/theme';

/**
 * Small transient banner shown while an incoming link (share or opened
 * URL) is being identified — the entire loading surface for this feature
 * (no new screen; shared/deep links use the same one). Auto-hides when
 * processing finishes (success navigates to Now Playing; an ambiguous
 * result opens the candidate picker; failure shows an Alert).
 * Non-interactive, monochrome Aero styling. `message` lets the handler
 * name the flow ("Finding track…" vs "Finding this Reel's song…")
 * without a second banner component.
 */
export function SharedLinkStatus({
  visible,
  message = 'Finding track…',
}: {
  visible: boolean;
  message?: string;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { top: insets.top + 12 }]}
      accessibilityRole="alert"
    >
      <View style={styles.pill}>
        <ActivityIndicator size="small" color="#4cc9f0" />
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: homeRadius.avatar,
    backgroundColor: homeColors.surfaceRaised,
    borderWidth: 1,
    borderColor: homeColors.border,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    color: homeColors.text,
  },
});
