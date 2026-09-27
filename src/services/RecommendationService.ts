import type { Track } from '../core/types/track';
import { trackIdentityKey } from '../core/types/track';
import {
  alternateVersionCount,
  artistKey,
  fold,
  songKey as metadataKey,
} from '../core/types/songKey';

// The ONE canonical recommendation/display-level song key and its
// normalization helpers (fold / artistKey / alternateVersionCount) live
// in core/types/songKey — shared with Home display dedup and Recently
// Played. `metadataKey` below is that shared songKey under its local
// name; no second implementation of the normalization exists anywhere.

/**
 * One personalized Home section. Plain data: Home only renders it.
 */
export type RecommendationSectionId =
  | 'because-you-played'
  | 'more-from-artist'
  | 'made-for-you'
  /** Current-track discovery: related results for the selected track. */
  | 'related-to-this-song'
  /** Current-track discovery: everything from the current track's artist. */
  | 'current-artist'
  /** The user's newest search intents, as their own section. */
  | 'recent-searches'
  /** Provider-surfaced candidates that match no personal signal yet. */
  | 'discover-new';

export interface RecommendationSection {
  readonly id: RecommendationSectionId;
  readonly title: string;
  readonly tracks: readonly Track[];
  /**
   * Internal provenance (§13): the basis this section was built from
   * (folded artist, track identity key, or a static source tag). Retained
   * for ranking/debugging; never rendered by the UI and never persisted.
   */
  readonly sourceKey?: string;
}

/** Shape of the merged provider search used for candidate generation. */
export interface RecommendationSearchOutcome {
  readonly tracks: readonly Track[];
  readonly errors: ReadonlyMap<string, Error>;
}

/** The exact surface consumed from the existing history/likes stores. */
export interface TrackStoreSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly Track[];
  hydrate(): Promise<void>;
}

/** The exact surface consumed from the existing search-history store. */
export interface QueryStoreSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly string[];
  hydrate(): Promise<void>;
}

/**
 * Minimal view of the player used for recommendation context (current
 * track exclusion) — structurally satisfied by PlayerController.
 */
export interface CurrentTrackSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): { currentTrack: Track | null };
}

/**
 * The exact settings surface consumed to gate personalization AND
 * search-history consumption — structurally satisfied by the app-level
 * SettingsStore (whose record carries both flags).
 */
export interface PersonalizationSettingsSource {
  subscribe(listener: () => void): () => void;
  /** Resolves once persisted settings have been read (shared promise). */
  hydrate(): Promise<void>;
  getSnapshot(): {
    /** Personalized Home preference; valid once hydrate() resolves. */
    readonly personalizedHomeEnabled: boolean;
    /**
     * "Save search history" — when false, discovery must NOT consume the
     * stored queries (not for sections, not for autoplay planning): a
     * preference that stops saving also stops using (§9).
     */
    readonly searchHistoryEnabled: boolean;
  };
}

export interface RecommendationServiceDependencies {
  /** Existing MusicService.search — no direct InnerTube calls anywhere. */
  readonly search: (query: string) => Promise<RecommendationSearchOutcome>;
  readonly history: TrackStoreSource;
  readonly likedSongs: TrackStoreSource;
  readonly searchHistory: QueryStoreSource;
  readonly player: CurrentTrackSource;
  /** Personalized Home gate — structurally the app-level settings store. */
  readonly settings: PersonalizationSettingsSource;
}

type QuerySource =
  | 'recent-artist'
  | 'liked-artist'
  | 'search-intent'
  | 'liked-track'
  /**
   * Current-track discovery (NON-personalized context): results related
   * to the currently selected track. Carries no personal-signal bonus and
   * runs even when Personalized Home is off — it uses only the player's
   * own metadata, never history/likes/search (§10).
   */
  | 'related-song'
  /** Current-track discovery: the current track's artist catalogue. */
  | 'current-artist'
  /**
   * Autoplay-only: a metadata query built from the CURRENT track (never
   * from history/likes/search signals). Carries no ranking bonus, and
   * Home refresh plans never contain it.
   */
  | 'playback-context';

interface PlannedQuery {
  readonly query: string;
  readonly source: QuerySource;
  /** Section title this query feeds (claimable sections only). */
  readonly label?: string;
}

interface ScoredTrack {
  readonly track: Track;
  readonly source: QuerySource;
  readonly score: number;
}

interface SignalContext {
  readonly likedArtists: ReadonlySet<string>;
  readonly topRecentArtists: ReadonlySet<string>;
  readonly recentArtists: ReadonlySet<string>;
  readonly recentAlbums: ReadonlySet<string>;
}

// ── Bounds (all documented, none arbitrary) ────────────────────────────
/**
 * Provider searches per refresh (§19): up to 2 current-track context
 * queries + up to 5 signal queries (recent artist, liked artist, newest
 * two search intents, newest liked track). Every query is TTL-cached and
 * in-flight-deduplicated, identical intents collapse to one request, and
 * a skipping session coalesces into one refresh — small, bounded, never a
 * per-item search explosion.
 */
const MAX_QUERIES_PER_REFRESH = 7;
/** Candidate cache lifetime: reuses artist queries across refreshes (§10);
 *  pull-to-refresh bypasses it with force. */
const QUERY_CACHE_TTL_MS = 10 * 60_000;
/** History depth used as recency signal — beyond ten plays back the data
 *  stops describing current taste; never queried per-entry (§14). */
const RECENT_SIGNAL_DEPTH = 10;
/** Artists from the five newest plays score as "strong recency". */
const TOP_RECENT_DEPTH = 5;
/** Section sizes: artist-context sections are focused (8), the ranked
 *  catch-all shows a broader set (12) — same depth as the existing grids. */
const BECAUSE_SECTION_SIZE = 8;
const ARTIST_SECTION_SIZE = 8;
const MADE_FOR_YOU_SIZE = 12;
/**
 * "Discover Something New": provider-surfaced candidates that match NO
 * personal signal — same depth as the other focused sections.
 */
