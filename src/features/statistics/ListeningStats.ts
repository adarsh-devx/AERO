import type { KeyValueStore } from '../../core/storage/types';
import type { Track } from '../../core/types/track';
import { getTrackArtworkUri, trackIdentityKey } from '../../core/types/track';
import { albumIdentityKey, normalizeArtistKey } from '../library/grouping';
import type { PlayerController } from '../../playback/PlayerController';

export const LISTENING_STATS_STORAGE_KEY = 'aero.listening_stats';
/** Schema version — an incompatible record is discarded, never guessed at. */
export const LISTENING_STATS_VERSION = 1;

// ── Bounds (every detailed structure is bounded; overall totals are not) ──
/** Detail entries kept for per-track counts (least-popular evicted). */
const TRACK_STAT_LIMIT = 300;
/** Detail entries kept for per-artist counts. */
const ARTIST_STAT_LIMIT = 200;
/** Detail entries kept for per-album counts. */
const ALBUM_STAT_LIMIT = 150;
/** Local-calendar-day buckets retained for daily activity. */
export const DAILY_RETENTION_DAYS = 90;

// ── Persistence cadence (never a write per position tick) ─────────────────
/** At most one coalesced write per this interval while time accrues. */
const FLUSH_INTERVAL_MS = 15_000;
/** UI re-render cadence while listening time is accruing. */
const NOTIFY_INTERVAL_MS = 5_000;

/** Per-track aggregate: identity-aware, with display metadata for the UI. */
export interface TrackStat {
  /** trackIdentityKey (origin:id) — online:X and local:X stay distinct. */
  readonly key: string;
  readonly title: string;
  readonly artist: string;
  readonly artworkUri: string | null;
  readonly plays: number;
  readonly listeningMs: number;
  readonly lastPlayedAt: number;
}

/** Per-artist / per-album aggregate (normalised identity + display name). */
export interface NamedStat {
  readonly key: string;
  readonly name: string;
  readonly artworkUri: string | null;
  readonly plays: number;
  readonly listeningMs: number;
  readonly lastPlayedAt: number;
}

/** One local-calendar-day bucket (YYYY-MM-DD in the device's local time). */
export interface DailyBucket {
  readonly day: string;
  readonly plays: number;
  readonly listeningMs: number;
}

/** The whole statistics record — also the React snapshot (stable reference). */
export interface ListeningStatsSnapshot {
  readonly version: number;
  readonly totalPlays: number;
  readonly totalListeningMs: number;
  /** Distinct track identities recorded so far (see note in limitations). */
  readonly uniqueTracks: number;
  readonly tracks: readonly TrackStat[];
  readonly artists: readonly NamedStat[];
  readonly albums: readonly NamedStat[];
  readonly daily: readonly DailyBucket[];
  readonly lastPlayedAt: number | null;
}

/** Fresh-install / cleared state. One shared immutable default. */
export const EMPTY_LISTENING_STATS: ListeningStatsSnapshot = {
  version: LISTENING_STATS_VERSION,
  totalPlays: 0,
  totalListeningMs: 0,
  uniqueTracks: 0,
  tracks: [],
  artists: [],
  albums: [],
  daily: [],
  lastPlayedAt: null,
};

// ── Local calendar-day helpers (device time, never a blind UTC day) ───────

