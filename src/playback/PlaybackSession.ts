import type { KeyValueStore } from '../core/storage/types';
import type { Track } from '../core/types/track';
import { isTrack, trackIdentityKey } from '../core/types/track';
import type { PlayerController } from './PlayerController';
import type { PlaybackStatus, RepeatMode } from './types';

export const PLAYBACK_SESSION_STORAGE_KEY = 'aero.playback_session';
/** Schema version — an incompatible record is discarded, never guessed at. */
export const PLAYBACK_SESSION_VERSION = 1;

/**
 * The smallest durable form of a playback session — everything the
 * controller needs to reconstruct a paused session, and nothing else.
 *
 * `tracks` is the SOURCE queue (play-context order): with shuffle off it
 * doubles as the effective order (the controller mirrors mutations into
 * both), and with shuffle on the effective order is rebuilt by the
 * controller's OWN shuffle mechanism at restore time — so only one track
 * array is ever persisted.
 *
 * Deliberately NEVER persisted: resolved stream URLs (signed and expiring),
 * native handles, transient loading/error state, notification state, or
 * artwork bytes.
 */
export interface PlaybackSessionState {
  readonly tracks: readonly Track[];
  /** Effective queue index at save time (== source index when shuffle is off). */
  readonly queueIndex: number;
  /** trackIdentityKey of the current track — used to re-anchor after validation. */
  readonly currentTrackKey: string | null;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
  readonly positionMs: number | null;
  readonly durationMs: number | null;
}

/** Persisted envelope: the state plus schema metadata. */
interface PersistedSession extends PlaybackSessionState {
  readonly version: number;
  readonly updatedAt: number;
}

export interface PlaybackSessionDependencies {
  readonly store: KeyValueStore;
  /**
   * Filters out local (MediaStore) tracks that no longer exist on the
   * device. Must NEVER prompt for permission and must return the input
   * unchanged when existence is unknown — an unknown is not a deletion.
   * Wired in the composition root (the only place native boundaries meet).
   */
  readonly dropMissingLocalTracks?: (
    tracks: readonly Track[],
  ) => Promise<readonly Track[]>;
}

/** How often a playing position is written to disk (bounded progress). */
const POSITION_SAVE_INTERVAL_MS = 15_000;
/** A paused-position move this large is a deliberate seek → persist it. */
const PAUSED_SEEK_SAVE_THRESHOLD_MS = 5_000;

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), Math.max(length - 1, 0));
}

function validCount(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Structural check for a persisted session envelope. Anything malformed,
 * wrongly typed or from another schema version is rejected here — the
 * caller then discards ONLY this record.
 */
function isPersistedSession(value: unknown): value is PersistedSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PersistedSession>;
  return (
    candidate.version === PLAYBACK_SESSION_VERSION &&
    Array.isArray(candidate.tracks) &&
    typeof candidate.queueIndex === 'number' &&
    typeof candidate.shuffleEnabled === 'boolean' &&
    (candidate.repeatMode === 'off' ||
      candidate.repeatMode === 'queue' ||
      candidate.repeatMode === 'one') &&
    (candidate.currentTrackKey === null ||
      typeof candidate.currentTrackKey === 'string') &&
    (candidate.positionMs === null || typeof candidate.positionMs === 'number') &&
    (candidate.durationMs === null || typeof candidate.durationMs === 'number')
  );
}

/**
 * PlaybackSession: the ONE durable record of "where the player was".
 *
 * Follows the same framework-free store conventions as the other persistent
 * features (subscribe/getSnapshot consumers elsewhere; hydrate-once promise;
 * graceful storage failure), but owns no playback state itself — the
 * PlayerController remains the only queue and the only playback authority.
 *
 * Hydration is local and fast: KeyValueStore read → structural validation →
 * per-entry Track validation → optional local-file existence pass → index
 * repair. No network, no stream resolution, no NewPipe, no history writes.
 */
export class PlaybackSession {
  private readonly store: KeyValueStore;
  private readonly dropMissingLocalTracks?: PlaybackSessionDependencies['dropMissingLocalTracks'];
  private readyPromise: Promise<PlaybackSessionState | null> | null = null;

  constructor(deps: PlaybackSessionDependencies) {
    this.store = deps.store;
    this.dropMissingLocalTracks = deps.dropMissingLocalTracks;
  }

  /**
   * Loads, validates and repairs the persisted session once (shared
   * promise). Returns the restore-ready state, or null when there is
   * nothing safe to restore. A corrupt/incompatible record is discarded
   * (best-effort) so the next launch starts clean; every other store is
   * untouched.
   */
  hydrate(): Promise<PlaybackSessionState | null> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /** Persists the current session state (or clears it for null). */
  async save(state: PlaybackSessionState | null): Promise<void> {
    if (state === null || state.tracks.length === 0) {
      await this.clear();
      return;
    }
    const record: PersistedSession = {
      version: PLAYBACK_SESSION_VERSION,
      updatedAt: Date.now(),
      tracks: [...state.tracks],
      queueIndex: state.queueIndex,
      currentTrackKey: state.currentTrackKey,
      shuffleEnabled: state.shuffleEnabled,
      repeatMode: state.repeatMode,
      positionMs: state.positionMs,
      durationMs: state.durationMs,
    };
    try {
      await this.store.setItem(PLAYBACK_SESSION_STORAGE_KEY, JSON.stringify(record));
    } catch (error) {
      console.warn('[PLAYBACK_SESSION] could not persist session.', error);
    }
  }

  /** Removes the persisted session. Idempotent; never touches other keys. */
  async clear(): Promise<void> {
    try {
      await this.store.removeItem(PLAYBACK_SESSION_STORAGE_KEY);
    } catch (error) {
      console.warn('[PLAYBACK_SESSION] could not clear session.', error);
    }
  }

