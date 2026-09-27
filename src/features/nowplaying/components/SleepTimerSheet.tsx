import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import type { Track } from '../../../core/types/track';
import { sleepTimer as sleepTimerStore } from '../../../services/composition';
import { homeColors, homeRadius } from '../../home/theme';
import {
  SLEEP_TIMER_MAX_CUSTOM_MINUTES,
  SLEEP_TIMER_MIN_CUSTOM_MINUTES,
  SLEEP_TIMER_PRESET_MINUTES,
} from '../../player/SleepTimer';
import { useSleepTimer } from '../../player/useSleepTimer';

type SleepTimerSheetProps = {
  visible: boolean;
  /** The current player track — gates "End of current track". */
  currentTrack: Track | null;
  onClose: () => void;
};

/**
 * Sleep Timer bottom sheet — same visual language as the Now Playing
 * options sheet (backdrop + spring slide + handle bar + list rows), no
 * gradients or new palettes. Player-level state only: every option routes
 * through the ONE SleepTimer store, which in turn drives the existing
 * PlayerController. A successful configuration dismisses the sheet.
 */
export function SleepTimerSheet({ visible, currentTrack, onClose }: SleepTimerSheetProps) {
  const insets = useSafeAreaInsets();
  const sleepTimer = useSleepTimer();
  const translateY = useRef(new Animated.Value(400)).current;
  const isClosingRef = useRef(false);

  const [customVisible, setCustomVisible] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      translateY.setValue(400);
      Animated.spring(translateY, {
        toValue: 0,
        damping: 24,
        mass: 0.8,
        stiffness: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const handleDismiss = () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(translateY, {
      toValue: 400,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const active = sleepTimer.mode !== null;
  const remainingLabel =
    sleepTimer.mode === 'duration' && sleepTimer.remainingMs !== null
      ? `${Math.max(1, Math.ceil(sleepTimer.remainingMs / 60_000))} min remaining`
      : null;

  // Custom input: strict whole-number minutes inside the documented bounds —
  // zero, negative, NaN, decimals and absurd values can never be submitted.
  const trimmedMinutes = customMinutes.trim();
  const customValue = /^\d+$/.test(trimmedMinutes)
    ? Number.parseInt(trimmedMinutes, 10)
    : Number.NaN;
  const customValid =
    Number.isInteger(customValue) &&
    customValue >= SLEEP_TIMER_MIN_CUSTOM_MINUTES &&
    customValue <= SLEEP_TIMER_MAX_CUSTOM_MINUTES;

  // Actions go through the ONE SleepTimer store (the hook value above is
  // its read-only snapshot for display).
  const handlePreset = (minutes: number) => {
    if (sleepTimerStore.startDuration(minutes * 60_000)) handleDismiss();
  };

  const handleEndOfTrack = () => {
    if (currentTrack === null) return;
    if (sleepTimerStore.startEndOfTrack(currentTrack)) handleDismiss();
  };

  const handleCancelTimer = () => {
    sleepTimerStore.cancel();
    handleDismiss();
  };

  const handleCustomSubmit = () => {
    if (!customValid) return;
    if (sleepTimerStore.startDuration(customValue * 60_000)) {
      setCustomVisible(false);
      setCustomMinutes('');
      handleDismiss();
    }
  };

  const renderRow = (
    rowKey: string,
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    onPress: () => void,
    options?: { disabled?: boolean; trailing?: string; destructive?: boolean },
  ) => {
    const disabled = options?.disabled === true;
    return (
      <Pressable
        // Stable identity for this row — the preset list below renders via
        // .map(), so each produced element MUST carry its own key (root
        // cause of React's "Each child in a list should have a unique…"
        // warning while this sheet was open).
        key={rowKey}
        style={({ pressed }) => [
          styles.menuRow,
          pressed && !disabled && styles.menuRowPressed,
          disabled && styles.menuRowDisabled,
        ]}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
      >
        <Ionicons
          name={icon}
          size={22}
          color={disabled ? homeColors.textFaint : options?.destructive ? '#ff4d4d' : homeColors.textMuted}
          style={styles.menuIcon}
        />
        <Text
          style={[
            styles.menuText,
            disabled && styles.menuTextDisabled,
            options?.destructive && styles.menuTextDestructive,
          ]}
        >
          {label}
        </Text>
        {options?.trailing ? <Text style={styles.menuTrailing}>{options.trailing}</Text> : null}
      </Pressable>
    );
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="none" onRequestClose={handleDismiss}>
        <View style={styles.backdrop}>
          <Pressable
            style={styles.backdropTouch}
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss sleep timer"
          />
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [{ translateY }],
              },
            ]}
          >
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            <View style={styles.header}>
              <Ionicons name="moon-outline" size={22} color={homeColors.text} />
              <Text style={styles.headerTitle}>Sleep Timer</Text>
              <Pressable
                style={styles.closeButton}
                onPress={handleDismiss}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={homeColors.textMuted} />
              </Pressable>
            </View>

            {active ? (
              <View style={styles.statusCard}>
                <Text style={styles.statusTitle}>Timer active</Text>
                <Text style={styles.statusSubtitle}>
                  {sleepTimer.mode === 'end-of-track'
                    ? 'Ends after this track'
                    : remainingLabel ?? ''}
                </Text>
              </View>
            ) : null}

            <View style={styles.menuList}>
              {active
                ? renderRow('cancel-timer', 'Cancel Timer', 'close-circle-outline', handleCancelTimer, {
                    destructive: true,
                  })
                : null}

              {SLEEP_TIMER_PRESET_MINUTES.map((minutes) =>
                renderRow(`preset-${minutes}-min`, `${minutes} min`, 'time-outline', () => handlePreset(minutes)),
              )}

              {renderRow('custom', 'Custom', 'create-outline', () => setCustomVisible(true))}

              {renderRow(
                'end-of-track',
                'End of current track',
                'moon-outline',
                handleEndOfTrack,
                currentTrack === null
                  ? { disabled: true, trailing: 'No track playing' }
                  : { trailing: sleepTimer.mode === 'end-of-track' ? 'Active' : undefined },
              )}
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Custom duration dialog — same convention as the Library create-
          playlist dialog (sibling Modal, so it never nests inside the
          sheet's own Modal). */}
      <Modal
        visible={customVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomVisible(false)}
      >
        <Pressable
          style={styles.dialogBackdrop}
          onPress={() => {
            setCustomVisible(false);
            setCustomMinutes('');
          }}
        >
          <Pressable style={styles.dialogCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.dialogTitle}>Custom duration</Text>
            <TextInput
              style={styles.dialogInput}
              placeholder={`Minutes (${SLEEP_TIMER_MIN_CUSTOM_MINUTES}–${SLEEP_TIMER_MAX_CUSTOM_MINUTES})`}
              placeholderTextColor="#8e8e93"
              keyboardType="number-pad"
              value={customMinutes}
              onChangeText={setCustomMinutes}
              maxLength={3}
              autoFocus
              accessibilityLabel="Custom sleep timer duration in minutes"
            />
            {trimmedMinutes.length > 0 && !customValid ? (
              <Text style={styles.dialogError}>
                Enter a whole number between {SLEEP_TIMER_MIN_CUSTOM_MINUTES} and{' '}
                {SLEEP_TIMER_MAX_CUSTOM_MINUTES}.
              </Text>
            ) : null}
            <View style={styles.dialogActions}>
              <Pressable
                style={styles.dialogAction}
                onPress={() => {
                  setCustomVisible(false);
                  setCustomMinutes('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel custom duration"
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.dialogAction, !customValid && styles.dialogActionDisabled]}
                disabled={!customValid}
                onPress={handleCustomSubmit}
                accessibilityRole="button"
                accessibilityLabel="Start custom sleep timer"
              >
                <Text style={[styles.dialogStartText, !customValid && styles.dialogStartDisabled]}>
                  Start
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: 'rgba(18, 18, 24, 0.94)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'transparent',
    borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 8,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: homeColors.text,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  statusCard: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: homeRadius.surface,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: homeColors.border,
    gap: 4,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: homeColors.text,
  },
  statusSubtitle: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
  menuList: {
    paddingTop: 12,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: homeRadius.surface,
  },
  menuRowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  menuRowDisabled: {
    opacity: 0.6,
  },
  menuIcon: {
    width: 32,
  },
  menuText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: homeColors.text,
  },
  menuTextDisabled: {
    color: homeColors.textFaint,
  },
  menuTextDestructive: {
    color: '#ff4d4d',
    fontWeight: '600',
  },
  menuTrailing: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  dialogCard: {
    width: '100%',
    backgroundColor: homeColors.surfaceRaised,
    borderRadius: homeRadius.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    padding: 20,
    gap: 12,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: homeColors.text,
  },
  dialogInput: {
    backgroundColor: homeColors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: homeColors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: homeColors.text,
  },
  dialogError: {
    fontSize: 12,
    lineHeight: 16,
    color: '#ff4d4d',
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 20,
    marginTop: 4,
  },
  dialogAction: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  dialogActionDisabled: {
    opacity: 0.4,
  },
  dialogCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.textMuted,
  },
  dialogStartText: {
    fontSize: 14,
    fontWeight: '700',
    color: homeColors.text,
  },
  dialogStartDisabled: {
    color: homeColors.textFaint,
  },
});