function dayKeyOf(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local calendar day of a timestamp, 'YYYY-MM-DD'. Lexicographic = chronological. */
export function localDayKey(at: number = Date.now()): string {
  return dayKeyOf(new Date(at));
}

/** The local calendar day `days` days before `from` (retention window / UI). */
export function localDayKeyDaysAgo(days: number, from: number = Date.now()): string {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return dayKeyOf(date);
}

// ── Incremental helpers ───────────────────────────────────────────────────

/** Evicts the weakest entry: fewest plays, ties broken by oldest activity. */
function evictWeakest<T extends { plays: number; lastPlayedAt: number }>(entries: T[]): T[] {
  let weakest = 0;
  for (let i = 1; i < entries.length; i += 1) {
    const candidate = entries[i];
    const current = entries[weakest];
    if (
      candidate.plays < current.plays ||
      (candidate.plays === current.plays && candidate.lastPlayedAt < current.lastPlayedAt)
    ) {
      weakest = i;
    }
  }
  return entries.filter((_, index) => index !== weakest);
}

/**
 * Increment one day bucket (creating it when missing) and drop buckets
 * older than the retention window — bounded daily history by construction.
 */
function upsertDaily(
  daily: readonly DailyBucket[],
  day: string,
  addPlays: number,
  addListeningMs: number,
): DailyBucket[] {
  const minDay = localDayKeyDaysAgo(DAILY_RETENTION_DAYS - 1);
  let next = daily.filter((bucket) => bucket.day >= minDay && bucket.day <= day);
  const index = next.findIndex((bucket) => bucket.day === day);
  if (index >= 0) {
    const bucket = next[index];
    next = [...next];
    next[index] = {
      ...bucket,
      plays: bucket.plays + addPlays,
      listeningMs: bucket.listeningMs + addListeningMs,
    };
  } else {
    next = [...next, { day, plays: addPlays, listeningMs: addListeningMs }];
  }
  return next;
}

// ── Persistence validation (mirror of SettingsStore / PlaybackSession) ────

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeNamedStat(value: unknown): NamedStat | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<NamedStat>;
  if (typeof candidate.key !== 'string' || candidate.key.length === 0) return null;
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) return null;
  if (!isCount(candidate.plays) || !isCount(candidate.listeningMs)) return null;
  if (!isCount(candidate.lastPlayedAt)) return null;
  return {
    key: candidate.key,
    name: candidate.name,
    artworkUri: typeof candidate.artworkUri === 'string' ? candidate.artworkUri : null,
    plays: candidate.plays,
    listeningMs: candidate.listeningMs,
    lastPlayedAt: candidate.lastPlayedAt,
  };
}

function normalizeTrackStat(value: unknown): TrackStat | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<TrackStat>;
  if (typeof candidate.key !== 'string' || candidate.key.length === 0) return null;
  if (typeof candidate.title !== 'string' || typeof candidate.artist !== 'string') return null;
  if (!isCount(candidate.plays) || !isCount(candidate.listeningMs)) return null;
  if (!isCount(candidate.lastPlayedAt)) return null;
  return {
    key: candidate.key,
    title: candidate.title,
    artist: candidate.artist,
    artworkUri: typeof candidate.artworkUri === 'string' ? candidate.artworkUri : null,
    plays: candidate.plays,
    listeningMs: candidate.listeningMs,
    lastPlayedAt: candidate.lastPlayedAt,
  };
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDailyBucket(value: unknown): DailyBucket | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<DailyBucket>;
  if (typeof candidate.day !== 'string' || !DAY_PATTERN.test(candidate.day)) return null;
  if (!isCount(candidate.plays) || !isCount(candidate.listeningMs)) return null;
  return { day: candidate.day, plays: candidate.plays, listeningMs: candidate.listeningMs };
}

/**
 * Structural check + normalization for a persisted envelope. Returns null
 * when the record is malformed or from another schema version — the caller
 * then discards ONLY this record. Individually malformed entries are
 * dropped, not the whole record; bounds and retention are re-applied on
 * load so a tampered record can never unbound the store.
 */
function normalizeRecord(value: unknown): ListeningStatsSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== LISTENING_STATS_VERSION) return null;
  if (
    !Array.isArray(candidate.tracks) ||
    !Array.isArray(candidate.artists) ||
    !Array.isArray(candidate.albums) ||
    !Array.isArray(candidate.daily)
  ) {
    return null;
  }

  const tracks = candidate.tracks
    .map(normalizeTrackStat)
    .filter((entry): entry is TrackStat => entry !== null)
    .slice(0, TRACK_STAT_LIMIT);
  const artists = candidate.artists
    .map(normalizeNamedStat)
    .filter((entry): entry is NamedStat => entry !== null)
    .slice(0, ARTIST_STAT_LIMIT);
  const albums = candidate.albums
    .map(normalizeNamedStat)
    .filter((entry): entry is NamedStat => entry !== null)
    .slice(0, ALBUM_STAT_LIMIT);
  const minDay = localDayKeyDaysAgo(DAILY_RETENTION_DAYS - 1);
  const daily = candidate.daily
    .map(normalizeDailyBucket)
    .filter((entry): entry is DailyBucket => entry !== null)
    .filter((entry) => entry.day >= minDay);

  return {
    version: LISTENING_STATS_VERSION,
    totalPlays: isCount(candidate.totalPlays) ? candidate.totalPlays : 0,
    totalListeningMs: isCount(candidate.totalListeningMs) ? candidate.totalListeningMs : 0,
    uniqueTracks: isCount(candidate.uniqueTracks)
      ? Math.max(candidate.uniqueTracks, tracks.length)
      : tracks.length,
    tracks,
    artists,
    albums,
    daily,
    lastPlayedAt: isCount(candidate.lastPlayedAt) ? candidate.lastPlayedAt : null,
  };
}

