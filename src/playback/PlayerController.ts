import type { Track } from '../core/types/track';
import { isTrack, trackIdentityKey, trackOrigin } from '../core/types/track';
import type { StreamMetadata } from '../providers/stream/types';
import type { PlaybackSessionState } from './PlaybackSession';
import type {
  PlaybackEngine,
  PlaybackRequest,
  PlaybackState,
  PlaybackStatus,
  RepeatMode,
} from './types';

/**
 * Narrow orchestration contract the controller needs. Structurally
 * satisfied by MusicService — the controller must not know how stream
 * resolution works, only that these two operations exist.
 */
interface PlaybackOrchestrator {
  playTrack(track: Track, request?: PlaybackRequest): Promise<void>;
  stopPlayback(): Promise<void>;
}

/**
 * Rolling prefetch seam (NØTE PreloadManager parity). The controller
 * never knows what resolution means — only that these three lifecycle
 * hooks exist. Optional so the controller works without prefetching.
 */
export interface PrefetchController {
  /** Warm the given track (or drop the warm target when null). */
  schedule(track: Track | null): void;
  /** The given track is becoming current: reuse its in-flight warm, if any. */
  adopt(trackId: string | null): void;
}

/**
 * One successful removal, as returned by removeFromQueue — everything needed
 * to put the track back EXACTLY where it was (the Up Next Undo path).
 * `queueIndex` is the absolute index in the EFFECTIVE order at removal time;
 * `sourceIndex` is its position in the source order at the same moment
 * (-1 when no identity match was found, e.g. shuffle-on membership drift).
 * With shuffle ON the two indices differ and the source position cannot be
 * derived after the fact — hence it is recorded here, inside the controller.
 */
export interface QueueRemoval {
  readonly track: Track;
  readonly queueIndex: number;
  readonly sourceIndex: number;
}

/**
 * Automatic Up Next fill policy: when the UPCOMING (not-yet-played) count
 * drops below the healthy floor, the controller asks the existing
 * recommendation seam for ONE bounded batch topping the queue up toward
 * the target (prefer 40; the 30–40 band is healthy, so a queue already
 * there generates zero requests). Both numbers describe UPCOMING tracks
 * only — current track, manual entries, repeat/shuffle and every queue
 * API's semantics are untouched.
 */
const AUTO_QUEUE_TARGET = 40;
const AUTO_QUEUE_REFILL_BELOW = 30;

/**
 * Narrow end-of-queue continuation contract the controller needs.
 * Structurally satisfied by RecommendationService — the controller asks
 * for ONE real Track and never knows how ranking, providers or
 * personalization work. Optional, like prefetch: without it the
 * controller behaves exactly as it always did (queue simply ends).
 */
export interface AutoplaySource {
  /**
   * One real next-track candidate for the track that just finished,
   * excluding everything in `excluded` (queue membership + the finished
   * track). Resolves null when no valid candidate exists. Must never
   * start playback itself — the controller owns all playback.
   */
  getAutoplayTrack(current: Track, excluded: readonly Track[]): Promise<Track | null>;
  /**
   * Optional: ONE bounded batch of diverse automatic-queue candidates for
   * topping the UPCOMING queue toward its target (async top-up; the
   * controller calls it only AFTER playback has started, never before).
   * Same exclusion contract as getAutoplayTrack — exact identity plus
   * recommendation-level song keys of the current track and every queue
   * member. Never starts playback, never publishes anything itself; the
   * controller appends the returned tracks through its own queue path.
   */
  getRecommendationBatch?(
    current: Track,
    excluded: readonly Track[],
    target: number,
  ): Promise<readonly Track[]>;
}

/**
 * Natural-completion gate (sleep timer: "end of current track").
 * Structurally satisfied by the SleepTimer store. Invoked when the current
 * track has NATURALLY completed, BEFORE repeat-one / repeat-queue / queue
 * next / autoplay may continue anything.
 */
export interface CompletionGate {
  /**
   * Returns true when the completion is CONSUMED: playback must stay ended,
   * with queue, repeat and shuffle untouched and no continuation started.
   * Returns false → the normal completion branches run unchanged (a duration
   * timer, no timer, or a different attached track must never suppress
   * ordinary continuation).
   */
  consumeNaturalCompletion(track: Track): boolean;
}

export interface PlayerControllerDependencies {
  readonly orchestrator: PlaybackOrchestrator;
  readonly engine: PlaybackEngine;
  readonly prefetch?: PrefetchController;
  readonly autoplay?: AutoplaySource;
  /** Optional sleep-timer seam: first look at every natural completion. */
  readonly completionGate?: CompletionGate;
  /**
   * Invoked once a track has genuinely started: the stream resolved, and
   * both engine.load and engine.play succeeded. Never invoked on failure.
   * Lets features (playback history) observe real playback starts without
   * the playback layer depending on any feature.
   */
  readonly onTrackStarted?: (track: Track) => void;
}

/**
 * Application-level player snapshot, exposed to React. Reuses the
 * existing PlaybackStatus values — playback status is defined once,
 * in playback/types.ts, and never duplicated.
 */
export interface PlayerSnapshot {
  /**
   * The CURRENT TRACK: what the user selected — global app state, survives
   * navigation. This is the UI's source of truth for title/artist/artwork,
   * deliberately NOT the engine's loaded track (see
   * PlaybackState.engineTrackId).
   *
   * Updated SYNCHRONOUSLY when a track is chosen, before its stream is
   * resolved, so Mini Player and Now Playing switch to it on the same frame as
   * the tap. `status` is 'loading' until the engine actually holds that track.
   */
  readonly currentTrack: Track | null;
  /** Metadata for the stream the engine has loaded for `currentTrack`; null while unresolved or after failure. */
  readonly activeStream: StreamMetadata | null;
  readonly status: PlaybackStatus;
  readonly positionMs: number | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
  /** True when a next queue item exists (enables Next controls). */
  readonly hasNext: boolean;
  /** True when a previous queue item exists (enables Previous controls). */
  readonly hasPrevious: boolean;
  /** Read-only view of the playback queue, in playback order. */
  readonly queue: readonly Track[];
  /** Index of the playing track within `queue`; -1 when no queue is active. */
  readonly queueIndex: number;
  /** Whether shuffled playback order is active. */
  readonly shuffleEnabled: boolean;
  /** Current repeat behavior. */
  readonly repeatMode: RepeatMode;
  /**
   * The audible player volume the engine is applying (0–1). Mirrors
   * PlaybackState.volume — runtime engine state, never selection or queue
   * state. 1.0 = full scale; Aero applies no gain above it. Written only
   * through PlayerController.setVolume.
   */
  readonly volume: number;
}

/**
 * Framework-free global player controller above the PlaybackEngine.
 *
 * - Holds the current Track (the engine only knows track IDs).
 * - Subscribes ONCE to the engine and republishes merged snapshots.
 * - Designed for React's useSyncExternalStore (subscribe/getSnapshot).
 * - Creates no player of its own; exactly one engine instance exists.
 * - Provider-agnostic: local and (future) online tracks take the same
 *   path via the orchestrator.
 */