const DISCOVER_SECTION_SIZE = 8;
/**
 * Autoplay candidate pool depth: deep enough for the artist-diversity
 * rule to have real alternatives — the same depth as one existing
 * section bound, not a new magic number. Gathering stops here, so one
 * end-of-track lookup costs at most a few sequential, cached searches.
 */
const AUTOPLAY_POOL_TARGET = BECAUSE_SECTION_SIZE;
/** Artist diversity cap per section: an affinity may surface a few songs
 *  from one artist, but a section must never become a one-artist wall (§9). */
const MAX_TRACKS_PER_ARTIST = 3;

// ── Automatic Up Next fill ──────────────────────────────────────────
/**
 * Max provider searches per automatic-queue batch: sequential, TTL-cached
 * and in-flight-deduplicated through the SAME getCandidateTracks every
 * other path uses (a recent Home refresh or autoplay lookup makes most —
 * often all — of them cache hits), with an early stop once enough unique
 * candidates exist. A hard bound, so one top-up can never become a
 * request loop or burst.
 */
const AUTO_QUEUE_MAX_QUERIES = 10;
/** Stop collecting batch candidates once this many unique usable songs
 *  exist — twice a full 40-track queue, capped: enough headroom for the
 *  diversity pass to have real alternatives, never over-collecting. */
const AUTO_QUEUE_POOL_TARGET = 60;
/** Per-artist cap while selecting the automatic queue: a 40-track queue
 *  should hold about 2–3 tracks per artist (§2). */
const AUTO_QUEUE_MAX_PER_ARTIST = 3;
/** Below this many selected after the strict sweeps (thin pool), the
 *  per-artist cap relaxes ONCE to this — still alternating artists, so a
 *  small artist set yields the maximum valid candidates without ever
 *  becoming a wall of consecutive same-artist tracks. */
const AUTO_QUEUE_RELAX_BELOW = 30;
const AUTO_QUEUE_RELAX_CAP = 6;

/** Provider fallback strings that mean "metadata was missing" (§9). */
const PLACEHOLDER_TITLES = new Set(['unknown title', '']);
const PLACEHOLDER_ARTISTS = new Set(['unknown artist', '']);

function isUsable(track: Track): boolean {
  const title = track.title.trim();
  const artist = track.artist.trim();
  if (PLACEHOLDER_TITLES.has(title.toLowerCase())) return false;
  if (PLACEHOLDER_ARTISTS.has(artist.toLowerCase())) return false;
  if (title.length === 0 || artist.length === 0) return false;
  if (track.durationMs !== undefined && (!Number.isFinite(track.durationMs) || track.durationMs <= 0)) {
    return false;
  }
  return true;
}

/**
 * Takes up to `limit` tracks while capping any single artist at
 * MAX_TRACKS_PER_ARTIST. Input order is preserved (stable), so the
 * result is deterministic for a given candidate list.
 */
function takeDiverse(
  tracks: readonly Track[],
  limit: number,
): { taken: readonly Track[]; rest: readonly Track[] } {
  const taken: Track[] = [];
  const rest: Track[] = [];
  const perArtist = new Map<string, number>();
  for (const track of tracks) {
    if (taken.length < limit) {
      const artist = artistKey(track.artist);
      const count = perArtist.get(artist) ?? 0;
      if (count < MAX_TRACKS_PER_ARTIST) {
        perArtist.set(artist, count + 1);
        taken.push(track);
        continue;
      }
    }
    rest.push(track);
  }
  return { taken, rest };
}

/**
 * Selects the automatic Up Next batch from a deduped candidate pool:
 *
 * 1. CONTROLLED RANDOMIZATION — one Fisher–Yates shuffle of a COPY, so
 *    the same song played twice rarely yields the same queue order and
 *    provider order is never returned verbatim, while manually queued
 *    items (never part of this pool) keep their exact order.
 * 2. GREEDY DIVERSITY SWEEPS over the shuffled pool:
 *    pass 1 — hard cap AUTO_QUEUE_MAX_PER_ARTIST (3) per artist AND never
 *             the same artist twice in a row (adjacency-blocked skips are
 *             retried while the last pick changes, so artists alternate);
 *    pass 2/3 — only when the strict pass stalls BELOW
 *             AUTO_QUEUE_RELAX_BELOW: relax the cap once to
 *             AUTO_QUEUE_RELAX_CAP (still alternating), then allow a
 *             consecutive repeat only when nothing else fits — a thin
 *             pool returns its maximum valid candidates instead of an
 *             artificially short queue.
 * 3. Stops at `target` or pool exhaustion — never fabricates tracks.
 *
 * Artist identity is artistKey (normalized, primary-only), so featured
 * spellings and one artist's topic-channel uploads count as one artist
 * for both the cap and the no-consecutive rule.
 */
function selectAutoQueue(pool: readonly Track[], target: number): Track[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const result: Track[] = [];
  const counts = new Map<string, number>();
  let pending = shuffled;

  const sweep = (cap: number, allowConsecutive: boolean): boolean => {
    let progressed = false;
    const remaining: Track[] = [];
    for (const track of pending) {
      if (result.length >= target) {
        remaining.push(track);
        continue;
      }
      const artist = artistKey(track.artist);
      const count = counts.get(artist) ?? 0;
      const last =
        result.length > 0 ? artistKey(result[result.length - 1].artist) : null;
      if (count < cap && (allowConsecutive || artist !== last)) {
        counts.set(artist, count + 1);
        result.push(track);
        progressed = true;
      } else {
        remaining.push(track);
      }
    }
    pending = remaining;
    return progressed;
  };

  while (
    result.length < target &&
    pending.length > 0 &&
    sweep(AUTO_QUEUE_MAX_PER_ARTIST, false)
  ) {
    // strict pass: ≤3 per artist, alternating — keep going while it works
  }
  if (result.length < AUTO_QUEUE_RELAX_BELOW) {
    while (result.length < target && pending.length > 0 && sweep(AUTO_QUEUE_RELAX_CAP, false)) {
      // thin pool: relax the cap, still alternating
    }
    while (result.length < target && pending.length > 0 && sweep(AUTO_QUEUE_RELAX_CAP, true)) {
      // last resort: consecutive only when literally nothing else fits
    }
  }
  return result;
}