/** Where a measured listening-time delta belongs (captured at segment start). */
export interface ListeningAttribution {
  readonly trackKey: string;
  readonly artistKey: string | null;
  readonly albumKey: string | null;
}

/**
 * ListeningStats: the ONE persisted statistics record (`aero.listening_stats`).
 *
 * Follows the same framework-free conventions as the other persistent
 * features: subscribe/getSnapshot for useSyncExternalStore, a hydrate-once
 * promise, copy-on-write replace + notify, and graceful storage failure.
 * It is fed ONLY by real playback lifecycle events — the canonical
 * PlayerController onTrackStarted callback (plays) and measured engine
 * position progress (listening time). It never reads the engine, MediaStore
 * or the resolver itself, and it never computes a statistic the playback
 * layer did not actually report.
 *
 * Growth is bounded by construction: per-track/artist/album detail lists
 * are capped (weakest evicted), daily buckets are pruned to
 * DAILY_RETENTION_DAYS, and the overall totals (totalPlays,
 * totalListeningMs, uniqueTracks) live outside those bounded lists.
 *
 * Persistence is coalesced: in-memory updates are cheap and immediate;
 * disk writes happen at most once per FLUSH_INTERVAL_MS plus an immediate
 * checkpoint at playback lifecycle edges (pause, track switch, stop).
 * A malformed record discards ONLY this key — never other stores.
 */
export class ListeningStats {
  private readonly store: KeyValueStore;
  private readonly listeners = new Set<() => void>();
  private stats: ListeningStatsSnapshot = EMPTY_LISTENING_STATS;
  private readyPromise: Promise<void> | null = null;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNotifyAt = 0;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  /** React external-store subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** React external-store snapshot: the current record (stable reference). */
  getSnapshot = (): ListeningStatsSnapshot => this.stats;

  /** Loads persisted statistics once; concurrent callers share the promise. */
  hydrate(): Promise<void> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /**
   * Records ONE genuine playback start — wired to the canonical
   * PlayerController.onTrackStarted callback (resolve + load + play all
   * succeeded). Selection, queue insertion, prefetch, resolution and
   * downloads never reach this method.
   */
  recordPlay(track: Track): void {
    void this.recordPlayInternal(track);
  }