export class PlayerController {
  private readonly deps: PlayerControllerDependencies;
  private engineState: PlaybackState;
  private currentTrack: Track | null = null;
  /** Ordered queue of tracks; currentIndex points at the playing track. */
  private queue: Track[] = [];
  private queueIndex = -1;
  /** Source order as supplied by the playback context (never mutated). */
  private sourceQueue: Track[] = [];
  /** Stable shuffled playback order; null when shuffle is off. */
  private shuffledOrder: Track[] | null = null;
  private shuffleEnabled = false;
  private repeatMode: RepeatMode = 'off';
  private snapshot: PlayerSnapshot;
  private readonly listeners = new Set<() => void>();
  private isTransitioningTrack = false;
  /**
   * Monotonic id of the user's current track selection. Bumped every time the
   * selection changes (tap, next, previous, Up Next, stop), and carried through
   * the whole asynchronous play request: a resolve that finishes after a newer
   * selection has been made is stale, and may neither publish state nor start
   * audio (see playTrack()).
   */
  private selectionGeneration = 0;
  /**
   * Track id the engine has not confirmed yet.
   *
   * The engine keeps reporting the PREVIOUS stream's status until the new
   * stream is loaded, and its `trackId` only becomes the new one when load() is
   * reached. While this holds the new selection's id, engine status/position/
   * duration belong to another track and are not published for the selection.
   */
  private awaitingEngineTrackId: string | null = null;
  /**
   * Failure of the current selection's resolve/play, sticky until the next
   * selection (or the engine genuinely playing this same track again). Without
   * it, one late status update from the previous stream would wipe an error off
   * the UI.
   */
  private selectionError: string | null = null;
  /**
   * Set ONLY by restoreSession(): the selection is real, the engine is
   * deliberately untouched, and this position/duration is what the UI
   * shows until the user presses Play (which resolves the track through
   * the normal path and applies the position between load and play).
   * Cleared by any new selection or an explicit stop.
   */
  private restoredSession: { positionMs: number | null; durationMs: number | null } | null = null;
  /**
   * True while one end-of-queue autoplay candidate is being resolved.
   * Engine status updates can repeat `didJustFinish` for the same track;
   * the flag makes continuation single-flight so duplicate completion
   * callbacks can never append (or start) more than one candidate.
   */
  private autoplayPending = false;
  /**
   * Single-flight guard for the automatic Up Next top-up: one batch at a
   * time, re-checked against live state after every completion, so a
   * healthy queue never generates requests and an empty/failed batch
   * never retries on its own (bounded by construction, no loops).
   */
  private queueFillPending = false;
  /**
   * Bumped by clearUpcomingQueue: a batch captured before an explicit
   * Clear is discarded — the user just asked for an empty Up Next, so a
   * pending automatic fill must not refill it behind their back.
   */
  private queueClearEpoch = 0;
  /**
   * Sleep-timer (end-of-track) completion latch: the id of the track whose
   * natural completion was already consumed by the gate. The engine can
   * repeat `didJustFinish` for the same ended track; without this latch a
   * duplicate event would restart normal continuation AFTER the timer has
   * already decided playback stays stopped. Cleared by the next selection,
   * explicit stop, session restore or direct play/pause interaction.
   */
  private consumedCompletionTrackId: string | null = null;
  private readonly unsubscribeEngine: () => void;
  /**
   * TRUE while the Now Playing seekbar owns the drag (scrub) gesture.
   * While set, POSITION-ONLY snapshot updates (engine status landings,
   * progress ticks, playback advancing under the finger) are adopted
   * silently — no listener
   * is notified — because the seekbar renders the finger's position from
   * its own scrub state. Without this, every position change re-rendered
   * the whole screen (measured ~90 ms each, 4–6×/s during a drag), which
   * collapsed the drag frame rate. endScrub() forces exactly one
   * catch-up notification; all non-position changes (track, status,
   * queue, volume) still notify normally.
   */
  private scrubbing = false;
  /**
   * TRUE while the volume slider owns its drag gesture — the exact mirror
   * of `scrubbing` for volume. While set, snapshot updates that differ
   * only by volume and/or playback position (the immediate engine writes
   * fed by each finger move, plus the ~500 ms position ticks while
   * playing) are adopted silently — no listener is notified — because the
   * slider renders the finger's position from its own local state. The
   * audio level itself is written to the engine on EVERY move
   * (engine.setVolume is never delayed or throttled — only React
   * subscribers are held back). endVolumeScrub() forces exactly one
   * catch-up notification; all other changes (track, status, queue,
   * duration, repeat…) still notify normally.
   */
  private volumeScrubbing = false;
  /**
   * Last manual-seek target, held until the engine reports a position
   * consistent with it. republish() rebuilds the snapshot from engine
   * state, which still carries the PRE-SEEK position until the native
   * seek lands — without this anchor that stale position would be
   * published right back (the post-release snap-back race). Cleared when
   * the engine catches up, after a TTL safety valve, and on any new
   * selection/stop.
   */
  private seekAnchorMs: number | null = null;
  private seekAnchorAt = 0;
  /**
   * Manual end-park latch: the id of the track the user parked AT THE EXACT
   * END via a manual seek (seekbar scrub, tap, lock-screen seekTo). ExoPlayer
   * reports STATE_ENDED for both a natural finish and a seek-to-end, so the
   * didJustFinish event provoked by the park — and the DUPLICATE finish
   * events the engine keeps repeating while it stays ended — must never fire
   * auto-next/repeat/autoplay. The latch survives the user pressing Play
   * (stale ended-era events are still in flight when Play is processed) and
   * is lifted ONLY by proof the engine restarted the parked track, or by a
   * new selection / stop / a later seek away from the end.
   */
  private endParkedTrackId: string | null = null;
  /**
   * True once a didJustFinish for the parked track was OBSERVED (and
   * swallowed). Until then, a 'playing' report for the parked track may be
   * a STALE pre-seek status event delivered between the seek and the ENDED
   * event — lifting the park on it would let the ENDED event fall through
   * to auto-next. Only a confirmed end guarantees a later 'playing' report
   * is the user's replay, not a stale echo.
   */
  private endParkConfirmed = false;
  private disposed = false;

  constructor(deps: PlayerControllerDependencies) {
    this.deps = deps;
    this.engineState = {
      status: 'idle',
      engineTrackId: null,
      positionMs: null,
      durationMs: null,
      errorMessage: null,
      activeStream: null,
    };
    this.snapshot = {
      currentTrack: null,
      activeStream: null,
      status: 'idle',
      positionMs: null,
      durationMs: null,
      errorMessage: null,
      hasNext: false,
      hasPrevious: false,
      queue: [],
      queueIndex: -1,
      shuffleEnabled: false,
      repeatMode: 'off',
      volume: 1,
    };
    this.unsubscribeEngine = deps.engine.onStateChange((state) => {
      this.engineState = state;
      this.syncSelectionWithEngine(state);
      this.republish();

      // Lift the manual end-park only on PROOF the engine restarted the
      // parked track (see endParkConfirmed): the user pressed Play after
      // scrubbing to 100% and the engine is playing it again. A 'playing'
      // report before the parked end was confirmed may be a stale pre-seek
      // status event and must not lift the park.
      if (
        this.endParkedTrackId !== null &&
        this.endParkConfirmed &&
        state.engineTrackId === this.endParkedTrackId &&
        state.status === 'playing'
      ) {
        this.endParkedTrackId = null;
        this.endParkConfirmed = false;
      }

      // Auto-advance ONLY on genuine natural completion of the active track,
      // NOT during track transitions/replacement stops or resolution errors.
      const isNaturalCompletion =
        !this.isTransitioningTrack &&
        state.didJustFinish === true &&
        this.currentTrack !== null &&
        state.engineTrackId === this.currentTrack.id &&
        !state.errorMessage;

      if (isNaturalCompletion) {
        const finishedTrack = this.currentTrack;
        // A manual seek parked the playhead exactly at the end: that is a
        // USER action, not a completed listen — auto-next, repeat and
        // autoplay must stay out of it. State-based, not time-based: the
        // park lasts exactly as long as the engine stays on the ended
        // parked track, so a DELAYED or repeated finish event can never
        // slip past it (the old 4s window let late duplicates through).
        if (finishedTrack !== null && this.endParkedTrackId === finishedTrack.id) {
          this.endParkConfirmed = true;
          this.consumedCompletionTrackId = finishedTrack.id;
          return;
        }
        // ── Sleep timer: end-of-current-track gets the FIRST look at this
        // completion — before repeat-one can replay it, before repeat-queue
        // or queue-next can advance, before autoplay can continue the ended
        // queue. A consumed completion must also swallow DUPLICATE
        // didJustFinish events (see consumedCompletionTrackId), otherwise a
        // repeated finish would resume continuation right after the timer
        // stopped it.
        if (finishedTrack !== null) {
          if (this.consumedCompletionTrackId === finishedTrack.id) {
            return; // already consumed: playback stays ended.
          }
          if (this.deps.completionGate?.consumeNaturalCompletion(finishedTrack)) {
            this.consumedCompletionTrackId = finishedTrack.id;
            return;
          }
        }
        if (this.repeatMode === 'one') {
          // Repeat One: replay the same track; queue/index untouched.
          if (this.currentTrack) {
            void this.playTrack(this.currentTrack);
          }
        } else if (this.repeatMode === 'queue') {
          // Repeat Queue: wrap from last index to 0; queue never duplicated.
          if (this.queue.length > 0 && this.queueIndex >= 0) {
            if (this.queueIndex < this.queue.length - 1) {
              void this.next();
            } else if (this.queue.length === 1) {
              // Single playable item (e.g. after Clear Up Next): playAt(0)
              // would no-op on index === queueIndex, so replay the wrap
              // explicitly — repeat-all must still loop a one-item queue.
              void this.playTrack(this.queue[0]);
            } else {
              void this.playAt(0);
            }
          }
        } else if (this.queueIndex >= 0 && this.queueIndex < this.queue.length - 1) {
          void this.next();
        } else {
          // End of queue with repeat OFF: the queue is exhausted, so the
          // autoplay layer may continue it with ONE real candidate (see
          // continueWithAutoplay). Every repeat/shuffle branch above stays
          // authoritative whenever it applies; this runs only when none does.
          void this.continueWithAutoplay();
        }
      }
    });
  }

