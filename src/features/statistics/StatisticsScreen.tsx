import { useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { homeColors, homeRadius, homeSpacing, sectionHeading } from '../home/theme';
import { useListeningStats } from './useListeningStats';
import {
  localDayKeyDaysAgo,
  type ListeningStatsSnapshot,
  type NamedStat,
  type TrackStat,
} from './ListeningStats';

/** How many entries each top/recent list shows (all inputs are bounded). */
const TOP_N = 10;
const RECENT_N = 8;
const ACTIVITY_DAYS = 7;

/** Plays desc, most recent activity breaking ties. */
function byPlaysThenRecent(
  a: { plays: number; lastPlayedAt: number },
  b: { plays: number; lastPlayedAt: number },
): number {
  return b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt;
}

/** Listening time as "3h 24m" / "42m" / "8s" — never a fabricated estimate. */
function formatListeningMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}

/** Coarse relative time for "Recent" rows — factual, no invented precision. */
function formatRelativeTime(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}

/** Weekday short name for an 'YYYY-MM-DD' local day key. */
function weekdayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
  });
}

interface ActivityDay {
  readonly day: string;
  readonly label: string;
  readonly plays: number;
  readonly listeningMs: number;
}

/** Last 7 local calendar days, oldest → today, from the bounded daily buckets. */
function buildActivity(snapshot: ListeningStatsSnapshot): {
  readonly days: readonly ActivityDay[];
  readonly weekListeningMs: number;
  readonly weekPlays: number;
  readonly maxDayMs: number;
} {
  const byDay = new Map(snapshot.daily.map((bucket) => [bucket.day, bucket]));
  const days: ActivityDay[] = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i -= 1) {
    const day = localDayKeyDaysAgo(i);
    const bucket = byDay.get(day);
    days.push({
      day,
      label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : weekdayLabel(day),
      plays: bucket?.plays ?? 0,
      listeningMs: bucket?.listeningMs ?? 0,
    });
  }
  let weekListeningMs = 0;
  let weekPlays = 0;
  let maxDayMs = 0;
  for (const entry of days) {
    weekListeningMs += entry.listeningMs;
    weekPlays += entry.plays;
    if (entry.listeningMs > maxDayMs) maxDayMs = entry.listeningMs;
  }
  return { days, weekListeningMs, weekPlays, maxDayMs };
}

/**
 * Artwork for a statistic row: the real artwork URI recorded at play time,
 * falling back to a neutral note tile (never a fabricated cover).
 */
function StatArtwork({ uri, size, fallbackIcon }: {
  uri: string | null;
  size: number;
  fallbackIcon: keyof typeof Ionicons.glyphMap;
}) {
  const [loadError, setLoadError] = useState(false);
  const dimension = { width: size, height: size };
  if (uri && !loadError) {
    return (
      <Image
        source={{ uri }}
        style={[dimension, styles.statArtwork]}
        resizeMode="cover"
        onError={() => setLoadError(true)}
      />
    );
  }
  return (
    <View style={[dimension, styles.statArtwork, styles.statArtworkFallback]}>
      <Ionicons name={fallbackIcon} size={Math.round(size * 0.5)} color={homeColors.textFaint} />
    </View>
  );
}

/**
 * Listening Statistics / Insights — a read-only, data-driven view of the
 * ONE persisted statistics record. It renders the statistics layer's
 * snapshot only: no PlayerController internals, no engine, no MediaStore,
 * no duration math of its own — every number here was recorded from real
 * playback events (a genuine start, or measured position progress).
 */