  /**
   * Credits one measured slice of listening time (engine position progress
   * between two 'playing' snapshots). Never the track's duration: only
   * deltas the tracker actually observed are accepted.
   */
  addListeningTime(deltaMs: number, attribution: ListeningAttribution): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    void this.addListeningInternal(deltaMs, attribution);
  }

  /**
   * Persists pending in-memory time at a playback lifecycle edge (pause,
   * buffering, completion, track switch, stop). No-op when nothing is
   * pending. Notifies subscribers so the UI reflects the final segment.
   */
  checkpoint(): void {
    this.notify();
    if (!this.dirty) return;
    this.cancelFlushTimer();
    void this.persist();
  }

  /**
   * Clears ONLY listening statistics: in-memory first (subscribers
   * re-render immediately), then the statistics key. Playback history,
   * search history, playlists, likes, downloads, the playback session and
   * the settings record are separate keys and are never touched.
   */
  clear(): void {
    void this.clearInternal();
  }

  private async clearInternal(): Promise<void> {
    // Never clear before the stored record loads, or a late hydrate would
    // resurrect the old statistics over the empty ones.
    await this.hydrate();
    this.cancelFlushTimer();
    this.dirty = false;
    this.stats = EMPTY_LISTENING_STATS;
    this.notify();
    try {
      await this.store.removeItem(LISTENING_STATS_STORAGE_KEY);
    } catch (error) {
      console.warn('[STATS] could not clear listening statistics.', error);
    }
  }

  private async recordPlayInternal(track: Track): Promise<void> {
    // Never write before the stored record loads, or the first play after
    // launch would overwrite persisted statistics.
    await this.hydrate();
    const now = Date.now();
    const day = localDayKey(now);
    const prev = this.stats;

    // ── Track (identity-aware: origin:id) ──
    const trackKey = trackIdentityKey(track);
    let tracks = [...prev.tracks];
    let uniqueTracks = prev.uniqueTracks;
    const trackIndex = tracks.findIndex((entry) => entry.key === trackKey);
    if (trackIndex >= 0) {
      const entry = tracks[trackIndex];
      tracks[trackIndex] = {
        ...entry,
        title: track.title,
        artist: track.artist,
        artworkUri: getTrackArtworkUri(track) ?? entry.artworkUri,
        plays: entry.plays + 1,
        lastPlayedAt: now,
      };
    } else {
      if (tracks.length >= TRACK_STAT_LIMIT) tracks = evictWeakest(tracks);
      tracks.push({
        key: trackKey,
        title: track.title,
        artist: track.artist,
        artworkUri: getTrackArtworkUri(track) ?? null,
        plays: 1,
        listeningMs: 0,
        lastPlayedAt: now,
      });
      uniqueTracks = prev.uniqueTracks + 1;
    }

    // ── Artist (the app's ONE normalisation: NFC fold + case/whitespace) ──
    const artistKey = normalizeArtistKey(track.artist);
    let artists = [...prev.artists];
    if (artistKey.length > 0) {
      const index = artists.findIndex((entry) => entry.key === artistKey);
      if (index >= 0) {
        artists[index] = { ...artists[index], plays: artists[index].plays + 1, lastPlayedAt: now };
      } else {
        if (artists.length >= ARTIST_STAT_LIMIT) artists = evictWeakest(artists);
        artists.push({
          key: artistKey,
          name: track.artist.trim(),
          artworkUri: getTrackArtworkUri(track) ?? null,
          plays: 1,
          listeningMs: 0,
          lastPlayedAt: now,
        });
      }
    }

    // ── Album — ONLY when real album metadata exists (null key = skip) ──
    const albumKey = albumIdentityKey(track);
    let albums = [...prev.albums];
    if (albumKey !== null) {
      const index = albums.findIndex((entry) => entry.key === albumKey);
      if (index >= 0) {
        albums[index] = { ...albums[index], plays: albums[index].plays + 1, lastPlayedAt: now };
      } else {
        if (albums.length >= ALBUM_STAT_LIMIT) albums = evictWeakest(albums);
        albums.push({
          key: albumKey,
          name: track.album?.trim() ?? '',
          artworkUri: getTrackArtworkUri(track) ?? null,
          plays: 1,
          listeningMs: 0,
          lastPlayedAt: now,
        });
      }
    }

    const daily = upsertDaily(prev.daily, day, 1, 0);

    this.commit({
      ...prev,
      totalPlays: prev.totalPlays + 1,
      uniqueTracks,
      lastPlayedAt: now,
      tracks,
      artists,
      albums,
      daily,
    });
    this.notify();
  }

  private async addListeningInternal(
    deltaMs: number,
    attribution: ListeningAttribution,
  ): Promise<void> {
    await this.hydrate();
    const prev = this.stats;
    const day = localDayKey();

    // Per-entry increments only — no sorting, no full-record recomputation.
    let tracks: TrackStat[] = [...prev.tracks];
    const trackIndex = tracks.findIndex((entry) => entry.key === attribution.trackKey);
    if (trackIndex >= 0) {
      tracks[trackIndex] = {
        ...tracks[trackIndex],
        listeningMs: tracks[trackIndex].listeningMs + deltaMs,
      };
    }

    let artists: NamedStat[] = [...prev.artists];
    if (attribution.artistKey !== null) {
      const index = artists.findIndex((entry) => entry.key === attribution.artistKey);
      if (index >= 0) {
        artists[index] = { ...artists[index], listeningMs: artists[index].listeningMs + deltaMs };
      }
    }

    let albums: NamedStat[] = [...prev.albums];
    if (attribution.albumKey !== null) {
      const index = albums.findIndex((entry) => entry.key === attribution.albumKey);
      if (index >= 0) {
        albums[index] = { ...albums[index], listeningMs: albums[index].listeningMs + deltaMs };
      }
    }

    const daily = upsertDaily(prev.daily, day, 0, deltaMs);

    this.commit({
      ...prev,
      totalListeningMs: prev.totalListeningMs + deltaMs,
      tracks,
      artists,
      albums,
      daily,
    });
    this.notifyThrottled();
  }

  // ── Reactivity / persistence plumbing ───────────────────────────────────

  /** Copy-on-write publish + mark dirty + schedule the coalesced flush. */
  private commit(next: ListeningStatsSnapshot): void {
    this.stats = next;
    this.dirty = true;
    this.scheduleFlush();
  }

  private notify(): void {
    this.lastNotifyAt = Date.now();
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Bounded UI cadence while listening time accrues (never per tick). */
  private notifyThrottled(): void {
    const now = Date.now();
    if (now - this.lastNotifyAt < NOTIFY_INTERVAL_MS) return;
    this.notify();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.dirty) void this.persist();
    }, FLUSH_INTERVAL_MS);
  }

  private cancelFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.store.setItem(LISTENING_STATS_STORAGE_KEY, JSON.stringify(this.stats));
      this.dirty = false;
    } catch (error) {
      // Stays dirty: the next commit or checkpoint retries. Statistics are
      // never allowed to break playback or crash the app.
      console.warn('[STATS] could not persist listening statistics.', error);
    }
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(LISTENING_STATS_STORAGE_KEY);
    } catch (error) {
      console.warn('[STATS] storage unavailable; starting with empty statistics.', error);
      return;
    }
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[STATS] malformed statistics discarded.');
      await this.discard();
      return;
    }
    const record = normalizeRecord(parsed);
    if (record === null) {
      console.warn('[STATS] incompatible/invalid statistics discarded.');
      await this.discard();
      return;
    }
    this.stats = record;
    this.notify();
  }

  /** Best-effort removal of ONLY the statistics record; never other keys. */
  private async discard(): Promise<void> {
    try {
      await this.store.removeItem(LISTENING_STATS_STORAGE_KEY);
    } catch (error) {
      console.warn('[STATS] could not discard invalid statistics.', error);
    }
  }
}