  /**
   * Applies one engine state to the current selection.
   *
   * Three cases, in the order they matter:
   *
   * 1. The state belongs to ANOTHER track (the previous stream, which the
   *    engine is still reporting): ignored outright. The user has already moved
   *    on, and the engine has not caught up — publishing its status/position
   *    under the new track is what made the UI lie about which song was playing.
   * 2. The state reports an error for the selected track: latched as the
   *    selection's error, so `loading → error` survives whatever the engine
   *    emits next.
   * 3. The state proves the engine really took the new stream (it is playing or
   *    paused on it, or failed on it): the pending latch is released and the
   *    engine becomes the source of truth for status/position/duration again.
   *    A 'loading'/'idle' state does not release it: those do not distinguish
   *    "new stream buffering" from "old stream still reporting".
   */
  private syncSelectionWithEngine(state: PlaybackState): void {
    const selected = this.currentTrack;
    if (selected === null) {
      // No selection: nothing to attribute the engine's state to, and nothing
      // to wait for either.
      this.awaitingEngineTrackId = null;
      return;
    }
    if (state.engineTrackId !== selected.id) return;

    if (state.errorMessage) {
      this.selectionError = state.errorMessage;
      this.awaitingEngineTrackId = null;
      return;
    }
    if (state.status === 'playing' || state.status === 'paused') {
      // The engine caught up (or recovered on this same track).
      this.selectionError = null;
      this.awaitingEngineTrackId = null;
    }
  }

  /** React external-store subscription (useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** React external-store snapshot getter. */
  getSnapshot = (): PlayerSnapshot => this.snapshot;

  /**
   * The smallest durable form of the current session, for persistence.
   * Null when nothing is selected (idle/stopped — callers clear instead).
   * Read-only: the controller keeps ownership of all queue state.
   */
  getSessionState(): PlaybackSessionState | null {
    if (this.currentTrack === null || this.sourceQueue.length === 0) return null;
    return {
      // Source order only: with shuffle off it IS the effective order, and
      // with shuffle on the effective order is rebuilt from it at restore.
      tracks: [...this.sourceQueue],
      queueIndex: this.queueIndex >= 0 ? this.queueIndex : 0,
      currentTrackKey: trackIdentityKey(this.currentTrack),
      shuffleEnabled: this.shuffleEnabled,
      repeatMode: this.repeatMode,
      // During a restored-paused state the snapshot already carries the
      // saved position/duration (see republish()).
      positionMs: this.snapshot.positionMs,
      durationMs: this.snapshot.durationMs,
    };
  }

  /**
   * Rebuilds a previous session into this controller — WITHOUT starting
   * playback, resolving a stream, warming anything, or writing history.
   *
   * - only ever targets an idle controller (live playback is never
   *   clobbered; double-hydration is harmless);
   * - the effective queue is rebuilt here: shuffle off → source order as
   *   saved; shuffle on → the controller's OWN buildShuffledOrder, whose
   *   first item is the restored current track — so the current track
   *   stays current (index 0 of the rebuilt order) and next/previous/
   *   auto-next follow the restored queue;
   * - the saved position is clamped to the duration and published as an
   *   honest 'paused' state (never 'playing', never stuck 'loading').
   *
   * The engine remains untouched until the user presses Play; the resume
   * path then re-resolves through the normal resolver (no stream URL is
   * ever persisted) and applies the position between load and play.
   */
  restoreSession(state: PlaybackSessionState): void {
    if (this.currentTrack !== null || state.tracks.length === 0) return;

    const tracks = state.tracks.filter(isTrack);
    if (tracks.length === 0) return;

    let currentIndex =
      state.currentTrackKey !== null
        ? tracks.findIndex((track) => trackIdentityKey(track) === state.currentTrackKey)
        : -1;
    if (currentIndex < 0) {
      currentIndex = Number.isFinite(state.queueIndex)
        ? Math.min(Math.max(Math.trunc(state.queueIndex), 0), tracks.length - 1)
        : 0;
    }
    const current = tracks[currentIndex];
    if (!current) return;

    const shuffleEnabled = state.shuffleEnabled;
    const queue = shuffleEnabled
      ? this.buildShuffledOrder(tracks, currentIndex)
      : [...tracks];
    const queueIndex = queue.indexOf(current); // reference-exact instance

    const durationMs =
      state.durationMs !== null && Number.isFinite(state.durationMs) && state.durationMs > 0
        ? state.durationMs
        : (current.durationMs ?? null);
    let positionMs =
      state.positionMs !== null && Number.isFinite(state.positionMs) && state.positionMs > 0
        ? state.positionMs
        : null;
    if (positionMs !== null && durationMs !== null) {
      positionMs = Math.min(positionMs, durationMs);
    }

    this.selectionGeneration += 1;
    this.selectionError = null;
    this.awaitingEngineTrackId = null;
    this.isTransitioningTrack = false;
    this.consumedCompletionTrackId = null;
    this.restoredSession = { positionMs, durationMs };
    this.currentTrack = current;
    this.sourceQueue = [...tracks];
    this.queue = queue;
    this.queueIndex = queueIndex;
    this.shuffleEnabled = shuffleEnabled;
    this.repeatMode =
      state.repeatMode === 'queue' || state.repeatMode === 'one' ? state.repeatMode : 'off';
    this.republish();
  }

