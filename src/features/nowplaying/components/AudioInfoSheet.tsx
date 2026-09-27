import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '../../../core/types/track';
import { trackOrigin } from '../../../core/types/track';
import type { StreamMetadata } from '../../../providers/stream/types';
import { homeColors, homeRadius } from '../../home/theme';

type AudioInfoSheetProps = {
  visible: boolean;
  track: Track;
  metadata: StreamMetadata | null;
  durationMs: number;
  onClose: () => void;
};

function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

/**
 * One human-friendly source label for the listener — derived only from
 * the track's origin and the resolved source type. Provider/resolver
 * internals (provider ids, delivery, format, MIME, bitrate, hosts,
 * signed URLs) are deliberately never surfaced here: this is a music
 * information sheet, not a diagnostics panel.
 */
function sourceValue(track: Track, metadata: StreamMetadata | null): string {
  if (metadata?.sourceType === 'download') return 'Downloaded';
  if (trackOrigin(track) === 'local') return 'On device';
  return 'YouTube';
}

/** Capitalises a fixed credit role for display (composer → Composer). */
function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

type SheetRow = { label: string; value: string };
type SheetSection = { heading: string; rows: SheetRow[] };

/**
 * Consumer-facing sections built ONLY from data the app ALREADY holds:
 * real Track metadata plus the single source label above. Every row is
 * omitted when its value is absent — sections collapse rather than
 * rendering "Unknown"/"—" placeholders, and nothing is ever invented.
 */
function buildSections(track: Track, metadata: StreamMetadata | null, durationMs: number): SheetSection[] {
  const sections: SheetSection[] = [];

  // Music — real Track fields only (title/artist live in the card header).
  const musicRows: SheetRow[] = [];
  if (track.album) musicRows.push({ label: 'Album', value: track.album });
  if (track.releaseDate) musicRows.push({ label: 'Released', value: track.releaseDate });
  if (typeof track.trackNumber === 'number') {
    musicRows.push({ label: 'Track', value: String(track.trackNumber) });
  }
  if (typeof track.discNumber === 'number') {
    musicRows.push({ label: 'Disc', value: String(track.discNumber) });
  }
  const duration = formatDuration(durationMs || track.durationMs || 0);
  if (duration) musicRows.push({ label: 'Duration', value: duration });
  for (const credit of track.credits ?? []) {
    musicRows.push({ label: roleLabel(credit.role), value: credit.name });
  }
  if (musicRows.length > 0) sections.push({ heading: 'MUSIC', rows: musicRows });

  // Source — always real (origin is known for every track), one simple
  // label: YouTube / On device / Downloaded.
  sections.push({
    heading: 'SOURCE',
    rows: [{ label: 'Source', value: sourceValue(track, metadata) }],
  });

  return sections;
}

/**
 * Consumer-facing "Track information" sheet: title/artist header plus the
 * real music metadata the app holds (album, release, track/disc numbers,
 * duration, credits) and ONE human source label. Deliberately NOT a
 * developer diagnostics panel — no provider ids, delivery/format/MIME/
 * bitrate/host details, no stream URLs, cookies, headers, signatures or
 * resolver internals ever render here. Rows absent from the metadata are
 * simply omitted; nothing is invented or shown as "Unknown".
 */
export function AudioInfoSheet({ visible, track, metadata, durationMs, onClose }: AudioInfoSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(600)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(600);
    Animated.spring(translateY, { toValue: 0, damping: 24, mass: 0.8, stiffness: 220, useNativeDriver: true }).start();
  }, [translateY, visible]);

  const close = () => {
    Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: true }).start(onClose);
  };

  const sections = buildSections(track, metadata, durationMs);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={close} accessibilityRole="button" accessibilityLabel="Close track information" />
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18), transform: [{ translateY }] }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>AUDIO</Text>
              <Text style={styles.title}>Track information</Text>
            </View>
            <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close track information" style={styles.closeButton}>
              <Ionicons name="close" size={20} color={homeColors.textMuted} />
            </Pressable>
          </View>

          {/* Everything below derives from the Track itself (plus the source
              label), so the sheet is complete and honest immediately — no
              loading state tied to the stream, no "unavailable" technical
              placeholder. Sections with nothing real to say are absent. */}
          <View style={styles.card}>
            <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
            <Text style={styles.trackArtist} numberOfLines={1}>{track.artist}</Text>
            {sections.map((section) => (
              <View key={section.heading}>
                <Text style={styles.sectionHeading}>{section.heading}</Text>
                <View>
                  {section.rows.map((row, rowIndex) => (
                    <View key={`${section.heading}-${rowIndex}`} style={styles.row}>
                      <Text style={styles.label}>{row.label}</Text>
                      <Text style={styles.value} numberOfLines={2}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.65)', justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: 'rgba(18, 18, 24, 0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'transparent',
    borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 9,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.35)', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 16 },
  eyebrow: { color: homeColors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: homeColors.text, fontSize: 21, fontWeight: '700', marginTop: 3 },
  closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: 'rgba(255, 255, 255, 0.055)', borderRadius: homeRadius.surface, borderWidth: 1, borderColor: homeColors.border, padding: 16 },
  trackTitle: { color: homeColors.text, fontSize: 16, fontWeight: '700' },
  trackArtist: { color: homeColors.textMuted, fontSize: 13, marginTop: 3 },
  sectionHeading: { color: homeColors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginTop: 16, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: homeColors.border },
  label: { color: homeColors.textMuted, fontSize: 13, width: 96 },
  value: { color: homeColors.text, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
});

