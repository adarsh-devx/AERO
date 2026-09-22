import type { Track } from '../core/types/track';
import type { PlaybackEngine, PlaybackState, PlaybackStatus, RepeatMode } from './types';

/**
 * Narrow orchestration contract the controller needs. Structurally
 * satisfied by MusicService — the controller must not know how stream
 * resolution works, only that these two operations exist.
 */
interface PlaybackOrchestrator {
  playTrack(track: Track): Promise<void>;
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

export interface PlayerControllerDependencies {
  readonly orchestrator: PlaybackOrchestrator;
  readonly engine: PlaybackEngine;
  readonly prefetch?: PrefetchController;
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
  /** The track the user started — global app state, survives navigation. */
  readonly currentTrack: Track | null;
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
  private readonly unsubscribeEngine: () => void;
  private disposed = false;

  constructor(deps: PlayerControllerDependencies) {
    this.deps = deps;
    this.engineState = {
      status: 'idle',
      trackId: null,
      positionMs: null,
      durationMs: null,
      errorMessage: null,
    };
    this.snapshot = {
      currentTrack: null,
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
    };
    this.unsubscribeEngine = deps.engine.onStateChange((state) => {
      this.engineState = state;
      this.republish();

      // Auto-advance ONLY on genuine natural completion of the active track,
      // NOT during track transitions/replacement stops or resolution errors.
      const isNaturalCompletion =
        !this.isTransitioningTrack &&
        state.didJustFinish === true &&
        this.currentTrack !== null &&
        state.trackId === this.currentTrack.id &&
        !state.errorMessage;

      if (isNaturalCompletion) {
        if (this.repeatMode === 'one') {
          // Repeat One: replay the same track; queue/index untouched.
          if (this.currentTrack) {
            console.log('[QUEUE] repeat one, replaying', this.currentTrack.title);
            void this.playTrack(this.currentTrack);
          }
        } else if (this.repeatMode === 'queue') {
          // Repeat Queue: wrap from last index to 0; queue never duplicated.
          if (this.queue.length > 0 && this.queueIndex >= 0) {
            if (this.queueIndex < this.queue.length - 1) {
              console.log('[QUEUE] Song finished, auto-advancing to next track...');
              void this.next();
            } else {
              console.log('[QUEUE] repeat queue, wrapping to index 0');
              void this.playAt(0);
            }
          }
        } else if (this.queueIndex >= 0 && this.queueIndex < this.queue.length - 1) {
          console.log('[QUEUE] Song finished, auto-advancing to next track...');
          void this.next();
        }
      }
    });
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
   * Establish/replace the queue from an ordered track list and start
   * playback at startIndex. Called by features (e.g. Search) so queue
   * logic stays out of the UI. Same-track restarts are idempotent.
   */
  async playFromQueue(tracks: readonly Track[], startIndex: number): Promise<void> {
    const start = Math.min(Math.max(startIndex, 0), Math.max(tracks.length - 1, 0));
    this.sourceQueue = [...tracks];
    this.shuffledOrder = this.shuffleEnabled ? this.buildShuffledOrder(this.sourceQueue, start) : null;
    this.queue = this.shuffledOrder ?? this.sourceQueue;
    this.queueIndex = this.shuffleEnabled ? this.queue.findIndex((t) => t.id === this.sourceQueue[start].id) : start;
    // Only the outcome is logged. `queue`, `startIndex` and the queue contents
    // are not serialised here: this runs synchronously on the tap path, and
    // JSON.stringify over the whole queue was pure overhead on it.
    console.log('[QUEUE] playFromQueue', 'startIndex=', start, 'queueLength=', this.queue.length);
    await this.playTrack(this.queue[this.queueIndex]);
  }

  /** Toggle shuffled playback order; current track and playback are preserved. */
  async toggleShuffle(): Promise<void> {
    if (this.sourceQueue.length === 0) return;
    this.shuffleEnabled = !this.shuffleEnabled;
    const currentId = this.currentTrack?.id;
    if (this.shuffleEnabled) {
      this.shuffledOrder = this.buildShuffledOrder(this.sourceQueue, this.sourceQueue.findIndex((t) => t.id === currentId));
      this.queue = this.shuffledOrder;
    } else {
      this.shuffledOrder = null;
      this.queue = this.sourceQueue;
    }
    this.queueIndex = Math.max(0, this.queue.findIndex((t) => t.id === currentId));
    this.republish();
  }

  /** Cycle repeat mode: off → queue → one → off. */
  toggleRepeatMode(): void {
    this.repeatMode = this.repeatMode === 'off' ? 'queue' : this.repeatMode === 'queue' ? 'one' : 'off';
    this.republish();
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

  /** Track → orchestrator (resolve + load + play). Keeps the Track for the UI. */
  async playTrack(track: Track): Promise<void> {
    console.log('[QUEUE] playTrack', track.id, track.title, 'queueIndex=', this.queueIndex);
    this.currentTrack = track;
    // If this track is currently being warmed, adopt that in-flight resolve
    // instead of starting a second one (NØTE preload.adopt parity).
    this.deps.prefetch?.adopt(track.id);
    this.publish({
      currentTrack: track,
      status: 'loading',
      positionMs: null,
      durationMs: null,
      errorMessage: null,
      hasNext: this.queueIndex >= 0 && this.queueIndex < this.queue.length - 1,
      hasPrevious: this.queueIndex > 0,
      queue: this.queue,
      queueIndex: this.queueIndex,
      shuffleEnabled: this.shuffleEnabled,
      repeatMode: this.repeatMode,
    });
    this.isTransitioningTrack = true;
    try {
      await this.deps.orchestrator.playTrack(track);
      // Resolve + load + play all succeeded: the track actually started.
      this.deps.onTrackStarted?.(track);
      // Warm exactly one track ahead, so pressing next is instant
      // (NØTE preloader.schedule(queue.peekNext()) parity).
      this.deps.prefetch?.schedule(this.peekNextPrefetchTrack());
    } catch (error) {
      // Keep the track visible; surface the failure explicitly.
      const message = error instanceof Error ? error.message : 'Playback failed.';
      console.log('[QUEUE] playTrack FAILED:', message);
      this.publish({
        currentTrack: track,
        status: 'error',
        positionMs: null,
        durationMs: null,
        errorMessage: message,
        hasNext: this.queueIndex >= 0 && this.queueIndex < this.queue.length - 1,
        hasPrevious: this.queueIndex > 0,
        queue: this.queue,
        queueIndex: this.queueIndex,
        shuffleEnabled: this.shuffleEnabled,
        repeatMode: this.repeatMode,
      });
    } finally {
      this.isTransitioningTrack = false;
    }
  }

  /** Play/pause toggle against the existing engine. */
  async togglePlayPause(): Promise<void> {
    if (this.snapshot.status === 'playing') {
      await this.deps.engine.pause();
    } else if (this.snapshot.currentTrack) {
      await this.deps.engine.play();
    }
  }

  /** Seek against the existing engine (milliseconds). */
  async seek(positionMs: number): Promise<void> {
    if (!this.snapshot.currentTrack) return;
    await this.deps.engine.seek(positionMs);
  }

  /** Advance to the next queue item; no-op when none exists. */
  async next(): Promise<void> {
    console.log(
      '[QUEUE] next requested',
      'queueIndex=', this.queueIndex,
      'queueLen=', this.queue.length,
    );
    if (this.queueIndex < 0 || this.queueIndex >= this.queue.length - 1) return;
    const nextTrack = this.queue[this.queueIndex + 1];
    this.queueIndex += 1;
    console.log('[QUEUE] next track', nextTrack.id, nextTrack.title, 'newIndex=', this.queueIndex);
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
    console.log(
      '[QUEUE] previous requested',
      'queueIndex=', this.queueIndex,
      'queueLen=', this.queue.length,
    );
    if (this.queueIndex <= 0) return;
    const prevTrack = this.queue[this.queueIndex - 1];
    this.queueIndex -= 1;
    console.log('[QUEUE] previous track', prevTrack.id, prevTrack.title, 'newIndex=', this.queueIndex);
    await this.playTrack(prevTrack);
  }

  /** Insert track immediately after current playing track in queue. */
  playNextTrack(track: Track): void {
    if (this.queue.length === 0 || this.queueIndex < 0) {
      void this.playFromQueue([track], 0);
      return;
    }
    const insertAt = this.queueIndex + 1;
    this.queue.splice(insertAt, 0, track);
    this.sourceQueue.push(track);
    this.republish();
  }

  /** Append track to the end of the active queue. */
  addToQueue(track: Track): void {
    if (this.queue.length === 0 || this.queueIndex < 0) {
      void this.playFromQueue([track], 0);
      return;
    }
    this.queue.push(track);
    this.sourceQueue.push(track);
    this.republish();
  }

  /** Clear upcoming queue items after current playing track. */
  clearUpcomingQueue(): void {
    if (this.queueIndex >= 0 && this.queue.length > this.queueIndex + 1) {
      this.queue = this.queue.slice(0, this.queueIndex + 1);
      this.republish();
    }
  }

  /** Explicit stop: playback ends AND currentTrack is cleared (Mini Player hides). */
  async stop(): Promise<void> {
    this.deps.prefetch?.schedule(null);
    await this.deps.orchestrator.stopPlayback();
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = -1;
    this.sourceQueue = [];
    this.shuffledOrder = null;
    this.publish({
      currentTrack: null,
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

  private republish(): void {
    const next: PlayerSnapshot = {
      currentTrack: this.currentTrack,
      status: this.engineState.status,
      positionMs: this.engineState.positionMs,
      durationMs: this.engineState.durationMs,
      errorMessage: this.engineState.errorMessage,
      hasNext: this.queueIndex >= 0 && this.queueIndex < this.queue.length - 1,
      hasPrevious: this.queueIndex > 0,
      queue: this.queue,
      queueIndex: this.queueIndex,
      shuffleEnabled: this.shuffleEnabled,
      repeatMode: this.repeatMode,
    };
    this.publish(next);
  }

  private publish(next: PlayerSnapshot): void {
    if (this.snapshotEquals(next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private snapshotEquals(next: PlayerSnapshot): boolean {
    const prev = this.snapshot;
    return (
      prev.currentTrack === next.currentTrack &&
      prev.status === next.status &&
      prev.positionMs === next.positionMs &&
      prev.durationMs === next.durationMs &&
      prev.errorMessage === next.errorMessage &&
      prev.hasNext === next.hasNext &&
      prev.hasPrevious === next.hasPrevious &&
      prev.queue === next.queue &&
      prev.queueIndex === next.queueIndex &&
      prev.shuffleEnabled === next.shuffleEnabled &&
      prev.repeatMode === next.repeatMode
    );
  }
}
