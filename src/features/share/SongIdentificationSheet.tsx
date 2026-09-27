import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { trackIdentityKey, type Track } from '../../core/types/track';
import { ArtworkPlaceholder } from '../home/components/ArtworkPlaceholder';
import { homeColors, homeRadius } from '../home/theme';

type SongIdentificationSheetProps = {
  /** Non-null opens the picker; null keeps it closed (never a partial UI). */
  candidates: readonly Track[] | null;
  /** The user's explicit choice — this is the ONLY way a candidate plays. */
  onSelect: (track: Track) => void;
  /** Cancel (backdrop, drag-down, ✕, back button): closes, plays nothing. */
  onClose: () => void;
};

/**
 * "Which song is this?" — the ambiguous-result picker for shared-link song
 * identification (Instagram Reel results with several plausible matches).
 *
 * Reuses the existing bottom-sheet language (OptionsMenuSheet pattern:
 * glass sheet, handle, slide spring, drag-to-dismiss) with the shared
 * ArtworkPlaceholder row — deliberately MINIMAL: tapping a row is the
 * single action. No like, no download, no queue actions, no badges: a
 * candidate row is a choice, not a track menu (§18).
 *
 * Renders NOTHING until identification actually produced candidates, and
 * choosing/canceling only informs the caller — this component never talks
 * to the player, navigation or any store itself.
 */
export function SongIdentificationSheet({
  candidates,
  onSelect,
  onClose,
}: SongIdentificationSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(600)).current;
  const isClosingRef = useRef(false);
  const visible = candidates !== null;

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      translateY.setValue(600);
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
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  /** Selection slides the sheet away first, then reports the choice — the
   *  same dismiss animation language as the existing options sheet. */
  const handleSelect = (track: Track) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(translateY, {
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onSelect(track);
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            translateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 80 || gestureState.vy > 0.4) {
            handleDismiss();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              damping: 20,
              mass: 0.8,
              stiffness: 200,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    // handleDismiss is stable per mount (closes via onClose only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [translateY],
  );

  if (candidates === null) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropTouch}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss song choices"
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
          <View {...panResponder.panHandlers}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title}>Which song is this?</Text>
                <Text style={styles.subtitle}>Choose the song the Reel uses.</Text>
              </View>
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
          </View>

          <View style={styles.list}>
            {candidates.map((track, index) => (
              <Pressable
                key={`${trackIdentityKey(track)}-${index}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => handleSelect(track)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${track.title} by ${track.artist}`}
              >
                <ArtworkPlaceholder track={track} size={44} />
                <View style={styles.rowMeta}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {track.title}
                  </Text>
                  <Text style={styles.rowArtist} numberOfLines={1}>
                    {track.artist}
                  </Text>
                </View>
                <Ionicons name="play" size={18} color={homeColors.textMuted} />
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
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
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: homeColors.text,
  },
  subtitle: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  list: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: homeRadius.surface,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  rowMeta: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: homeColors.text,
  },
  rowArtist: {
    fontSize: 13,
    color: homeColors.textMuted,
  },
});
