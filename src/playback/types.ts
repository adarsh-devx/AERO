import type { ResolvedStream, StreamMetadata } from '../providers/stream/types';
import type { Track } from '../core/types/track';

/**
 * Cancellation handle for ONE playback request.
 *
 * `playTrack` is asynchronous end-to-end (stream resolution, native load), so
 * two requests can overlap: a slow resolve for track B may still be running
 * when the user has already selected track C. The requester owns the token and
 * answers `isCancelled()`; the orchestration must then drop the request without
 * touching the playback engine, so a stale resolve can never hijack the audio
 * of a newer selection.
 *
 * Deliberately NOT an AbortSignal: Aero's stream resolution has no abort seam
 * (the native NewPipe call takes no cancellation), and the token only guards the
 * load/play step that follows resolution.
 */
export interface PlaybackRequest {
  /** True once a newer selection has superseded this request. */
  readonly isCancelled: () => boolean;
  /**
   * Session-restore resume position. Applied by the orchestrator AFTER the
   * engine has loaded the stream and BEFORE play() — so the engine is never
   * seeked while unloaded and audio starts at the saved spot. Absent for
   * ordinary playback. Never derived from a persisted stream URL.
   */
  readonly startAtMs?: number;
}

/** High-level playback status exposed by the engine. */
export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'stopped' | 'error';

/** Repeat behavior applied at queue-completion boundaries. */
export type RepeatMode = 'off' | 'queue' | 'one';

/**
 * Observable state of the PLAYBACK ENGINE — what the engine has actually
 * loaded and is reporting.
 *
 * Deliberately distinct from two neighbouring concepts:
 * - CURRENT TRACK (`PlayerSnapshot.currentTrack`): what the user selected and
 *   what the UI must display — may exist before ANY engine state does;
 * - STREAM (`ResolvedStream`): the resolved playable source handed to the
 *   engine, never exposed through either snapshot.
 * `engineTrackId` names the engine side explicitly so the two tracks can never
 * be conflated by callers.
 */
export interface PlaybackState {
  readonly status: PlaybackStatus;
  /** Id of the track the ENGINE has loaded (not the user's selection). */
  readonly engineTrackId: string | null;
  /** Position in the loaded stream, in milliseconds (when known). */
  readonly positionMs: number | null;
  /** Duration of the loaded stream, in milliseconds (when known). */
  readonly durationMs: number | null;
  /** Populated when status is 'error'; otherwise null. */
  readonly errorMessage: string | null;
  /** True when the loaded track has reached natural completion. */
  readonly didJustFinish?: boolean;
  /** Real metadata of the stream currently loaded in the engine. */
  readonly activeStream?: StreamMetadata | null;
  /**
   * The audible player volume the engine is applying (0.0–1.0) —
   * ExoPlayer's mixer level, distinct from the device's STREAM_MUSIC
   * volume. Defaults to 1.0 (full scale); Aero deliberately applies no
   * gain above it. The engine is the only writer.
   */
  readonly volume?: number;
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

  /**
   * Set the audible player volume (clamped to 0.0–1.0) through the player's
   * own mixer-level volume (ExoPlayer `setVolume` under the hood). This is
   * REAL playback gain: audio already playing changes audibly immediately.
   * Player-level state — it survives media replacement, pause/resume,
   * background playback and lock-screen operation, and audio-focus
   * transitions (expo-audio restores the last set value on focus gain).
   * Never touches position, queue or metadata, and never boosts
   * above 1.0: full scale is the ceiling.
   */
  setVolume(volume: number): void;

  /** Stop playback and release the loaded stream. */
  stop(): Promise<void>;
}