  /**
   * Establish/replace the queue from an ordered track list and start
   * playback at startIndex. Called by features (e.g. Search) so queue
   * logic stays out of the UI. Same-track restarts are idempotent.
   */
  async playFromQueue(tracks: readonly Track[], startIndex: number): Promise<void> {
    const start = Math.min(Math.max(startIndex, 0), Math.max(tracks.length - 1, 0));
    this.sourceQueue = [...tracks];
    this.shuffledOrder = this.shuffleEnabled ? this.buildShuffledOrder(this.sourceQueue, start) : null;
    // Always a separate array: the effective queue and the source order are
    // two views of one membership, never the same object — a mutation of one
    // can never silently double-apply to (or be lost from) the other.
    this.queue = this.shuffledOrder ? [...this.shuffledOrder] : [...this.sourceQueue];
    this.queueIndex = this.shuffleEnabled ? this.queue.findIndex((t) => t.id === this.sourceQueue[start].id) : start;
    await this.playTrack(this.queue[this.queueIndex]);
  }

  /** Toggle shuffled playback order; current track and playback are preserved. */
  async toggleShuffle(): Promise<void> {
    if (this.sourceQueue.length === 0) return;
    this.shuffleEnabled = !this.shuffleEnabled;
    const currentId = this.currentTrack?.id;
    if (this.shuffleEnabled) {
      this.shuffledOrder = this.buildShuffledOrder(this.sourceQueue, this.sourceQueue.findIndex((t) => t.id === currentId));
      this.queue = [...this.shuffledOrder];
    } else {
      this.shuffledOrder = null;
      this.queue = [...this.sourceQueue];
    }
    this.queueIndex = Math.max(0, this.queue.findIndex((t) => t.id === currentId));
    this.republish();
    // The effective order changed, so the next track — the single prewarm
    // target — may have changed with it.
    this.deps.prefetch?.schedule(this.peekNextPrefetchTrack());
  }

  /** Cycle repeat mode: off → queue → one → off. */
  toggleRepeatMode(): void {
    this.repeatMode = this.repeatMode === 'off' ? 'queue' : this.repeatMode === 'queue' ? 'one' : 'off';
    this.republish();
    // Repeat semantics change what "next" means (one → nothing to warm,
    // queue → wrap target), so retarget the single prewarm slot.
    this.deps.prefetch?.schedule(this.peekNextPrefetchTrack());
  }

  /** Stable shuffled order: current track first, remaining tracks Fisher-Yates shuffled. */
  private buildShuffledOrder(source: readonly Track[], currentIndex: number): Track[] {
    const current = source[currentIndex];
    const rest = source.filter((_, i) => i !== currentIndex);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return current ? [current, ...rest] : [...rest];
  }

  /**
   * Track → orchestrator (resolve + load + play). Keeps the Track for the UI.
   *
   * The order here is the point:
   *
   *  1. the selection is published SYNCHRONOUSLY — current track, title, artist,
   *     artwork, queue position all move to the new track on this frame, with
   *     status 'loading' and no position — BEFORE any resolution work starts;
   *  2. then the (slow) resolve + load + play runs in the background;
   *  3. a request superseded by a newer selection returns without touching the
   *     engine, so it cannot start audio for a track the user has moved past.
   */
  async playTrack(track: Track, startAtMs?: number): Promise<void> {
    // Any (re)selection ends the restored-paused state; a saved start
    // position only applies when carried explicitly as startAtMs.
    this.restoredSession = null;
    // A new selection supersedes any sleep-timer-consumed completion and
    // any pending manual-seek anchor/end-park from the previous track.
    this.consumedCompletionTrackId = null;
    this.seekAnchorMs = null;
    this.endParkedTrackId = null;
    this.endParkConfirmed = false;
    // 1. Select immediately. Same-tick from the caller's point of view: the tap
    // handler publishes before its first await resolves.
    const generation = ++this.selectionGeneration;
    this.currentTrack = track;
    this.selectionError = null;
    // The engine still holds whatever was loaded before (its status updates keep
    // arriving), so its state is not trusted for this track until it reports the
    // track back — see syncSelectionWithEngine().
    this.awaitingEngineTrackId = track.id;
    this.isTransitioningTrack = true;
    // If this track is currently being warmed, adopt that in-flight resolve
    // instead of starting a second one (NØTE preload.adopt parity).
    this.deps.prefetch?.adopt(track.id);
    this.republish();

    // 2. Resolve + load + play (background; the UI already shows the new track).
    try {
      await this.deps.orchestrator.playTrack(track, {
        isCancelled: () => generation !== this.selectionGeneration,
        startAtMs,
      });
      if (generation !== this.selectionGeneration) return; // superseded
      // Resolve + load + play all succeeded: the track actually started.
      this.deps.onTrackStarted?.(track);
      // Warm exactly one track ahead, so pressing next is instant
      // (NØTE preloader.schedule(queue.peekNext()) parity).
      this.deps.prefetch?.schedule(this.peekNextPrefetchTrack());
      // The track is already playing — NOW, asynchronously and
      // single-flight, top the automatic Up Next queue toward its target
      // (never on the critical path above: playback never waits for it).
      this.maybeFillAutomaticQueue();
    } catch (error) {
      if (generation !== this.selectionGeneration) return; // superseded
      // Keep the track visible; surface the failure explicitly.
      const message = error instanceof Error ? error.message : 'Playback failed.';
      console.warn('[QUEUE] playTrack FAILED:', message);
      this.selectionError = message;
      this.republish();
    } finally {
      if (generation === this.selectionGeneration) {
        this.isTransitioningTrack = false;
      }
    }
  }

  /** Play/pause toggle against the existing engine. */
  async togglePlayPause(): Promise<void> {
    // Direct transport interaction takes over from a sleep-timer-consumed
    // completion: whatever happens next is the user's intent, not the
    // timer's standing "stay ended" decision.
    this.consumedCompletionTrackId = null;
    // A selection is still resolving: the engine holds the PREVIOUS stream.
    // Toggling would resume old audio under the new track's UI (and would look
    // like a duplicate playback request). The UI disables the control during
    // loading; this makes that true at the controller too.
    if (this.snapshot.status === 'loading') return;
    // Error: the engine never took this track. Retry through the full selection
    // path so the retry carries a FRESH generation — an older superseded
    // request can never hijack it (see playTrack()).
    if (this.snapshot.status === 'error') {
      const track = this.snapshot.currentTrack;
      if (track) await this.playTrack(track);
      return;
    }
    // Restored session: the engine has NEVER loaded this selection in this
    // process — resume through the full selection path (fresh resolve →
    // load → saved position → play) instead of calling play() on an empty
    // engine. This is the only way a restored session starts audio.
    if (this.restoredSession !== null && this.currentTrack !== null) {
      const startAtMs = this.restoredSession.positionMs ?? undefined;
      await this.playTrack(this.currentTrack, startAtMs);
      return;
    }
    if (this.snapshot.status === 'playing') {
      await this.deps.engine.pause();
    } else if (this.snapshot.currentTrack) {
      await this.deps.engine.play();
    }
  }

  /**
   * Explicit, deterministic pause — unlike togglePlayPause it can ONLY
   * silence playback: it never starts audio, never retries a failed
   * selection and never touches queue, repeat, shuffle or the session.
   * No-op unless playback is actually running. Exists for callers that
   * must be able to say "stop the sound" without any chance of starting
   * it (the sleep timer's expiry path).
   */
  async pause(): Promise<void> {
    if (this.snapshot.status !== 'playing') return;
    await this.deps.engine.pause();
  }