/**
 * RecommendationService — Aero's LOCAL personalization layer (§2):
 *
 *   HomeScreen → this service → signals → bounded candidate generation
 *   → filter/dedup/rank → sections → existing Home UI.
 *
 * Signals (§3) are only what the repository actually stores:
 * - playback history (recency-ordered, no play counts exist — recency
 *   position is the only frequency-adjacent signal available, so no
 *   "most played" statistic is ever fabricated),
 * - liked songs, - search history (user's own queries), - the current
 *   track (context/exclusion). Playlist contents are intentionally NOT
 *   used in v1 — playlist additions are curations, not consumption.
 *
 * Candidate generation (§4) goes through the existing
 * `MusicService.search` (local + InnerTube merged) with at most
 * MAX_QUERIES_PER_REFRESH queries: current-track context ("<title>
 * <artist>" → Related To This Song, "<artist> songs" → More from <artist>),
 * recent-artist discovery, liked-artist discovery, the newest two search
 * queries (only while Save search history is on), and the newest liked
 * track. Provider-specific code stays inside the provider; this service
 * never touches InnerTube, streams, NewPipe or the playback pipeline.
 *
 * Ranking (§7) is deterministic and documented (see `score`), applied to
 * the "Made for You" catch-all; artist-context sections keep the
 * provider's own relevance order (stable given the response).
 *
 * Reactivity (§13): subscribes to the EXISTING stores' own
 * subscribe/getSnapshot — no new global state. Signal changes rebuild
 * sections instantly from cache and schedule a coalesced, TTL-respecting
 * refresh; current-track changes rebuild locally first (§G), then fetch
 * current-track discovery through ONE coalesced, cache-backed refresh —
 * never a request burst and never touching playback. Requests are cached,
 * in-flight de-duplicated, and generation-guarded so stale responses can
 * never overwrite newer state (§10/§16F/§21). Cold start with no signals
 * falls back to current-track context only — or `[]` when idle — sections
 * are hidden, never filled with manufactured content (§5/§6/§11).
 */
export class RecommendationService {
  private readonly deps: RecommendationServiceDependencies;
  private readonly listeners = new Set<() => void>();

  private sections: readonly RecommendationSection[] = [];
  private refreshGeneration = 0;
  private inFlight: Promise<void> | null = null;
  private rerunRequested = false;
  private pendingForce = false;
  private lastCurrentTrackKey: string | null = null;
  /** Coalesces current-track discovery fetches across a skipping session. */
  private currentTrackRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Mirrors the Personalized Home preference; updated only by its listener. */
  private personalizedHomeEnabled: boolean;
  /** Mirrors Save search history (§9); updated only by its listener. */
  private searchHistoryEnabled: boolean;

  private readonly queryCache = new Map<string, { tracks: readonly Track[]; at: number }>();
  private readonly inflightQueries = new Map<string, Promise<readonly Track[]>>();

  /** React external-store subscription (useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Current personalized sections; stable reference until something changes. */
  getSnapshot = (): readonly RecommendationSection[] => this.sections;

  constructor(deps: RecommendationServiceDependencies) {
    this.deps = deps;
    this.personalizedHomeEnabled = deps.settings.getSnapshot().personalizedHomeEnabled;
    this.searchHistoryEnabled = deps.settings.getSnapshot().searchHistoryEnabled;
    // Existing store subscriptions only — like/play/search changes flow
    // in through the stores' own notification mechanism; the settings
    // subscription is the Personalized Home gate.
    deps.history.subscribe(this.handleSignalsChanged);
    deps.likedSongs.subscribe(this.handleSignalsChanged);
    deps.searchHistory.subscribe(this.handleSignalsChanged);
    deps.player.subscribe(this.handlePlayerChanged);
    deps.settings.subscribe(this.handleSettingsChanged);
  }

  /**
   * Fetches/derives fresh sections. Never rejects (failures degrade to
   * whatever data exists — Home keeps working offline, §16I).
   * Concurrent calls coalesce: a call during an in-flight refresh marks
   * a rerun (carrying `force`) that starts after the current one, so the
   * LATEST request always publishes last and stale data cannot win.
   */
  refresh(options?: { force?: boolean }): Promise<void> {
    // Personalized Home OFF still runs — the plan builder below emits ONLY
    // non-personalized current-track context in that mode (signal stores
    // are never hydrated or read, §10); with no current track the plan is
    // empty and an empty publication results.
    const force = options?.force === true;
    if (this.inFlight !== null) {
      this.rerunRequested = true;
      this.pendingForce = this.pendingForce || force;
      return this.inFlight;
    }
    const run = this.executeRefresh(force)
      .catch((error) => {
        console.warn('[RECOMMENDATIONS] refresh failed:', error);
      })
      .finally(() => {
        this.inFlight = null;
        if (this.rerunRequested) {
          const nextForce = this.pendingForce;
          this.rerunRequested = false;
          this.pendingForce = false;
          void this.refresh({ force: nextForce });
        }
      });
    this.inFlight = run;
    return run;
  }

