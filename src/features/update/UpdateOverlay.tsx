import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSyncExternalStore } from 'react';
import { Ionicons } from '@expo/vector-icons';

import { LiquidGlassView } from '../common/LiquidGlassView';
import { updateService } from '../../services/UpdateService';

const ACCENT = '#4cc9f0';
const ACCENT_GLOW = 'rgba(76, 201, 240, 0.4)';
const ACCENT_BG = 'rgba(76, 201, 240, 0.12)';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

const CHANGELOG_ITEMS = [
  {
    icon: 'sparkles' as const,
    title: 'VisionOS Liquid Glass UI',
    desc: 'Apple-inspired translucent frosted glass player & option sheets.',
  },
  {
    icon: 'logo-youtube' as const,
    title: 'YouTube Account Sync',
    desc: 'Google Sign-In, playlist imports, and seamless cloud library sync.',
  },
  {
    icon: 'flash' as const,
    title: 'Instant Audio Engine',
    desc: 'Zero-latency playback, smart phonetic deduplication & higher quality audio.',
  },
  {
    icon: 'shield-checkmark' as const,
    title: 'Stability & Performance',
    desc: 'Faster search queries, battery optimizations, and bug fixes.',
  },
];

/**
 * In-App Update Modal:
 * A breathtaking Apple VisionOS / Liquid Glass inspired update popup.
 * Provides rich "What's New" highlights, real-time download progress with
 * animated glow bars, install permission helpers, and 1-tap installation.
 */
