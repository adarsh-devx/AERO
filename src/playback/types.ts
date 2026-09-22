import type { ResolvedStream } from '../providers/stream/types';
import type { Track } from '../core/types/track';

/** High-level playback status exposed by the engine. */
export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'stopped' | 'error';

/** Repeat behavior applied at queue-completion boundaries. */
export type RepeatMode = 'off' | 'queue' | 'one';

/** Observable playback state snapshot. */
export interface PlaybackState {
  readonly status: PlaybackStatus;
  /** Currently loaded track, if any. */
  readonly trackId: string | null;
  /** Position in the loaded stream, in milliseconds (when known). */
  readonly positionMs: number | null;
  /** Duration of the loaded stream, in milliseconds (when known). */
  readonly durationMs: number | null;
  /** Populated when status is 'error'; otherwise null. */
  readonly errorMessage: string | null;
  /** True when the loaded track has reached natural completion. */
  readonly didJustFinish?: boolean;
}

/**
 * Playback-engine boundary.
 *
 * The engine consumes ResolvedStreams and is deliberately blind to
 * where they came from: one pipeline for online and local audio.
 */
export interface PlaybackEngine {
  /** Subscribe to state updates. Returns an unsubscribe function. */
  onStateChange(listener: (state: PlaybackState) => void): () => void;

  /** Load a resolved stream with optional metadata for lock screen & notifications. */
  load(stream: ResolvedStream, track?: Track): Promise<void>;

  /** Begin playback of the loaded stream. */
  play(): Promise<void>;

  /** Pause the loaded stream. */
  pause(): Promise<void>;

  /** Seek to an absolute position in milliseconds. */
  seek(positionMs: number): Promise<void>;

  /** Stop playback and release the loaded stream. */
  stop(): Promise<void>;
}