  /**
   * ONE real next-track candidate for end-of-queue autoplay — the
   * playback layer's "the queue is exhausted" case (the controller calls
   * this; this service never touches audio, never publishes sections and
   * never writes any store — the returned track is appended through the
   * controller's own queue path, or nothing happens at all).
   *
   * Semantics:
   * - `excluded` (queue membership; the controller also passes the
   *   finished track's list) plus the current track itself can never be
   *   chosen, and metadata duplicates of the current track collapse out
   *   via the existing metadataKey;
   * - candidates come from the existing signal-derived query plan when
   *   Personalized Home is ON — memoised through the SAME candidate cache
   *   and in-flight map refresh() uses (no second cache, no duplicate
   *   requests) — plus one non-personalized metadata query on the current
   *   track as a universal fallback. When personalization is OFF only
   *   that metadata query runs and no personalized signal is read for
   *   planning or ranking;
   * - ranking reuses the existing deterministic rank() (stable sort keeps
   *   provider order on ties); with personalization OFF candidates keep
   *   plain provider order;
   * - immediate artist repetition is skipped whenever an alternative
   *   exists in the pool;
   * - queries run SEQUENTIALLY with an early stop at AUTOPLAY_POOL_TARGET
   *   (at most the existing per-refresh query bound plus the metadata
   *   fallback), so track end never triggers a request burst;
   * - any failure degrades to null: playback simply ends — no fake
   *   candidates, no retries, no thrown errors reaching playback.
   */
  async getAutoplayTrack(current: Track, excluded: readonly Track[]): Promise<Track | null> {
    // Decide personalization once, against the PERSISTED setting: planning
    // and ranking below both use this single read (§10 settings contract).
    await this.deps.settings.hydrate();
    const personalized = this.personalizedHomeEnabled;

    const queries: PlannedQuery[] = [];
    const seenQueries = new Set<string>();
    const pushQuery = (query: string, source: QuerySource): void => {
      const trimmed = query.trim();
      if (trimmed.length === 0) return;
      const key = trimmed.toLowerCase();
      if (seenQueries.has(key)) return;
      seenQueries.add(key);
      queries.push({ query: trimmed, source });
    };

    if (personalized) {
      await Promise.all([
        this.deps.history.hydrate(),
        this.deps.likedSongs.hydrate(),
        this.deps.searchHistory.hydrate(),
      ]);
      for (const planned of this.buildQueryPlan()) pushQuery(planned.query, planned.source);
    }
    // Universal, non-personalized source: the current track's own
    // metadata — a real provider query carrying no history/like/search
    // signal (and the ONLY source when personalization is OFF).
    pushQuery(`${current.title} ${current.artist}`, 'playback-context');
    if (queries.length === 0) return null; // degenerate current track

    const currentKey = trackIdentityKey(current);
    const excludedKeys = new Set<string>(excluded.map((track) => trackIdentityKey(track)));
    excludedKeys.add(currentKey);

    const pool: ScoredTrack[] = [];
    const seenMetadata = new Set<string>([metadataKey(current)]);
    for (const planned of queries) {
      if (pool.length >= AUTOPLAY_POOL_TARGET) break;
      const tracks = await this.getCandidateTracks(planned.query, false).catch(() => {
        // §12: a failed candidate search degrades to "no candidates".
        return [] as readonly Track[];
      });
      for (const track of tracks) {
        if (!isUsable(track)) continue; // invalid / placeholder metadata (§9)
        const key = trackIdentityKey(track);
        if (key === currentKey || excludedKeys.has(key)) continue;
        const meta = metadataKey(track);
        if (seenMetadata.has(meta)) continue;
        seenMetadata.add(meta);
        pool.push({ track, source: planned.source, score: 0 });
      }
    }
    if (pool.length === 0) return null;

    const ranked = personalized
      ? this.rank(pool, this.buildSignalContext()) // existing signal ranking
      : pool; // personalization OFF → provider order, no signal reads
    // Avoid immediate artist repetition when the pool offers an alternative.
    const currentArtist = artistKey(current.artist);
    const alternatives = ranked.filter((entry) => artistKey(entry.track.artist) !== currentArtist);
    const chosen = (alternatives.length > 0 ? alternatives : ranked)[0];
    if (!chosen) return null;
    return chosen.track;
  }

  /**
   * Collects ONE bounded batch of diverse automatic-queue candidates —
   * the "top the Up Next queue toward 30–40 tracks" path, called by
   * PlayerController AFTER playback has already started (never on the
   * critical path of starting a track). Same house rules as everything
   * here: only existing signals (current track, recent plays, likes,
   * user search intents), only the existing MusicService.search through
   * getCandidateTracks — TTL cache + in-flight dedup, so queries a Home
   * refresh or autoplay lookup already ran cost ZERO new requests —
   * SEQUENTIAL queries with an early stop, never a burst, never an
   * unbounded loop, never fabricated metadata.
   *
   * Exclusions follow the caller's contract: exact identity AND
   * recommendation-level song keys of the current track and every queue
   * member are dropped, so an alternate upload of anything already
   * queued can never be added back. Within the batch each song key
   * appears once; when two uploads share a key the one with FEWER
   * alternate-recording markers (live/slowed/remix/cover…) wins, so the
   * canonical song is preferred whenever metadata allows — no channel
   * allowlists.
   *
   * The surviving pool goes through selectAutoQueue (bounded
   * randomization + artist diversity). Returns fewer than `target` —
   * possibly nothing — when the provider runs out of valid unique
   * candidates; never rejects, never fabricates.
   */
  async getRecommendationBatch(
    current: Track,
    excluded: readonly Track[],
    target: number,
  ): Promise<readonly Track[]> {
    if (target <= 0) return [];
    await this.deps.settings.hydrate();
    const personalized = this.personalizedHomeEnabled;
    if (personalized) {
      await Promise.all([
        this.deps.history.hydrate(),
        this.deps.likedSongs.hydrate(),
        this.deps.searchHistory.hydrate(),
      ]);
    }

    const plan = this.buildBatchQueryPlan(current, personalized);
    if (plan.length === 0) return [];

    const currentIdentity = trackIdentityKey(current);
    const excludedIdentities = new Set<string>(excluded.map(trackIdentityKey));
    excludedIdentities.add(currentIdentity);
    const excludedMetadata = new Set<string>(excluded.map(metadataKey));
    excludedMetadata.add(metadataKey(current));

    // Enough unique candidates for diversity selection without
    // over-collecting: twice the requested batch, floor 24 (even a small
    // top-up gets real choice), ceiling AUTO_QUEUE_POOL_TARGET.
    const poolStop = Math.min(AUTO_QUEUE_POOL_TARGET, Math.max(target * 2, 24));
    const seenIdentities = new Set<string>([currentIdentity]);
    const bySongKey = new Map<string, Track>();
    for (const planned of plan) {
      if (bySongKey.size >= poolStop) break;
      const tracks = await this.getCandidateTracks(planned.query, false).catch(
        () => [] as readonly Track[], // §12: a failed search degrades to "no candidates"
      );
      for (const track of tracks) {
        if (bySongKey.size >= poolStop) break;
        if (!isUsable(track)) continue; // invalid / placeholder metadata (§9)
        const identity = trackIdentityKey(track);
        if (excludedIdentities.has(identity) || seenIdentities.has(identity)) continue;
        const songKey = metadataKey(track);
        if (excludedMetadata.has(songKey)) continue; // alternate upload of a queued song
        seenIdentities.add(identity);
        const held = bySongKey.get(songKey);
        if (held === undefined) {
          bySongKey.set(songKey, track);
        } else if (alternateVersionCount(track.title) < alternateVersionCount(held.title)) {
          bySongKey.set(songKey, track); // same song, cleaner upload wins
        }
      }
    }
    if (bySongKey.size === 0) return [];
    return selectAutoQueue([...bySongKey.values()], target);
  }