  /** Seek against the existing engine (milliseconds). */
  async seek(positionMs: number): Promise<void> {
    if (!this.snapshot.currentTrack) return;
    // Restored session: nothing is loaded yet. Record the seek against the
    // restored state (clamped) instead of seeking an unloaded engine — it
    // is applied between load and play on first Play.
    if (this.restoredSession !== null) {
      const { durationMs } = this.restoredSession;
      const clamped = Math.max(
        0,
        durationMs !== null && durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs,
      );
      this.restoredSession = { positionMs: clamped, durationMs };
      this.republish();
      return;
    }
    // While the selection is loading or failed, the engine still holds a
    // DIFFERENT stream (usually the previous track's): a seek would move that
    const status = this.snapshot.status;
    if (status === 'loading' || status === 'error') return;
    const dur = this.snapshot.durationMs;
    const validMs = Math.max(0, dur !== null && dur > 0 ? Math.min(positionMs, dur) : positionMs);
    // Anchor the optimistic position until the engine reports it back:
    // republish() rebuilds from engine state, which is still at the
    // PRE-SEEK time until the native seek lands (see settleSeekAnchor).
    this.seekAnchorMs = validMs;
    this.seekAnchorAt = Date.now();
    // Seeking to the exact end is a manual park; the STATE_ENDED event it
    // provokes must never be mistaken for a natural finish. A seek to any
    // other position is an explicit move away from the park and clears it.
    if (dur !== null && validMs >= dur) {
      this.endParkedTrackId = this.currentTrack?.id ?? null;
      this.endParkConfirmed = false;
    } else {
      this.endParkedTrackId = null;
      this.endParkConfirmed = false;
    }
    this.snapshot = { ...this.snapshot, positionMs: validMs };
    this.republish();
    await this.deps.engine.seek(validMs);
  }