/**
 * Bridges PlayerController snapshots to measured listening time — the
 * statistics layer's ONLY view of playback. Mirrors the
 * startPlaybackSessionPersistence pattern (composition wires it once).
 *
 * Measurement model — conservative and honest:
 *
 *  - a delta is credited ONLY between two snapshots where status is
 *    'playing' for the SAME track and the position moved forward — and
 *    never by more than the WALL-CLOCK time that actually elapsed between
 *    the two snapshots (~500 ms per tick in normal playback);
 *  - pause, buffering ('loading'), completion ('stopped'), error, stop and
 *    track switches all close the segment immediately: no wall-clock time
 *    is counted while audio is not measured as playing;
 *  - a repeated status emission with an unchanged position credits 0
 *    (double-counting is impossible by construction);
 *  - backward seeks / replays (negative delta) credit nothing, and a
 *    forward seek (tap or drag scrub) can never credit more than the real
 *    time spent with audio playing — manual seeking cannot inject fake
 *    listening time;
 *  - the first tick of every segment only establishes the baseline, so at
 *    most ~500 ms per segment is under-counted.
 *
 * Total listening time therefore never includes the track's full duration
 * on start — only position progress the engine actually reported.
 */
export function startListeningDurationTracking(
  controller: PlayerController,
  stats: ListeningStats,
): () => void {
  let trackedKey: string | null = null;
  let artistKey: string | null = null;
  let albumKey: string | null = null;
  let lastPosition: number | null = null;
  // Wall-clock of the last observation — the ceiling for any credited delta
  // (position can only move forward at 1.0×, so elapsed time bounds truth).
  let lastObservedAt: number | null = null;

  return controller.subscribe(() => {
    const snapshot = controller.getSnapshot();
    const track = snapshot.currentTrack;
    const key = track !== null ? trackIdentityKey(track) : null;

    if (key !== trackedKey) {
      // Segment boundary: new selection, switch or stop. Flush the previous
      // segment's pending time and re-capture attribution metadata.
      stats.checkpoint();
      trackedKey = key;
      artistKey = track !== null && normalizeArtistKey(track.artist).length > 0
        ? normalizeArtistKey(track.artist)
        : null;
      albumKey = track !== null ? albumIdentityKey(track) : null;
      lastPosition = null;
      lastObservedAt = null;
      return;
    }

    if (snapshot.status === 'playing' && typeof snapshot.positionMs === 'number') {
      const position = snapshot.positionMs;
      const now = Date.now();
      if (lastPosition !== null && trackedKey !== null) {
        const delta = position - lastPosition;
        // Position only moves forward at wall-clock rate in normal 1.0×
        // playback, so min(delta, elapsed) IS the honest listening time:
        // normal counting is unchanged, while a manual seek — tap or drag
        // scrub — can never credit more time than really elapsed (the drag
        // publishes one catch-up snapshot, so its whole scrub span is
        // bounded by that one elapsed interval).
        const elapsed = lastObservedAt !== null ? now - lastObservedAt : delta;
        if (delta > 0) {
          stats.addListeningTime(Math.min(delta, elapsed), {
            trackKey: trackedKey,
            artistKey,
            albumKey,
          });
        }
      }
      lastPosition = position;
      lastObservedAt = now;
      return;
    }

    if (lastPosition !== null) {
      // Pause / buffering / completion / error / stop: the playing segment
      // ended — close it and checkpoint the accrued time.
      lastPosition = null;
      lastObservedAt = null;
      stats.checkpoint();
    }
  });
}