  /**
   * Batch query plan for the automatic Up Next fill: current-track
   * context FIRST (identical strings to Home's plan → cache hits), then
   * up to 3 DISTINCT recent-playback artists, up to 3 DISTINCT liked
   * artists, up to 2 recent search intents (only while Save search
   * history is on — the same §9/§10 gate getAutoplayTrack honors) and the
   * newest liked track. Deliberately NOT "<current artist> songs" ten
   * times: each artist is queried at most once, the current artist is
   * never re-queried as a signal, and the whole plan is hard-capped at
   * AUTO_QUEUE_MAX_QUERIES. Personalization OFF ⇒ context queries only —
   * no history/likes/search store is read (§10).
   */
  private buildBatchQueryPlan(
    current: Track,
    personalized: boolean,
  ): readonly PlannedQuery[] {
    const plan: PlannedQuery[] = [];
    const seenQueries = new Set<string>();
    const queriedArtists = new Set<string>();

    const pushQuery = (query: string, source: QuerySource): void => {
      if (plan.length >= AUTO_QUEUE_MAX_QUERIES) return;
      const trimmed = query.trim();
      if (trimmed.length === 0) return;
      const key = trimmed.toLowerCase();
      if (seenQueries.has(key)) return;
      seenQueries.add(key);
      plan.push({ query: trimmed, source });
    };
    const addArtistQuery = (artistName: string, source: QuerySource): boolean => {
      const key = artistKey(artistName);
      if (key.length === 0 || queriedArtists.has(key)) return false;
      queriedArtists.add(key);
      pushQuery(`${artistName.trim()} songs`, source);
      return true;
    };

    // 1. Current-track context (always; shares strings with Home's plan).
    const title = current.title.trim();
    const currentArtistName = current.artist.trim();
    if (title.length > 0 && currentArtistName.length > 0) {
      pushQuery(`${title} ${currentArtistName}`, 'related-song');
    }
    if (currentArtistName.length > 0) {
      addArtistQuery(currentArtistName, 'current-artist');
    }
    if (!personalized) return plan;

    // 2. Recent playback artists — up to 3 DISTINCT, never the current one.
    let recentAdded = 0;
    for (const track of this.deps.history.getSnapshot().slice(0, RECENT_SIGNAL_DEPTH)) {
      if (recentAdded >= 3) break;
      if (addArtistQuery(track.artist, 'recent-artist')) recentAdded += 1;
    }

    // 3. Liked artists — up to 3 DISTINCT, skipping anything already queried.
    let likedAdded = 0;
    for (const track of this.deps.likedSongs.getSnapshot()) {
      if (likedAdded >= 3) break;
      if (addArtistQuery(track.artist, 'liked-artist')) likedAdded += 1;
    }

    // 4. Newest distinct search intents (explicit user intent), gated on
    //    the Save search history preference (§9/§10).
    if (this.searchHistoryEnabled) {
      let intents = 0;
      const seenIntents = new Set<string>();
      for (const raw of this.deps.searchHistory.getSnapshot()) {
        if (intents >= 2) break;
        const intent = raw.trim();
        if (intent.length === 0) continue;
        const key = intent.toLowerCase();
        if (seenIntents.has(key)) continue;
        seenIntents.add(key);
        pushQuery(intent, 'search-intent');
        intents += 1;
      }
    }

    // 5. Newest liked track as a metadata query (existing signal shape).
    const newestLiked = this.deps.likedSongs.getSnapshot()[0];
    if (newestLiked) {
      pushQuery(`${newestLiked.title} ${newestLiked.artist}`, 'liked-track');
    }

    return plan;
  }

  private async executeRefresh(force: boolean): Promise<void> {
    const generation = ++this.refreshGeneration;
    // Settings FIRST: hydrating them syncs the mirrored flags through the
    // settings listener before we decide anything, so a persisted
    // personalization-OFF record (≠ default) can never cause a signal
    // store to be loaded on cold start (§10).
    await this.deps.settings.hydrate();
    if (generation !== this.refreshGeneration) return;
    // Personalized Home OFF: history, likes and search history are never
    // even loaded, let alone read (§10). Current-track context below is
    // non-personalized discovery and still runs. ON: hydrate all signal
    // stores (they hydrate once each).
    if (this.personalizedHomeEnabled) {
      await Promise.all([
        this.deps.history.hydrate(),
        this.deps.likedSongs.hydrate(),
        this.deps.searchHistory.hydrate(),
      ]);
      if (generation !== this.refreshGeneration) return;
    }

    const plan = this.buildQueryPlan({ includeCurrentContext: true });
    const results = await Promise.all(
      plan.map((planned) =>
        this.getCandidateTracks(planned.query, force).catch((error) => {
          console.warn(`[RECOMMENDATIONS] query failed: ${planned.query}`, error);
          return [] as readonly Track[];
        }),
      ),
    );
    // Generation guard: a response that lost the race is dropped (§10/§21).
    if (generation !== this.refreshGeneration) return;

    this.publish(this.buildSections(plan, results));
  }