  /**
   * Set the audible player volume (0–1) through the engine — the ONE path
   * from UI to the native mixer level, so no component ever touches
   * expo-audio directly. Deliberately NOT a transport interaction: it never
   * restarts, never seeks, never touches queue/repeat/shuffle or the
   * sleep-timer latch. Invalid input is ignored; finite values are clamped
   * to 0–1. The engine emission republishes; the explicit republish keeps
   * no-op calls (same value) observably synchronous for callers.
   */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.deps.engine.setVolume(Math.min(1, Math.max(0, volume)));
    this.republish();
  }

  /** Advance to the next queue item; no-op when none exists. */
  async next(): Promise<void> {
    if (this.queueIndex < 0 || this.queueIndex >= this.queue.length - 1) return;
    const nextTrack = this.queue[this.queueIndex + 1];
    this.queueIndex += 1;
    await this.playTrack(nextTrack);
  }

  /** Jump directly to a queue index (Up Next tap); no-op when out of bounds. */
  async playAt(index: number): Promise<void> {
    if (index < 0 || index >= this.queue.length || index === this.queueIndex) return;
    this.queueIndex = index;
    await this.playTrack(this.queue[index]);
  }

  /** Return to the previous queue item; no-op when none exists. */
  async previous(): Promise<void> {
    if (this.queueIndex <= 0) return;
    const prevTrack = this.queue[this.queueIndex - 1];
    this.queueIndex -= 1;
    await this.playTrack(prevTrack);
  }

  /**
   * Play next: insert a track immediately after the current one in the
   * EFFECTIVE order (A→B→C, play-next F ⇒ A→F→B→C). The current track,
   * playback position and repeat/shuffle state are untouched, and nothing
   * resolves or starts — except the existing empty-queue behaviour (start
   * playing the single track), which is kept as-is.
   */
  playNextTrack(track: Track): void {
    if (this.queue.length === 0 || this.queueIndex < 0) {
      void this.playFromQueue([track], 0);
      return;
    }
    const insertAt = this.queueIndex + 1;
    const nextQueue = [...this.queue];
    nextQueue.splice(insertAt, 0, track);
    this.queue = nextQueue;

    // Keep the source order on the same membership: with shuffle OFF the two
    // lists are the same logical list (insert at the same position); with
    // shuffle ON the source order only carries membership (append). The old
    // in-place variant double-applied through the shared array reference.
    const sourceAt = this.shuffleEnabled ? this.sourceQueue.length : insertAt;
    const nextSource = [...this.sourceQueue];
    nextSource.splice(sourceAt, 0, track);
    this.sourceQueue = nextSource;
    this.syncShuffledOrder();
    this.queueChanged();
  }

  /**
   * Add to queue: append to the end (A→B→C, add D ⇒ A→B→C→D). Never
   * changes the current track and never starts playback — unless there is
   * no queue at all, where the existing behaviour (begin playing it) is
   * kept. Copy-on-write: the fresh array reference is what lets snapshot
   * equality (queue ===) notice the change and notify subscribers.
   */
  addToQueue(track: Track): void {
    if (this.queue.length === 0 || this.queueIndex < 0) {
      void this.playFromQueue([track], 0);
      return;
    }
    this.queue = [...this.queue, track];
    this.sourceQueue = [...this.sourceQueue, track];
    this.syncShuffledOrder();
    this.queueChanged();
  }

  /**
   * Appends multiple tracks to the end of the existing queue.
   *
   * If the queue is currently empty, starts playback of the first track
   * and queues the rest. Updates queue and sourceQueue atomically with a
   * single state notification.
   */
  addTracksToQueue(tracks: readonly Track[]): void {
    if (!tracks || tracks.length === 0) return;
    if (this.queue.length === 0 || this.queueIndex < 0) {
      void this.playFromQueue(tracks, 0);
      return;
    }
    this.queue = [...this.queue, ...tracks];
    this.sourceQueue = [...this.sourceQueue, ...tracks];
    this.syncShuffledOrder();
    this.queueChanged();
  }

  /**
   * Removes the queue item at the given ABSOLUTE queue index.
   *
   * The currently playing item (queueIndex) is never removed — a queue
   * edit must not stop playback; callers get `false` instead. Removing an
   * item before the current one shifts queueIndex down so it keeps pointing
   * at the same track, which is what keeps auto-next/previous correct.
   *
   * Identity-aware via trackIdentityKey (origin:id): removing `online:X`
   * can never remove a `local:X` sharing the same raw id.
   *
   * Returns a QueueRemoval record (the exact former positions of the track,
   * for restoreRemovedTrack / Undo) on success, or `null` when refused —
   * still truthy/falsy in every existing `if (removeFromQueue(...))` use.
   */
  removeFromQueue(index: number): QueueRemoval | null {
    if (index < 0 || index >= this.queue.length) return null;
    if (index === this.queueIndex) return null;

    const removed = this.queue[index];
    // Record BOTH former positions before mutating: with shuffle ON the
    // source position differs from the effective position and cannot be
    // reconstructed after the splice (see QueueRemoval).
    const key = trackIdentityKey(removed);
    const sourceIndex = this.shuffleEnabled
      ? this.sourceQueue.findIndex((t) => trackIdentityKey(t) === key)
      : index;

    const nextQueue = [...this.queue];
    nextQueue.splice(index, 1);
    this.queue = nextQueue;
    if (index < this.queueIndex) {
      this.queueIndex -= 1;
    }

    if (this.shuffleEnabled) {
      // Independent permutations: drop ONE identity match from the source
      // order (counts stay aligned; source order is only a shuffle input).
      if (sourceIndex >= 0) {
        const nextSource = [...this.sourceQueue];
        nextSource.splice(sourceIndex, 1);
        this.sourceQueue = nextSource;
      }
    } else {
      // Same logical list: the same index applies to both orders.
      const nextSource = [...this.sourceQueue];
      nextSource.splice(index, 1);
      this.sourceQueue = nextSource;
    }
    this.syncShuffledOrder();
    this.queueChanged();
    // Removals can push the upcoming count below the healthy floor: the
    // automatic top-up refills toward the target (swipe/Undo semantics
    // themselves are unchanged — this only checks cheap guards).
    this.maybeFillAutomaticQueue();
    return { track: removed, queueIndex: index, sourceIndex };
  }

  /**
   * Restores a track removed through removeFromQueue at its EXACT former
   * positions — the Undo path. Pure queue mutation: it never resolves a
   * stream, never starts playback and never re-points the current track.
   * queueIndex only shifts by one when the insert lands at or before it
   * (the same standard shift moveInQueue uses), so the playing item stays
   * the playing item.
   *
   * - Effective queue: inserted at the recorded absolute index — never
   *   appended, so the item reappears at the same Up Next slot.
   * - Shuffle OFF: source order is the same logical list, so the recorded
   *   index applies to it too.
   * - Shuffle ON: the source order only carries membership + original play
   *   context, so the track is re-inserted at its recorded SOURCE index.
   *   Membership counts stay aligned and syncShuffledOrder() re-links the
   *   shuffled artifact to the effective queue — shuffled playback order is
   *   untouched (the restored item joins where the effective splice put it).
   */
  restoreRemovedTrack(removal: QueueRemoval): boolean {
    if (this.queue.length === 0) return false;

    const insertAt = Math.min(Math.max(removal.queueIndex, 0), this.queue.length);
    const nextQueue = [...this.queue];
    nextQueue.splice(insertAt, 0, removal.track);
    this.queue = nextQueue;
    if (insertAt <= this.queueIndex) {
      this.queueIndex += 1;
    }

    const sourceAt = Math.min(
      Math.max(removal.sourceIndex >= 0 ? removal.sourceIndex : insertAt, 0),
      this.sourceQueue.length,
    );
    const nextSource = [...this.sourceQueue];
    nextSource.splice(sourceAt, 0, removal.track);
    this.sourceQueue = nextSource;

    this.syncShuffledOrder();
    this.queueChanged();
    return true;
  }

  /**
   * Moves a queue item from one position to another (step Move Up/Down now,
   * drag reorder later — same API). Operates on the EFFECTIVE order the UI
   * renders. The currently playing track never changes: queueIndex follows
   * it through the standard three-case shift (same slot / crossing the
   * current / staying on one side), so no mutation can re-point playback at
   * a different song.
   *
   * With shuffle OFF the source order mirrors the move (same logical list);
   * with shuffle ON the source keeps the play-context original order and
   * only membership stays aligned — unshuffling restores the source order,
   * exactly as the existing shuffle architecture intends.
   */
  moveInQueue(fromIndex: number, toIndex: number): boolean {
    const length = this.queue.length;
    if (fromIndex < 0 || fromIndex >= length || toIndex < 0 || toIndex >= length) return false;
    if (fromIndex === toIndex) return false;

    const nextQueue = [...this.queue];
    const [moved] = nextQueue.splice(fromIndex, 1);
    nextQueue.splice(toIndex, 0, moved);
    this.queue = nextQueue;

    if (fromIndex === this.queueIndex) {
      this.queueIndex = toIndex;
    } else if (fromIndex < this.queueIndex && toIndex >= this.queueIndex) {
      this.queueIndex -= 1;
    } else if (fromIndex > this.queueIndex && toIndex <= this.queueIndex) {
      this.queueIndex += 1;
    }

    if (this.shuffleEnabled) {
      // Effective order only; the source stays the original play context.
    } else {
      const nextSource = [...this.sourceQueue];
      const [movedSource] = nextSource.splice(fromIndex, 1);
      nextSource.splice(toIndex, 0, movedSource);
      this.sourceQueue = nextSource;
    }
    this.syncShuffledOrder();
    this.queueChanged();
    return true;
  }

  /**
   * Clear upcoming queue items after the current playing track:
   * A(playing)→B→C→D becomes A(playing). The current track, its position
   * and every repeat mode survive; repeat-off simply has nothing left to
   * advance to, repeat-one still replays A, repeat-queue wraps to A.
   */
  clearUpcomingQueue(): void {
    if (this.queueIndex < 0 || this.queue.length <= this.queueIndex + 1) return;
    // Explicit user intent: any in-flight automatic fill is now stale.
    this.queueClearEpoch += 1;

    const kept = this.queue.slice(0, this.queueIndex + 1);
    const dropped = this.queue.slice(this.queueIndex + 1);
    this.queue = kept;

    if (this.shuffleEnabled) {
      // The source keeps exactly what survived: one identity match removed
      // per dropped track, source order otherwise preserved.
      let nextSource = this.sourceQueue;
      for (const track of dropped) {
        const key = trackIdentityKey(track);
        const idx = nextSource.findIndex((t) => trackIdentityKey(t) === key);
        if (idx >= 0) {
          nextSource = [...nextSource.slice(0, idx), ...nextSource.slice(idx + 1)];
        }
      }
      this.sourceQueue = nextSource;
    } else {
      // Same logical list: keep both orders identical (the old implementation
      // reassigned only `queue`, silently re-introducing cleared tracks the
      // next time shuffle rebuilt from the stale source order).
      this.sourceQueue = kept;
    }
    this.syncShuffledOrder();
    this.queueChanged();
  }

  /**
   * Tops the automatic Up Next queue toward AUTO_QUEUE_TARGET with ONE
   * bounded batch from the existing recommendation seam (the same
   * AutoplaySource the ended-queue path uses — no second queue engine,
   * no parallel recommendation state).
   *
   * Guards, in order:
   * - single-flight: one batch at a time, so removal storms or rapid
   *   skipping can never stack requests;
   * - scope: a REAL queue index, an ONLINE current track, no restored-
   *   paused session (its fill starts when the user presses Play), and
   *   upcoming already healthy (≥ 30) → zero requests;
   * - target = AUTO_QUEUE_TARGET − upcoming (fill toward 40, never more);
   * - after the await the batch is discarded unless the SAME selection is
   *   still live (generation + reference), and an explicit Clear during
   *   the flight discards it too (queueClearEpoch); survivors are then
   *   re-filtered against the LIVE queue and clamped so the fill can
   *   never overshoot the target. Tracks the user REMOVED mid-flight can
   *   never come back: they were part of the excluded snapshot the batch
   *   was built from, so the provider never returned them;
   * - appending runs through appendAutomaticTracks — never plays, never
   *   re-points queueIndex, never touches the current track;
   * - a discarded batch (user skipped meanwhile) re-checks ONCE for the
   *   new selection via the finally below; an empty result never retries
   *   by itself. No unbounded request loop is possible.
   */
  private maybeFillAutomaticQueue(): void {
    if (this.queueFillPending) return;
    const source = this.deps.autoplay;
    if (!source?.getRecommendationBatch) return;
    const current = this.currentTrack;
    if (current === null || this.queueIndex < 0) return;
    // Scope: only ONLINE playback gets the automatic top-up — locally
    // curated queues (albums/playlists the user chose) are never extended
    // behind their back.
    if (trackOrigin(current) !== 'online') return;
    // A restored session has not started playing this session yet; the
    // fill fires from playTrack() the moment the user presses Play.
    if (this.restoredSession !== null) return;
    const upcoming = this.queue.length - this.queueIndex - 1;
    if (upcoming >= AUTO_QUEUE_REFILL_BELOW) return;
    const target = Math.min(AUTO_QUEUE_TARGET - upcoming, AUTO_QUEUE_TARGET);
    if (target <= 0) return;

    const generation = this.selectionGeneration;
    const clearEpoch = this.queueClearEpoch;
    this.queueFillPending = true;
    void source
      .getRecommendationBatch(current, [...this.queue, ...this.sourceQueue], target)
      .then((batch) => {
        if (generation !== this.selectionGeneration) return; // user moved on
        if (this.queueClearEpoch !== clearEpoch) return; // user cleared
        if (this.currentTrack !== current) return;
        const live = new Set(this.queue.map(trackIdentityKey));
        const upcomingNow = this.queue.length - this.queueIndex - 1;
        const allowed = Math.max(0, AUTO_QUEUE_TARGET - upcomingNow);
        const additions = batch
          .filter((track) => !live.has(trackIdentityKey(track)))
          .slice(0, allowed);
        if (additions.length > 0) this.appendAutomaticTracks(additions);
      })
      .catch((error) => {
        console.warn('[QUEUE] automatic Up Next fill failed:', error);
      })
      .finally(() => {
        const stale = generation !== this.selectionGeneration;
        this.queueFillPending = false;
        // A batch discarded because the user skipped during collection
        // must not leave the NEW track's queue unfilled: re-check once
        // against live state (converges — a fresh attempt is single-flight
        // and only a further user selection can make it stale again).
        if (stale) this.maybeFillAutomaticQueue();
      });
  }

  /**
   * Batch append of automatic recommendations — the batch twin of
   * addToQueue: ONE copy-on-write for effective + source order, one
   * syncShuffledOrder, one queueChanged (republish + single prewarm
   * retarget) instead of N of each. The end state is identical to
   * appending one by one, so shuffle, repeat, session persistence and
   * every manual queue API keep their exact semantics. Never plays
   * anything and never moves queueIndex — the current track cannot
   * change. Automatic and manual entries stay indistinguishable in the
   * queue BY DESIGN (same as today's autoplay append): they are ordinary
   * tracks, and every existing operation treats them identically.
   */
  private appendAutomaticTracks(tracks: readonly Track[]): void {
    if (tracks.length === 0) return;
    this.queue = [...this.queue, ...tracks];
    this.sourceQueue = [...this.sourceQueue, ...tracks];
    this.syncShuffledOrder();
    this.queueChanged();
  }

  /**
   * End-of-queue continuation (autoplay): the current track NATURALLY
   * finished, repeat is OFF and no upcoming item exists — the queue is
   * exhausted. Asks the injected AutoplaySource (composition wires
   * RecommendationService) for ONE real candidate and, only if it is
   * still valid, appends it through the EXISTING addToQueue path and
   * advances with the EXISTING next(): same queue semantics, same
   * shuffle/repeat representation, same prefetch seam, same orchestrator
   * → resolver → engine path. No second playback path, and no queue
   * mutation ever happens outside this class.
   *
   * Race protection (duplicate completion callbacks are real: the engine
   * may keep reporting didJustFinish for the ended track):
   * - single-flight flag: one resolution at a time, so a repeated finish
   *   event can never append (or start) a second candidate;
   * - selectionGeneration: a newer selection or an explicit stop bumps
   *   it, so a stale candidate is discarded untouched;
   * - repeat mode re-checked after the await (repeat-one/queue activated
   *   meanwhile own the completion boundary — autoplay must not bypass
   *   them);
   * - the queue is re-inspected after the await: an upcoming item that
   *   appeared mid-resolution makes the QUEUE authoritative (it is
   *   continued, nothing is injected), and an identity match (existing
   *   trackIdentityKey, origin:id) is never appended twice.
   *
   * No candidate, a failed lookup, or any failed guard simply leaves
   * playback ended — exactly the pre-autoplay behaviour. Once appended,
   * the item is an ordinary queue entry: history, Mini Player, Up Next,
   * the media notification and session persistence all see it normally.
   */
  private async continueWithAutoplay(): Promise<void> {
    const source = this.deps.autoplay;
    if (!source || this.autoplayPending) return;
    const finished = this.currentTrack;
    if (finished === null || this.queueIndex < 0) return;

    this.autoplayPending = true;
    try {
      const generation = this.selectionGeneration;
      let candidate: Track | null = null;
      try {
        candidate = await source.getAutoplayTrack(finished, [...this.queue, ...this.sourceQueue]);
      } catch (error) {
        console.warn('[AUTOPLAY] candidate lookup failed; playback ends naturally.', error);
        return;
      }
      if (candidate === null) {
        return;
      }
      // The user moved on (new selection or explicit stop) while resolving.
      if (generation !== this.selectionGeneration || this.currentTrack !== finished) {
        return;
      }
      // Repeat semantics changed meanwhile and now own this boundary.
      if (this.repeatMode !== 'off') {
        return;
      }
      if (this.queueIndex < 0) return;
      // An upcoming item appeared during resolution (user queued one, or a
      // shuffle toggle reshuffled): the queue is authoritative — continue
      // IT and inject nothing.
      if (this.queueIndex < this.queue.length - 1) {
        void this.next();
        return;
      }
      const key = trackIdentityKey(candidate);
      if (this.queue.some((track) => trackIdentityKey(track) === key)) {
        return;
      }
      // Existing public queue API: appends to effective + source order,
      // syncs the shuffle representation, republishes and retargets the
      // ONE prefetch slot at this very track — without touching playback.
      this.addToQueue(candidate);
      // Existing advance: selects the appended item through playTrack().
      // addToQueue → next() → playTrack runs synchronously up to its first
      // await, so no completion event can interleave between the two.
      await this.next();
    } finally {
      this.autoplayPending = false;
    }
  }

  /**
   * After any queue mutation: publish immediately (copy-on-write above
   * guarantees a fresh queue reference, so snapshot equality sees it) and
   * retarget the ONE prewarm slot at whatever the actual next track is now.
   * The preloader dedupes and cache-checks, so rapid mutations stay cheap,
   * never re-resolve for playback, and cannot start a warm-up burst.
   */
  private queueChanged(): void {
    this.republish();
    this.deps.prefetch?.schedule(this.peekNextPrefetchTrack());
  }

  /** Keeps the stored shuffle artifact aligned with the effective queue. */
  private syncShuffledOrder(): void {
    if (this.shuffleEnabled) {
      this.shuffledOrder = this.queue;
    }
  }

  /** Explicit stop: playback ends AND currentTrack is cleared (Mini Player hides). */
  async stop(): Promise<void> {
    // Invalidate any play request still in flight: a resolve that completes
    // after this stop must not load/start audio (see MusicService.playTrack).
    this.selectionGeneration += 1;
    this.consumedCompletionTrackId = null;
    this.selectionError = null;
    this.awaitingEngineTrackId = null;
    this.restoredSession = null;
    this.seekAnchorMs = null;
    this.endParkedTrackId = null;
    this.endParkConfirmed = false;
    this.scrubbing = false;
    this.deps.prefetch?.schedule(null);
    await this.deps.orchestrator.stopPlayback();
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = -1;
    this.sourceQueue = [];
    this.shuffledOrder = null;
    this.publish({
      currentTrack: null,
      activeStream: null,
      status: 'idle',
      positionMs: null,
      durationMs: null,
      errorMessage: null,
      hasNext: false,
      hasPrevious: false,
      queue: [],
      queueIndex: -1,
      shuffleEnabled: this.shuffleEnabled,
      repeatMode: this.repeatMode,
      // Stop clears the selection, not the engine's volume — the user's
      // chosen level stays in effect for whatever plays next.
      volume: this.engineState.volume ?? 1,
    });
  }

  /** Detach from the engine (app teardown). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeEngine();
    this.listeners.clear();
  }

  /**
   * The next queue track in playback order — the single prefetch target.
   * Mirrors the auto-advance logic: repeat-one warms nothing (the current
   * track is already cached), repeat-queue wraps to the first track,
   * repeat-off ends at the queue boundary. Shuffle semantics are untouched:
   * `this.queue` is already the effective play order.
   */
  private peekNextPrefetchTrack(): Track | null {
    if (this.repeatMode === 'one') return null;
    if (this.queueIndex < 0) return null;
    if (this.queueIndex < this.queue.length - 1) return this.queue[this.queueIndex + 1] ?? null;
    if (this.repeatMode === 'queue' && this.queue.length > 0) return this.queue[0] ?? null;
    return null;
  }

  /**
   * The single mapping from (selected track, engine state) to what the UI sees.
   *
   * Selected track and playable stream are deliberately decoupled: the moment a
   * track is selected it becomes `currentTrack` with status 'loading', and the
   * engine's own state only takes over once it is provably about that track.
   * That is what makes `currentTrack = B / status = loading / stream unresolved`
   * a first-class state instead of a UI freeze on the previous song.
   */
  private republish(): void {
    const selected = this.currentTrack;
    /** True when the engine's state actually describes the selected track. */
    const engineOwnsSelection =
      selected !== null && this.awaitingEngineTrackId === null && this.engineState.engineTrackId === selected.id;

    let status: PlaybackStatus;
    let positionMs: number | null;
    let durationMs: number | null;
    let errorMessage: string | null;

    if (selected === null) {
      // Nothing selected (explicit stop / idle app): the engine is all there is.
      status = this.engineState.status;
      positionMs = this.engineState.positionMs;
      durationMs = this.engineState.durationMs;
      errorMessage = this.engineState.errorMessage;
    } else if (this.restoredSession !== null) {
      // Session restored, engine deliberately untouched: an honest PAUSED
      // state with the saved position/duration — never 'playing' (no audio
      // runs) and never stuck 'loading' (no load was requested).
      status = 'paused';
      positionMs = this.restoredSession.positionMs;
      durationMs = this.restoredSession.durationMs;
      errorMessage = null;
    } else if (this.selectionError) {
      // loading → error, terminal for this selection.
      status = 'error';
      positionMs = null;
      durationMs = null;
      errorMessage = this.selectionError;
    } else if (engineOwnsSelection) {
      status = this.engineState.status;
      positionMs = this.settleSeekAnchor(this.engineState.positionMs);
      durationMs = this.engineState.durationMs;
      errorMessage = this.engineState.errorMessage;
    } else {
      // Selected, not playable yet: no position/duration may be shown, because
      // any the engine reports belong to the previous stream.
      status = 'loading';
      positionMs = null;
      durationMs = null;
      errorMessage = null;
    }

    this.publish({
      currentTrack: selected,
      activeStream:
        engineOwnsSelection && status !== 'error'
          ? this.engineState.activeStream ?? null
          : null,
      status,
      positionMs,
      durationMs,
      errorMessage,
      hasNext: this.queueIndex >= 0 && this.queueIndex < this.queue.length - 1,
      hasPrevious: this.queueIndex > 0,
      queue: this.queue,
      queueIndex: this.queueIndex,
      shuffleEnabled: this.shuffleEnabled,
      repeatMode: this.repeatMode,
      // Engine volume: what the mixer is actually doing right now
      // (full scale until the user moves the in-app slider).
      volume: this.engineState.volume ?? 1,
    });
  }

  /**
   * Manual-seek anchor: returns the position the UI should show while the
   * engine may still be reporting the PRE-SEEK time. Adopts (and clears)
   * once the engine reports within ~2 s of the target — or when the TTL
   * safety valve expires, so a failed seek can never pin the UI.
   */
  private settleSeekAnchor(enginePos: number | null): number | null {
    const anchor = this.seekAnchorMs;
    if (anchor === null || enginePos === null) return enginePos;
    const caughtUp = Math.abs(enginePos - anchor) <= 2_000;
    const expired = Date.now() - this.seekAnchorAt > 5_000;
    if (caughtUp || expired) {
      this.seekAnchorMs = null;
      return enginePos;
    }
    return anchor;
  }

  /**
   * The seekbar drag gesture started: position-only snapshot updates are
   * adopted silently from here on (no React wake-ups — the scrub UI is
   * the visual source of truth). Always balanced by endScrub().
   */
  beginScrub(): void {
    this.scrubbing = true;
  }

  /**
   * The scrub gesture ended: exactly ONE catch-up notification delivers
   * the freshest position (already adopted silently during the drag),
   * then normal position publishing resumes. Idempotent.
   */
  endScrub(): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** The volume drag gesture started: see volumeScrubbing. */
  beginVolumeScrub(): void {
    this.volumeScrubbing = true;
  }

  /**
   * The volume drag gesture ended: exactly ONE catch-up notification
   * delivers the freshest volume (already adopted silently during the
   * drag), then normal publishing resumes. Idempotent.
   */
  endVolumeScrub(): void {
    if (!this.volumeScrubbing) return;
    this.volumeScrubbing = false;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** snapshotEquals minus positionMs/duration-independent fields. */
  private sameExceptPosition(a: PlayerSnapshot, b: PlayerSnapshot): boolean {
    return (
      a.currentTrack === b.currentTrack &&
      a.activeStream === b.activeStream &&
      a.status === b.status &&
      a.errorMessage === b.errorMessage &&
      a.durationMs === b.durationMs &&
      a.hasNext === b.hasNext &&
      a.hasPrevious === b.hasPrevious &&
      a.queue === b.queue &&
      a.queueIndex === b.queueIndex &&
      a.shuffleEnabled === b.shuffleEnabled &&
      a.repeatMode === b.repeatMode &&
      a.volume === b.volume
    );
  }

  /**
   * snapshotEquals minus the volume field AND positionMs: a volume-drag
   * move or a playback progress tick (they overlap while playing — the
   * ~500 ms position updates were the paused-vs-playing stutter). Track,
   * status, queue, duration etc. still compare, so any meaningful change
   * notifies normally.
   */
  private sameExceptVolume(a: PlayerSnapshot, b: PlayerSnapshot): boolean {
    return (
      a.currentTrack === b.currentTrack &&
      a.activeStream === b.activeStream &&
      a.status === b.status &&
      a.errorMessage === b.errorMessage &&
      a.durationMs === b.durationMs &&
      a.hasNext === b.hasNext &&
      a.hasPrevious === b.hasPrevious &&
      a.queue === b.queue &&
      a.queueIndex === b.queueIndex &&
      a.shuffleEnabled === b.shuffleEnabled &&
      a.repeatMode === b.repeatMode
    );
  }

  private publish(next: PlayerSnapshot): void {
    if (this.snapshotEquals(next)) return;
    if (this.scrubbing && this.sameExceptPosition(this.snapshot, next)) {
      // Drag in progress and ONLY the position moved (engine landing,
      // progress tick, playback advancing under the finger): adopt it
      // silently — waking React
      // per position change re-rendered the whole screen several times a
      // second and collapsed the drag's frame rate. endScrub() delivers
      // the single catch-up notification.
      this.snapshot = next;
      return;
    }
    if (this.volumeScrubbing && this.sameExceptVolume(this.snapshot, next)) {
      // Volume drag in progress and only the volume and/or playback
      // position moved: adopt silently — the audio level already changed
      // (engine.setVolume runs on every finger move, never throttled), and
      // position ticks during playback must not wake React mid-drag either
      // (that full-screen re-render per tick was the playing-mode stutter).
      // endVolumeScrub() delivers the single catch-up notification.
      this.snapshot = next;
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private snapshotEquals(next: PlayerSnapshot): boolean {
    const prev = this.snapshot;
    return (
      prev.currentTrack === next.currentTrack &&
      prev.activeStream === next.activeStream &&
      prev.status === next.status &&
      prev.positionMs === next.positionMs &&
      prev.durationMs === next.durationMs &&
      prev.errorMessage === next.errorMessage &&
      prev.hasNext === next.hasNext &&
      prev.hasPrevious === next.hasPrevious &&
      prev.queue === next.queue &&
      prev.queueIndex === next.queueIndex &&
      prev.shuffleEnabled === next.shuffleEnabled &&
      prev.repeatMode === next.repeatMode &&
      prev.volume === next.volume
    );
  }
}