  private async load(): Promise<PlaybackSessionState | null> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(PLAYBACK_SESSION_STORAGE_KEY);
    } catch (error) {
      console.warn('[PLAYBACK_SESSION] storage unavailable; starting without a session.', error);
      return null;
    }
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[PLAYBACK_SESSION] malformed session discarded.');
      await this.clear();
      return null;
    }
    if (!isPersistedSession(parsed)) {
      console.warn('[PLAYBACK_SESSION] incompatible/invalid session discarded.');
      await this.clear();
      return null;
    }

    // Per-entry structural validation: a malformed track is dropped, never
    // trusted. This is data-level filtering only — no playback, no network.
    let tracks = parsed.tracks.filter(isTrack);
    if (tracks.length === 0) {
      await this.clear();
      return null;
    }

    // Local files may have vanished while the app was gone. Unknown
    // (no permission / query failure) keeps the input — only a CONFIRMED
    // miss drops a track. Downloaded online tracks are not consulted here:
    // the Downloads store reconciles its own files, and the resolver
    // falls through normally when a file is gone.
    if (this.dropMissingLocalTracks) {
      try {
        tracks = [...(await this.dropMissingLocalTracks(tracks))];
      } catch (error) {
        console.warn('[PLAYBACK_SESSION] local validation skipped.', error);
      }
    }
    if (tracks.length === 0) {
      await this.clear();
      return null;
    }

    // Re-anchor the current track after entries were dropped, then clamp
    // every index/position into valid range.
    let currentIndex = -1;
    if (parsed.currentTrackKey !== null) {
      currentIndex = tracks.findIndex((track) => trackIdentityKey(track) === parsed.currentTrackKey);
    }
    if (currentIndex < 0) currentIndex = clampIndex(parsed.queueIndex, tracks.length);
    const current = tracks[currentIndex];

    const durationMs = validCount(parsed.durationMs);
    let positionMs =
      parsed.positionMs !== null && Number.isFinite(parsed.positionMs) && parsed.positionMs > 0
        ? parsed.positionMs
        : null;
    if (positionMs !== null && durationMs !== null) {
      positionMs = Math.min(positionMs, durationMs);
    }

    const state: PlaybackSessionState = {
      tracks,
      queueIndex: currentIndex,
      currentTrackKey: trackIdentityKey(current),
      shuffleEnabled: parsed.shuffleEnabled,
      repeatMode: parsed.repeatMode,
      positionMs,
      durationMs,
    };
    return state;
  }
}

/**
 * Bridges PlayerController snapshots to durable session writes with
 * BOUNDED frequency — never a write per position tick:
 *
 *  - structural change (track, queue ref, index, shuffle, repeat) → write;
 *  - status edge to playing/paused → write (captures pause moments);
 *  - paused seek ≥ 5s → write (deliberate seeks survive a quick exit);
 *  - while playing → at most one write per POSITION_SAVE_INTERVAL.
 *
 * An idle/stop snapshot (no current track) clears the record once — an
 * explicit PlayerController.stop() is what discards a session. Nothing in
 * the app lifecycle (swipe-away, backgrounding) reaches this code.
 */
export function startPlaybackSessionPersistence(
  controller: PlayerController,
  session: PlaybackSession,
): () => void {
  let active = false;
  let prevQueue: readonly Track[] | null = null;
  let prevCurrentKey: string | null = null;
  let prevQueueIndex = -1;
  let prevShuffle = false;
  let prevRepeat: RepeatMode = 'off';
  let prevStatus: PlaybackStatus | null = null;
  let savedPosition: number | null = null;
  let lastPositionSaveAt = 0;

  const persist = () => {
    const state = controller.getSessionState();
    if (state === null) return;
    active = true;
    savedPosition = state.positionMs;
    lastPositionSaveAt = Date.now();
    void session.save(state);
  };

  return controller.subscribe(() => {
    const snapshot = controller.getSnapshot();

    if (snapshot.currentTrack === null) {
      // Explicit stop / idle: the durable session goes with it (once).
      if (active) {
        active = false;
        void session.clear();
      }
      prevQueue = null;
      prevCurrentKey = null;
      prevQueueIndex = -1;
      prevStatus = null;
      savedPosition = null;
      return;
    }

    const currentKey = trackIdentityKey(snapshot.currentTrack);
    const structuralChanged =
      snapshot.queue !== prevQueue ||
      currentKey !== prevCurrentKey ||
      snapshot.queueIndex !== prevQueueIndex ||
      snapshot.shuffleEnabled !== prevShuffle ||
      snapshot.repeatMode !== prevRepeat;

    if (structuralChanged) {
      prevQueue = snapshot.queue;
      prevCurrentKey = currentKey;
      prevQueueIndex = snapshot.queueIndex;
      prevShuffle = snapshot.shuffleEnabled;
      prevRepeat = snapshot.repeatMode;
      prevStatus = snapshot.status;
      persist();
      return;
    }

    if (snapshot.status !== prevStatus) {
      prevStatus = snapshot.status;
      if (snapshot.status === 'playing' || snapshot.status === 'paused') {
        persist();
        return;
      }
      // Loading/error edges carry nothing durable — fall through.
    }

    const position = snapshot.positionMs;
    if (position === null) return;

    if (snapshot.status === 'paused') {
      if (
        savedPosition === null ||
        Math.abs(position - savedPosition) >= PAUSED_SEEK_SAVE_THRESHOLD_MS
      ) {
        persist();
      }
      return;
    }

    if (snapshot.status === 'playing' && Date.now() - lastPositionSaveAt >= POSITION_SAVE_INTERVAL_MS) {
      persist();
    }
  });
}