  /**
   * Query plan, bounded by MAX_QUERIES_PER_REFRESH (§4/§19).
   *
   * Push order = pool ownership under the global metadata dedup: the
   * freshest context claims a shared intent first, so an identical query
   * never spawns a second request or a duplicate section (§14):
   *  1. "<title> <artist>"       → "Related To This Song" (current track)
   *  2. "<artist> songs"          → "More from <artist>"   (current track)
   *  3. recent artist             → "Because You Played <track>"
   *  4. liked artist              → "More from <artist>"
   *  5. newest two search queries → "From Your Recent Searches" — only
   *     when BOTH Personalized Home and Save search history are on
   *     (§9/§10: a disabled search-history preference is never consumed)
   *  6. newest liked track title+artist (feeds the ranked catch-all)
   *
   * Signals (3–6) are read only when personalizedHomeEnabled; with
   * personalization off the plan is current-context only, which uses no
   * history/likes/search data. `includeCurrentContext: false` (the
   * autoplay path, which appends its own playback-context query) keeps
   * that plan exactly as it was before current-track discovery existed.
   *
   * Empty plan (cold start, idle player + personalization off) ⇒ no
   * sections — never fabricated content (§6/§11).
   */
  private buildQueryPlan(
    options?: { readonly includeCurrentContext?: boolean },
  ): readonly PlannedQuery[] {
    const plan: PlannedQuery[] = [];
    const seen = new Set<string>();
    const push = (query: string, source: QuerySource, label?: string) => {
      const trimmed = query.trim();
      if (trimmed.length === 0 || plan.length >= MAX_QUERIES_PER_REFRESH) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      plan.push({ query: trimmed, source, label });
    };

    // ── Current-track discovery (§3/§5/§6): provider context only —
    // title and artist, nothing invented. Independent of personalization
    // (§10): it reads the player's own metadata, never a signal store.
    if (options?.includeCurrentContext === true) {
      const current = this.deps.player.getSnapshot().currentTrack;
      if (current) {
        const title = current.title.trim();
        const artist = current.artist.trim();
        if (title.length > 0 && artist.length > 0) {
          push(`${title} ${artist}`, 'related-song', 'Related To This Song');
        }
        if (artist.length > 0) {
          push(`${artist} songs`, 'current-artist', `More from ${artist}`);
        }
      }
    }

    if (!this.personalizedHomeEnabled) return plan;

    const history = this.deps.history.getSnapshot().slice(0, RECENT_SIGNAL_DEPTH);
    const liked = this.deps.likedSongs.getSnapshot();
    const queries = this.deps.searchHistory.getSnapshot();
    const searchHistoryEnabled = this.deps.settings.getSnapshot().searchHistoryEnabled;

    const recentTrack = history.find((track) => track.artist.trim().length > 0);
    if (recentTrack) {
      push(`${recentTrack.artist} songs`, 'recent-artist', `Because You Played ${recentTrack.title}`);
    }

    const recentArtistFold = recentTrack ? fold(recentTrack.artist) : '';
    const likedTrackByArtist = liked.find(
      (track) => track.artist.trim().length > 0 && fold(track.artist) !== recentArtistFold,
    );
    if (likedTrackByArtist) {
      push(`${likedTrackByArtist.artist} songs`, 'liked-artist', `More from ${likedTrackByArtist.artist}`);
    }

    // Newest distinct search intents (explicit user intent, §9). Gated on
    // the Save search history preference: discovery never consumes queries
    // the user asked the app not to keep using.
    if (searchHistoryEnabled) {
      const intentSeen = new Set<string>();
      for (const raw of queries) {
        const intent = raw.trim();
        if (intent.length === 0) continue;
        const key = intent.toLowerCase();
        if (intentSeen.has(key)) continue;
        intentSeen.add(key);
        push(intent, 'search-intent', 'From Your Recent Searches');
        if (intentSeen.size >= 2) break;
      }
    }

    const firstLiked = liked[0];
    if (firstLiked) {
      push(`${firstLiked.title} ${firstLiked.artist}`, 'liked-track');
    }

    return plan;
  }

  /**
   * Candidate fetch with the house caching pattern: TTL cache hit →
   * return; identical query in flight → join it; otherwise one search.
   * `force` (pull-to-refresh) bypasses the TTL; if that query is already
   * in flight the coalesced rerun refetches it right after (§12).
   */
  private getCandidateTracks(query: string, force: boolean): Promise<readonly Track[]> {
    const key = query.trim().toLowerCase();

    if (!force) {
      const hit = this.queryCache.get(key);
      if (hit && Date.now() - hit.at < QUERY_CACHE_TTL_MS) {
        return Promise.resolve(hit.tracks);
      }
    }

    const pending = this.inflightQueries.get(key);
    if (pending) return pending;

    const request = this.deps.search(query).then(
      (outcome) => {
        this.inflightQueries.delete(key);
        this.queryCache.set(key, { tracks: outcome.tracks, at: Date.now() });
        return outcome.tracks;
      },
      (error) => {
        this.inflightQueries.delete(key);
        throw error;
      },
    );
    this.inflightQueries.set(key, request);
    return request;
  }