export function UpdateOverlay() {
  const snapshot = useSyncExternalStore(
    updateService.subscribe,
    updateService.getSnapshot,
  );

  const animScale = useRef(new Animated.Value(0.9)).current;
  const animOpacity = useRef(new Animated.Value(0)).current;

  const isVisible =
    !snapshot.dismissed &&
    (snapshot.state === 'available' ||
      snapshot.state === 'downloading' ||
      snapshot.state === 'ready' ||
      snapshot.state === 'installing');

  useEffect(() => {
    if (isVisible) {
      Animated.parallel([
        Animated.spring(animScale, {
          toValue: 1,
          damping: 18,
          stiffness: 180,
          useNativeDriver: true,
        }),
        Animated.timing(animOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      animScale.setValue(0.9);
      animOpacity.setValue(0);
    }
  }, [isVisible, animScale, animOpacity]);

  if (!isVisible) return null;

  const progressPercent =
    snapshot.progress !== null
      ? Math.max(2, Math.min(100, Math.round(snapshot.progress * 100)))
      : null;

  const versionLabel = snapshot.latestVersion
    ? `v${snapshot.latestVersion}`
    : 'New Version';

  return (
    <Modal
      transparent
      animationType="none"
      visible={isVisible}
      statusBarTranslucent
      onRequestClose={() => updateService.dismiss()}
    >
      <View style={styles.modalBackdrop}>
        {/* Tap outside backdrop to dismiss */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => updateService.dismiss()}
        />

        <Animated.View
          style={[
            styles.modalCenterWrapper,
            {
              opacity: animOpacity,
              transform: [{ scale: animScale }],
            },
          ]}
        >
          <LiquidGlassView
            intensity="ultra"
            borderRadius={28}
            glowColor="rgba(76, 201, 240, 0.28)"
            style={styles.cardContainer}
          >
            {/* Top glowing accent flare */}
            <View style={styles.glowFlare} />

            {/* Header with Aero Disc Badge and Close button */}
            <View style={styles.header}>
              <View style={styles.badgeRow}>
                <View style={styles.iconCircle}>
                  <Ionicons name="disc-outline" size={26} color={ACCENT} />
                </View>
                <View style={styles.titleColumn}>
                  <View style={styles.versionPill}>
                    <Text style={styles.versionPillText}>{versionLabel}</Text>
                  </View>
                  <Text style={styles.mainTitle}>
                    {snapshot.state === 'ready'
                      ? 'Update Ready!'
                      : snapshot.state === 'downloading'
                      ? 'Updating Aero…'
                      : snapshot.state === 'installing'
                      ? 'Installing Update…'
                      : 'New Update Available'}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => updateService.dismiss()}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.closeButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Close update popup"
              >
                <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.7)" />
              </Pressable>
            </View>

            {/* Content area based on state */}
            <ScrollView
              style={styles.scrollArea}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {/* "What's New" Section */}
              <Text style={styles.sectionHeader}>WHAT'S NEW IN AERO</Text>
              <View style={styles.featuresList}>
                {CHANGELOG_ITEMS.map((item, index) => (
                  <View key={index} style={styles.featureItem}>
                    <View style={styles.featureIconContainer}>
                      <Ionicons name={item.icon} size={17} color={ACCENT} />
                    </View>
                    <View style={styles.featureTextCol}>
                      <Text style={styles.featureTitle}>{item.title}</Text>
                      <Text style={styles.featureDesc}>{item.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Progress Box for Downloading */}
              {snapshot.state === 'downloading' ? (
                <View style={styles.downloadBox}>
                  <View style={styles.downloadHeaderRow}>
                    <Text style={styles.downloadStatusText}>Downloading update…</Text>
                    <Text style={styles.downloadPercentText}>
                      {progressPercent !== null ? `${progressPercent}%` : 'Calculating…'}
                    </Text>
                  </View>

                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width:
                            progressPercent !== null
                              ? `${progressPercent}%`
                              : '15%',
                        },
                      ]}
                    />
                  </View>

                  <View style={styles.downloadFooterRow}>
                    <Text style={styles.downloadBytesText}>
                      {snapshot.totalBytes > 0
                        ? `${formatBytes(snapshot.bytesWritten)} / ${formatBytes(
                            snapshot.totalBytes,
                          )}`
                        : `${formatBytes(snapshot.bytesWritten)} downloaded`}
                    </Text>
                    <Text style={styles.downloadSubText}>Runs in background</Text>
                  </View>
                </View>
              ) : null}

              {/* Permission note if needed */}
              {snapshot.needsInstallPermission ? (
                <View style={styles.warningBox}>
                  <Ionicons name="warning-outline" size={18} color="#f59e0b" />
                  <Text style={styles.warningText}>
                    Please enable “Install unknown apps” permission for Aero in Android
                    settings, then tap Restart & Install.
                  </Text>
                </View>
              ) : null}

              {snapshot.state === 'installing' ? (
                <View style={styles.installingBox}>
                  <Ionicons name="hourglass-outline" size={20} color={ACCENT} />
                  <Text style={styles.installingText}>
                    Confirm Android system prompt to complete update.
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            {/* Bottom Actions Row */}
            <View style={styles.footerActions}>
              {snapshot.state === 'ready' ? (
                <>
                  <Pressable
                    onPress={() => void updateService.install()}
                    style={({ pressed }) => [
                      styles.primaryActionBtn,
                      pressed && styles.primaryActionBtnPressed,
                    ]}
                  >
                    <Ionicons name="rocket-outline" size={18} color="#0a0a0b" />
                    <Text style={styles.primaryActionBtnText}>Restart &amp; Install</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => updateService.dismiss()}
                    style={({ pressed }) => [
                      styles.secondaryActionBtn,
                      pressed && styles.secondaryActionBtnPressed,
                    ]}
                  >
                    <Text style={styles.secondaryActionBtnText}>Later</Text>
                  </Pressable>
                </>
              ) : snapshot.state === 'downloading' ? (
                <Pressable
                  onPress={() => updateService.dismiss()}
                  style={({ pressed }) => [
                    styles.primaryActionBtn,
                    styles.primaryActionBtnDark,
                    pressed && styles.secondaryActionBtnPressed,
                  ]}
                >
                  <Text style={styles.primaryActionBtnDarkText}>
                    Continue in Background
                  </Text>
                </Pressable>
              ) : snapshot.state === 'installing' ? (
                <Pressable
                  onPress={() => updateService.dismiss()}
                  style={({ pressed }) => [
                    styles.secondaryActionBtn,
                    { flex: 1 },
                    pressed && styles.secondaryActionBtnPressed,
                  ]}
                >
                  <Text style={styles.secondaryActionBtnText}>Dismiss</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    onPress={() => updateService.dismiss()}
                    style={({ pressed }) => [
                      styles.primaryActionBtn,
                      pressed && styles.primaryActionBtnPressed,
                    ]}
                  >
                    <Text style={styles.primaryActionBtnText}>Got it</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => updateService.dismiss()}
                    style={({ pressed }) => [
                      styles.secondaryActionBtn,
                      pressed && styles.secondaryActionBtnPressed,
                    ]}
                  >
                    <Text style={styles.secondaryActionBtnText}>Later</Text>
                  </Pressable>
                </>
              )}
            </View>
          </LiquidGlassView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MODAL_WIDTH = Math.min(SCREEN_WIDTH - 36, 380);

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCenterWrapper: {
    width: MODAL_WIDTH,
    maxHeight: '82%',
  },
  cardContainer: {
    paddingTop: 20,
    paddingBottom: 18,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(18, 20, 28, 0.94)',
  },
  glowFlare: {
    position: 'absolute',
    top: -30,
    alignSelf: 'center',
    width: 140,
    height: 40,
    backgroundColor: ACCENT_GLOW,
    borderRadius: 70,
    opacity: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: ACCENT_BG,
    borderWidth: 1,
    borderColor: 'rgba(76, 201, 240, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleColumn: {
    flex: 1,
    gap: 4,
  },
  versionPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: 'rgba(76, 201, 240, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(76, 201, 240, 0.3)',
  },
  versionPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: 0.5,
  },
  mainTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  closeButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    transform: [{ scale: 0.94 }],
  },
  scrollArea: {
    maxHeight: 280,
  },
  scrollContent: {
    paddingBottom: 6,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.45)',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  featuresList: {
    gap: 10,
    marginBottom: 14,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  featureIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(76, 201, 240, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  featureTextCol: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  featureDesc: {
    fontSize: 11.5,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.65)',
  },
  downloadBox: {
    marginTop: 6,
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(76, 201, 240, 0.2)',
    gap: 8,
  },
  downloadHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  downloadStatusText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#ffffff',
  },
  downloadPercentText: {
    fontSize: 13,
    fontWeight: '800',
    color: ACCENT,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: ACCENT,
  },
  downloadFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  downloadBytesText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.55)',
    fontVariant: ['tabular-nums'],
  },
  downloadSubText: {
    fontSize: 11,
    color: ACCENT,
    fontStyle: 'italic',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 6,
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.28)',
  },
  warningText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    color: '#fbbf24',
  },
  installingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: ACCENT_BG,
    borderWidth: 1,
    borderColor: 'rgba(76, 201, 240, 0.3)',
  },
  installingText: {
    flex: 1,
    fontSize: 12,
    color: ACCENT,
    fontWeight: '600',
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: ACCENT,
    paddingVertical: 13,
    borderRadius: 16,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryActionBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  primaryActionBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0a0a0b',
  },
  primaryActionBtnDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    shadowOpacity: 0,
  },
  primaryActionBtnDarkText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryActionBtn: {
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionBtnPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    transform: [{ scale: 0.98 }],
  },
  secondaryActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.75)',
  },
});