export function StatisticsScreen() {
  const insets = useSafeAreaInsets();
  const snapshot = useListeningStats();

  const topTracks = useMemo(
    () =>
      [...snapshot.tracks]
        .sort(byPlaysThenRecent)
        .slice(0, TOP_N),
    [snapshot],
  );
  const topArtists = useMemo(
    () =>
      [...snapshot.artists]
        .sort(byPlaysThenRecent)
        .slice(0, TOP_N),
    [snapshot],
  );
  const topAlbums = useMemo(
    () =>
      [...snapshot.albums]
        .sort(byPlaysThenRecent)
        .slice(0, TOP_N),
    [snapshot],
  );
  const recent = useMemo(
    () =>
      [...snapshot.tracks]
        .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
        .slice(0, RECENT_N),
    [snapshot],
  );
  const activity = useMemo(() => buildActivity(snapshot), [snapshot]);

  // Fresh install / cleared: a proper empty state — no zero-filled fake
  // rankings that would look like real data.
  if (snapshot.totalPlays === 0) {
    return (
      <View style={[styles.container, styles.emptyContainer]}>
        <Ionicons name="stats-chart-outline" size={54} color="rgba(255, 255, 255, 0.2)" />
        <Text style={styles.emptyTitle}>No listening data yet</Text>
        <Text style={styles.emptySubtitle}>
          Play some music and your listening insights will appear here.
        </Text>
      </View>
    );
  }

  const renderRankRow = (
    entry: TrackStat | NamedStat,
    index: number,
    kind: 'track' | 'artist' | 'album',
  ) => {
    const isTrack = kind === 'track';
    return (
      <View key={entry.key} style={[styles.row, index > 0 && styles.rowDivider]}>
        <Text style={styles.rank}>{index + 1}</Text>
        {isTrack ? (
          <StatArtwork uri={entry.artworkUri} size={40} fallbackIcon="musical-note" />
        ) : kind === 'album' ? (
          <StatArtwork uri={entry.artworkUri} size={40} fallbackIcon="disc-outline" />
        ) : (
          <View style={[styles.statArtwork, styles.statArtworkFallback]}>
            <Ionicons name="person" size={20} color={homeColors.textFaint} />
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {isTrack ? (entry as TrackStat).title : (entry as NamedStat).name}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {isTrack
              ? (entry as TrackStat).artist
              : kind === 'album'
                ? 'Album'
                : 'Artist'}
          </Text>
        </View>
        <View style={styles.rowStats}>
          <Text style={styles.rowPlays}>
            {entry.plays} {entry.plays === 1 ? 'play' : 'plays'}
          </Text>
          <Text style={styles.rowTime}>{formatListeningMs(entry.listeningMs)}</Text>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Overview */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.card}>
          <View style={styles.overviewRow}>
            <View style={styles.overviewMetric}>
              <Text style={styles.overviewValue}>{snapshot.totalPlays}</Text>
              <Text style={styles.overviewLabel}>Tracks played</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewMetric}>
              <Text style={styles.overviewValue}>
                {formatListeningMs(snapshot.totalListeningMs)}
              </Text>
              <Text style={styles.overviewLabel}>Listening time</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewMetric}>
              <Text style={styles.overviewValue}>{snapshot.uniqueTracks}</Text>
              <Text style={styles.overviewLabel}>Unique tracks</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Top Tracks */}
      {topTracks.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Tracks</Text>
          <View style={styles.card}>
            {topTracks.map((entry, index) => renderRankRow(entry, index, 'track'))}
          </View>
        </View>
      ) : null}

      {/* Top Artists */}
      {topArtists.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Artists</Text>
          <View style={styles.card}>
            {topArtists.map((entry, index) => renderRankRow(entry, index, 'artist'))}
          </View>
        </View>
      ) : null}

      {/* Top Albums — only when real album metadata produced entries */}
      {topAlbums.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Albums</Text>
          <View style={styles.card}>
            {topAlbums.map((entry, index) => renderRankRow(entry, index, 'album'))}
          </View>
        </View>
      ) : null}

      {/* Listening Activity — this week + the last 7 local days */}
      <View style={styles.section}>
        <View style={styles.sectionHeadingRow}>
          <Text style={styles.sectionTitleInline}>Listening Activity</Text>
          <Text style={styles.weekSummary}>
            Last 7 days: {formatListeningMs(activity.weekListeningMs)} · {activity.weekPlays}{' '}
            {activity.weekPlays === 1 ? 'play' : 'plays'}
          </Text>
        </View>
        <View style={styles.card}>
          {activity.days.map((entry, index) => (
            <View key={entry.day} style={[styles.row, index > 0 && styles.rowDivider]}>
              <Text style={styles.dayLabel}>{entry.label}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${activity.maxDayMs > 0 ? Math.max(2, Math.round((entry.listeningMs / activity.maxDayMs) * 100)) : 0}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.dayValue}>
                {entry.listeningMs > 0 ? formatListeningMs(entry.listeningMs) : '—'}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Recent — most recently active tracked tracks */}
      {recent.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent</Text>
          <View style={styles.card}>
            {recent.map((entry, index) => (
              <View key={entry.key} style={[styles.row, index > 0 && styles.rowDivider]}>
                <StatArtwork uri={entry.artworkUri} size={40} fallbackIcon="musical-note" />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {entry.title}
                  </Text>
                  <Text style={styles.rowSubtitle} numberOfLines={1}>
                    {entry.artist}
                  </Text>
                </View>
                <Text style={styles.rowTime}>{formatRelativeTime(entry.lastPlayedAt)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Factual footnote — local-only data, measured-not-estimated time */}
      <Text style={styles.footnote}>
        Statistics are stored on this device only. Listening time reflects measured playback
        progress — time paused, buffered or skipped is not counted.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: homeColors.background,
  },
  content: {
    paddingHorizontal: homeSpacing.screenX,
    paddingTop: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: homeColors.text,
  },
  emptySubtitle: {
    marginTop: 2,
    fontSize: 14,
    color: homeColors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    marginTop: 24,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionTitle: {
    ...sectionHeading,
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionTitleInline: {
    ...sectionHeading,
    marginLeft: 4,
  },
  weekSummary: {
    fontSize: 12,
    color: homeColors.textMuted,
    marginRight: 4,
  },
  card: {
    backgroundColor: homeColors.surface,
    borderRadius: homeRadius.surface,
    borderWidth: 1,
    borderColor: homeColors.border,
    overflow: 'hidden',
  },
  overviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
  },
  overviewMetric: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  overviewDivider: {
    width: 1,
    height: 36,
    backgroundColor: homeColors.border,
  },
  overviewValue: {
    fontSize: 20,
    fontWeight: '700',
    color: homeColors.text,
    letterSpacing: -0.3,
  },
  overviewLabel: {
    fontSize: 11,
    color: homeColors.textMuted,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: homeColors.border,
  },
  rank: {
    width: 18,
    fontSize: 13,
    fontWeight: '600',
    color: homeColors.textFaint,
    textAlign: 'center',
  },
  statArtwork: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: homeColors.surfaceRaised,
  },
  statArtworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: homeColors.border,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: homeColors.text,
  },
  rowSubtitle: {
    fontSize: 12,
    color: homeColors.textMuted,
  },
  rowStats: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rowPlays: {
    fontSize: 12,
    fontWeight: '600',
    color: homeColors.text,
  },
  rowTime: {
    fontSize: 11,
    color: homeColors.textMuted,
  },
  dayLabel: {
    width: 76,
    fontSize: 12,
    fontWeight: '600',
    color: homeColors.text,
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: homeColors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: homeColors.textFaint,
  },
  dayValue: {
    width: 64,
    fontSize: 11,
    color: homeColors.textMuted,
    textAlign: 'right',
  },
  footnote: {
    marginTop: 24,
    fontSize: 11,
    lineHeight: 16,
    color: homeColors.textFaint,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