  /**
   * Signal change (like / play / search): rebuild sections instantly
   * from cached candidates (immediate reactivity, no waiting on network)
   * and schedule a coalesced refresh so genuinely new signal contexts
   * get candidates. Never touches playback (§13).
   */
  private handleSignalsChanged = (): void => {
    // Personalized Home OFF: signal changes are irrelevant — current-track
    // discovery does not depend on them and must not react (§10).
    if (!this.personalizedHomeEnabled) return;
    this.rebuildLocal();
    void this.refresh();
  };

  /**
   * Either discovery-relevant preference flipped (§9/§10): rebuild
   * instantly from cache so retired sections drop out immediately
   * (signal sections when Personalized Home goes OFF — context sections
   * stay; the recent-searches section when Save search history goes OFF),
   * then refresh for whatever the new mode's plan needs. Unrelated
   * setting changes are ignored, so toggling anything else never
   * triggers recommendation or search requests.
   */
  private handleSettingsChanged = (): void => {
    const snapshot = this.deps.settings.getSnapshot();
    const personalizationChanged = snapshot.personalizedHomeEnabled !== this.personalizedHomeEnabled;
    const searchHistoryChanged = snapshot.searchHistoryEnabled !== this.searchHistoryEnabled;
    this.personalizedHomeEnabled = snapshot.personalizedHomeEnabled;
    this.searchHistoryEnabled = snapshot.searchHistoryEnabled;
    if (!personalizationChanged && !searchHistoryChanged) return;
    // A search-history-only flip matters only while signal sections are
    // built at all: with personalization OFF the plan never reads the
    // stored queries, so nothing observable changed (§9/§10).
    if (!personalizationChanged && !this.personalizedHomeEnabled) return;
    this.rebuildLocal();
    void this.refresh();
  };

  /**
   * Current-track change (identity only — position/pause/seek ticks are
   * filtered by the identity guard below, §20): exclusion + cached context
   * rebuild instantly, and the actual discovery fetch is COALESCED behind a
   * short debounce so a skipping session costs at most one bounded refresh
   * instead of a request burst. Requests are TTL-cached and in-flight
   * deduplicated; generation guards drop anything superseded (§19/§21).
   */
  private handlePlayerChanged = (): void => {
    const current = this.deps.player.getSnapshot().currentTrack;
    const key = current ? trackIdentityKey(current) : null;
    if (key === this.lastCurrentTrackKey) return;
    this.lastCurrentTrackKey = key;
    this.rebuildLocal();
    if (this.currentTrackRefreshTimer !== null) {
      clearTimeout(this.currentTrackRefreshTimer);
    }
    this.currentTrackRefreshTimer = setTimeout(() => {
      this.currentTrackRefreshTimer = null;
      void this.refresh();
    }, 1_500);
  };

  /**
   * Re-derives sections from the query cache alone — zero network.
   * Runs in BOTH modes: personalization off yields only current-track
   * context sections (signal stores untouched, §10).
   */
  private rebuildLocal(): void {
    const plan = this.buildQueryPlan({ includeCurrentContext: true });
    const results = plan.map(
      (planned) => this.queryCache.get(planned.query.trim().toLowerCase())?.tracks ?? [],
    );
    this.publish(this.buildSections(plan, results));
  }

  // ── Filtering / deduplication / ranking / section assembly ───────────

