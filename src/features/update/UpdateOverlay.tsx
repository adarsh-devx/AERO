import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { homeColors, homeRadius } from '../home/theme';
import { updateService } from '../../services/UpdateService';

const ACCENT = '#4cc9f0';

/**
 * In-app update overlay (spec §8): a small unobtrusive glass card,
 * top-anchored so it never covers the MiniPlayer, the tab bar or transport
 * controls. Rendered from the root navigator above the screens but with a
 * `box-none` wrapper — touches outside the card fall straight through, so
 * music playback and navigation keep working while it is visible.
 *
 * Shows ONLY during `downloading` / `ready` / `installing` — checks are
 * silent by design and `failed` renders nothing (no trap UI). No local
 * state: every value comes from the UpdateService snapshot.
 */
export function UpdateOverlay() {
  const insets = useSafeAreaInsets();
  const snapshot = useSyncExternalStore(
    updateService.subscribe,
    updateService.getSnapshot,
  );

  if (snapshot.dismissed) return null;
  if (
    snapshot.state !== 'downloading' &&
    snapshot.state !== 'ready' &&
    snapshot.state !== 'installing'
  ) {
    return null;
  }

  const percent =
    snapshot.progress !== null ? `${Math.round(snapshot.progress * 100)}%` : null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { top: Math.max(insets.top, 12) + 4 }]}
    >
      <View style={styles.card}>
        {snapshot.state === 'downloading' ? (
          <>
            <View style={styles.headerRow}>
              <Ionicons name="cloud-download-outline" size={20} color={ACCENT} />
              <View style={styles.headerText}>
                <Text style={styles.title}>Updating Aero</Text>
                <Text style={styles.subtitle}>
                  Downloading version {snapshot.latestVersion ?? ''}
                </Text>
              </View>
              <Pressable
                onPress={() => updateService.dismiss()}
                hitSlop={8}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Hide update progress"
              >
                <Ionicons name="close" size={16} color={homeColors.textMuted} />
              </Pressable>
            </View>
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.round((snapshot.progress ?? 0) * 100)}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {percent ?? 'Downloading…'}
              </Text>
            </View>
          </>
        ) : snapshot.state === 'ready' ? (
          <>
            <View style={styles.headerRow}>
              <Ionicons name="checkmark-circle" size={20} color={ACCENT} />
              <View style={styles.headerText}>
                <Text style={styles.title}>Update ready</Text>
                <Text style={styles.subtitle}>
                  Restart Aero to install the latest version.
                </Text>
              </View>
              <Pressable
                onPress={() => updateService.dismiss()}
                hitSlop={8}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Dismiss update card"
              >
                <Ionicons name="close" size={16} color={homeColors.textMuted} />
              </Pressable>
            </View>
            {snapshot.needsInstallPermission ? (
              <Text style={styles.hint}>
                Android needs your permission first — allow “Install unknown
                apps” for Aero, then tap Restart &amp; Update again.
              </Text>
            ) : null}
            <View style={styles.actionsRow}>
              <Pressable
                onPress={() => void updateService.install()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Restart and update Aero to version ${snapshot.latestVersion ?? ''}`}
              >
                <Text style={styles.primaryButtonText}>Restart &amp; Update</Text>
              </Pressable>
              <Pressable
                onPress={() => updateService.dismiss()}
                style={styles.laterButton}
                accessibilityRole="button"
                accessibilityLabel="Maybe later"
              >
                <Text style={styles.laterButtonText}>Later</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Ionicons name="time-outline" size={20} color={ACCENT} />
              <View style={styles.headerText}>
                <Text style={styles.title}>Installing update</Text>
                <Text style={styles.subtitle}>
                  Confirm Android’s prompt to finish updating Aero.
                </Text>
              </View>
              <Pressable
                onPress={() => updateService.dismiss()}
                hitSlop={8}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Hide installing card"
              >
                <Ionicons name="close" size={16} color={homeColors.textMuted} />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 30,
  },
  card: {
    backgroundColor: 'rgba(18, 18, 24, 0.94)',
    borderRadius: 20,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: homeColors.text,
  },
  subtitle: {
    fontSize: 12.5,
    color: homeColors.textMuted,
  },
  hint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: homeColors.textFaint,
  },
  progressRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
    textAlign: 'right',
  },
  actionsRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: ACCENT,
    borderRadius: homeRadius.avatar,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0a0a0b',
  },
  laterButton: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: homeRadius.avatar,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.28)',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  laterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.textMuted,
  },
});