  private buildSections(
    plan: readonly PlannedQuery[],
    results: readonly (readonly Track[])[],
  ): readonly RecommendationSection[] {
    if (plan.length === 0) return [];

    const personalized = this.personalizedHomeEnabled;
    const current = this.deps.player.getSnapshot().currentTrack;
    const currentIdentity = current ? trackIdentityKey(current) : null;
    const currentMetadata = current ? metadataKey(current) : null;
    const currentArtistFold = current ? fold(current.artist) : '';

    // Global, plan-ordered metadata dedup (§8/§14): each source claims a
    // track once; later sources never see it again this refresh. Sources
    // fed by several queries ACCUMULATE their pool (never overwrite).
    const seen = new Set<string>();
    const pools = new Map<QuerySource, Track[]>();
    plan.forEach((planned, index) => {
      const pool: Track[] = [];
      for (const track of results[index] ?? []) {
        if (!isUsable(track)) continue; // invalid / placeholder metadata (§9)
        if (currentIdentity && trackIdentityKey(track) === currentIdentity) continue;
        const meta = metadataKey(track);
        if (meta === currentMetadata) continue; // never resurface what's playing
        if (seen.has(meta)) continue;
        seen.add(meta);
        pool.push(track);
      }
      if (pool.length > 0) {
        const existing = pools.get(planned.source);
        pools.set(planned.source, existing ? [...existing, ...pool] : pool);
      }
    });

    const sections: RecommendationSection[] = [];
    const leftovers: ScoredTrack[] = [];
    const claim = (
      source: QuerySource,
      id: RecommendationSectionId,
      limit: number,
      sourceKey?: string,
    ): RecommendationSection | null => {
      const planned = plan.find((entry) => entry.source === source);
      if (!planned?.label) return null;
      const { taken, rest } = takeDiverse(pools.get(source) ?? [], limit);
      leftovers.push(...rest.map((track) => ({ track, source, score: 0 })));
      if (taken.length === 0) return null; // never show an empty section (§5)
      return { id, title: planned.label, tracks: taken, sourceKey };
    };

    // Specific → generic ordering: freshest context first, ranked
    // catch-all last (just above the existing Quick picks).

    // ── Current-track discovery (§3): rendered in BOTH personalization
    // modes — it is player context, not a personalized signal (§10).
    const related = claim(
      'related-song',
      'related-to-this-song',
      ARTIST_SECTION_SIZE,
      currentIdentity ?? undefined,
    );
    if (related) sections.push(related);
    const currentArtistSection = claim(
      'current-artist',
      'current-artist',
      ARTIST_SECTION_SIZE,
      currentArtistFold || undefined,
    );
    if (currentArtistSection) sections.push(currentArtistSection);

    if (personalized) {
      // Signal-backed sections, freshest → broadest (existing titles and
      // sizes unchanged — this extends, never replaces, that behavior).
      const because = claim('recent-artist', 'because-you-played', BECAUSE_SECTION_SIZE);
      if (because) sections.push(because);
      const moreFrom = claim('liked-artist', 'more-from-artist', ARTIST_SECTION_SIZE);
      if (moreFrom) sections.push(moreFrom);
      const recentSearches = claim(
        'search-intent',
        'recent-searches',
        ARTIST_SECTION_SIZE,
        'search-history',
      );
      if (recentSearches) sections.push(recentSearches);

      // Signal context is built ONLY inside this branch: with
      // personalization off the history/likes stores are never read (§10).
      const ctx = this.buildSignalContext();

      // ── "Discover Something New": unclaimed leftovers from the SIGNAL
      // queries that match NO personal signal (score 0) and are not the
      // current artist — provider-relevant material Aero's signals know
      // nothing about, in stable plan/provider order. Everything already
      // shown is excluded by construction (§14), and the carve-out runs
      // before the ranked catch-all below, which keeps every
      // signal-matched candidate.
      const discoverCandidates = leftovers.filter(
        (entry) =>
          (entry.source === 'recent-artist' || entry.source === 'liked-artist') &&
          this.score(entry, ctx) === 0 &&
          fold(entry.track.artist) !== currentArtistFold,
      );
      const { taken: discover } = takeDiverse(
        discoverCandidates.map((entry) => entry.track),
        DISCOVER_SECTION_SIZE,
      );
      if (discover.length > 0) {
        sections.push({
          id: 'discover-new',
          title: 'Discover Something New',
          tracks: discover,
          sourceKey: 'no-personal-signal',
        });
      }
      const discoveredMetadata = new Set(discover.map(metadataKey));

      // ── Ranked catch-all (existing "Made for You"): every unclaimed
      // candidate not shown as discovery, plus the newest-liked-track
      // pool, through the existing deterministic rank (§17).
      const madeForYouPool = [
        ...leftovers.filter((entry) => !discoveredMetadata.has(metadataKey(entry.track))),
        ...(pools.get('liked-track') ?? []).map((track) => ({
          track,
          source: 'liked-track' as const,
          score: 0,
        })),
      ];
      const ranked = this.rank(madeForYouPool, ctx);
      const { taken: madeForYou } = takeDiverse(
        ranked.map((entry) => entry.track),
        MADE_FOR_YOU_SIZE,
      );
      if (madeForYou.length > 0) {
        sections.push({ id: 'made-for-you', title: 'Made for You', tracks: madeForYou });
      }
    }

    return sections;
  }

  private buildSignalContext(): SignalContext {
    const history = this.deps.history.getSnapshot().slice(0, RECENT_SIGNAL_DEPTH);
    const liked = this.deps.likedSongs.getSnapshot();

    const likedArtists = new Set<string>();
    for (const track of liked) {
      const artist = fold(track.artist);
      if (artist) likedArtists.add(artist);
    }
    const topRecentArtists = new Set<string>();
    for (const track of history.slice(0, TOP_RECENT_DEPTH)) {
      const artist = fold(track.artist);
      if (artist) topRecentArtists.add(artist);
    }
    const recentArtists = new Set<string>();
    const recentAlbums = new Set<string>();
    for (const track of history.slice(TOP_RECENT_DEPTH)) {
      const artist = fold(track.artist);
      if (artist) recentArtists.add(artist);
      const album = track.album ? fold(track.album) : '';
      if (album) recentAlbums.add(album);
    }
    for (const track of history.slice(0, TOP_RECENT_DEPTH)) {
      const album = track.album ? fold(track.album) : '';
      if (album) recentAlbums.add(album);
    }
    return { likedArtists, topRecentArtists, recentArtists, recentAlbums };
  }

  /**
   * Deterministic local ranking (§7) — every weight means something:
   * - +8  liked artist: the artist is in the liked collection
   * - +5  artist among the 5 most recent plays (strong recency)
   * - +3  artist in plays 6–10 (weaker recency)
   * - +3  album matches a recently played album (album affinity)
   * - +2  candidate came from the user's own search query (explicit intent)
   * - +1  candidate came from the newest liked track (title+artist intent)
   * Sort is stable, so equal scores keep provider order — same inputs,
   * same output. Scores are internal; nothing user-facing is produced.
   */
  private rank(pool: readonly ScoredTrack[], ctx: SignalContext): readonly ScoredTrack[] {
    const scored = pool.map((entry) => ({ ...entry, score: this.score(entry, ctx) }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  private score(entry: ScoredTrack, ctx: SignalContext): number {
    const artist = fold(entry.track.artist);
    let score = 0;
    if (ctx.likedArtists.has(artist)) score += 8;
    if (ctx.topRecentArtists.has(artist)) score += 5;
    else if (ctx.recentArtists.has(artist)) score += 3;
    if (entry.track.album && ctx.recentAlbums.has(fold(entry.track.album))) score += 3;
    if (entry.source === 'search-intent') score += 2;
    else if (entry.source === 'liked-track') score += 1;
    return score;
  }

  /** Publishes only on real change (same sections ⇒ same reference ⇒ no re-render). */
  private publish(next: readonly RecommendationSection[]): void {
    if (this.sectionsEqual(this.sections, next)) return;
    this.sections = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private sectionsEqual(
    a: readonly RecommendationSection[],
    b: readonly RecommendationSection[],
  ): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].id !== b[i].id || a[i].title !== b[i].title) return false;
      if (a[i].tracks.length !== b[i].tracks.length) return false;
      for (let t = 0; t < a[i].tracks.length; t += 1) {
        if (trackIdentityKey(a[i].tracks[t]) !== trackIdentityKey(b[i].tracks[t])) return false;
      }
    }
    return true;
  }
}
