import type { Track } from '../../core/types/track';
import { trackIdentityKey } from '../../core/types/track';
import type { PlayerController } from '../../playback/PlayerController';

export type SleepTimerMode = 'duration' | 'end-of-track';

/** The whole timer state — also the React snapshot (stable reference). */
export interface SleepTimerSnapshot {
  /** null when no timer is armed. Never more than ONE timer at a time. */
  readonly mode: SleepTimerMode | null;
  /** Absolute wall-clock deadline for duration mode (never a tick count). */
  readonly expiresAt: number | null;
  /**
   * Derived from the deadline (`max(0, expiresAt - Date.now())`), refreshed
   * on the store's tick for display only — expiration itself always compares
   * against `expiresAt`, never against this value or tick counts.
   */
  readonly remainingMs: number | null;
  /** End-of-track mode: identity (origin:id) of the ONE attached track. */
  readonly trackKey: string | null;
}

/**
 * Custom-duration bounds (integer minutes). 1 minute is the smallest
 * meaningful timer; 3 hours is a generous sleep-timer ceiling — long enough
 * for any real use, small enough that an accidental entry is obvious.
 */
export const SLEEP_TIMER_MIN_CUSTOM_MINUTES = 1;
export const SLEEP_TIMER_MAX_CUSTOM_MINUTES = 180;
export const SLEEP_TIMER_MAX_DURATION_MS = SLEEP_TIMER_MAX_CUSTOM_MINUTES * 60_000;

/** Preset durations offered by the sheet (integer minutes). */
export const SLEEP_TIMER_PRESET_MINUTES: readonly number[] = [15, 30, 45, 60];

const EMPTY_SLEEP_TIMER: SleepTimerSnapshot = {
  mode: null,
  expiresAt: null,
  remainingMs: null,
  trackKey: null,
};

/** UI refresh cadence while a duration timer counts down (1 s → minute-fresh). */
const TICK_INTERVAL_MS = 1_000;

/**
 * Sleep-fade window: the final 60 s of a duration timer — and the final
 * 60 s of the attached track for end-of-track — fade the user's volume
 * linearly to 0. Driven by the SAME tick (no second timer system).
 */
const VOLUME_FADE_WINDOW_MS = 60_000;

/**
 * SleepTimer: the ONE owner of sleep-timer state — transient, in-memory,
 * deliberately NOT persisted (no storage key): a timer must never resurrect
 * after a restart, and a countdown has no durable value (§21).
 *
 * Architecture:
 *
 *   Now Playing UI → this store → PlayerController → existing engine
 *
 * The store never touches the engine, MediaSession or Android APIs. It
 * controls playback exclusively through the PlayerController public API
 * (pause/stop, plus setVolume for the end-of-fade restore), and
 * end-of-track interception runs inside the controller's
 * own natural-completion lifecycle via the injected `consumeNaturalCompletion`
 * gate — before repeat/queue/autoplay continuation.
 *
 * Duration mode is deadline-based: `expiresAt = Date.now() + durationMs`
 * is written once at arm time; a lightweight interval only refreshes the
 * display and compares the CURRENT time against that absolute deadline, so
 * background throttling can delay a wake but can never drift or mis-count
 * it, and no time is ever persisted per tick.
 *
 * Race safety: every arm/cancel/consume/expire bumps a generation token; a
 * tick callback carries the generation it was created under and a stale one
 * is ignored, so a cancelled or replaced timer can never fire, and exactly
 * one expiration action runs per timer. State is copy-on-write replace +
 * notify (subscribe/getSnapshot for useSyncExternalStore).
 */
export class SleepTimer {
  private readonly getPlayer: () => PlayerController | null;
  private readonly listeners = new Set<() => void>();
  private state: SleepTimerSnapshot = EMPTY_SLEEP_TIMER;
  private generation = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastNotifiedMinutes: number | null = null;
  /**
   * The user's volume, captured ONCE when a sleep fade begins and put
   * back on every teardown path (cancel, replace, completion, expiry).
   * null = no fade in progress. Lives with the rest of the transient
   * timer state — never persisted, so a restart can't resurrect it.
   */
  private fadeOriginalVolume: number | null = null;

  constructor(options: { getPlayer: () => PlayerController | null }) {
    // Late-bound getter, mirroring the composition pattern used for
    // autoplay: the PlayerController is constructed after this store and
    // the reference is only evaluated when a timer actually expires.
    this.getPlayer = options.getPlayer;
  }

  /** React external-store subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** React external-store snapshot: the current timer (stable reference). */
  getSnapshot = (): SleepTimerSnapshot => this.state;

  /**
   * Arms (or atomically REPLACES) a duration timer. Returns false when the
   * duration is not a valid integer within (0, SLEEP_TIMER_MAX_DURATION_MS]
   * — there is never a second active timer.
   */
  startDuration(durationMs: number): boolean {
    if (
      !Number.isInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > SLEEP_TIMER_MAX_DURATION_MS
    ) {
      return false;
    }
    this.stopTick();
    // Replacing an active (possibly mid-fade) timer: put the user's
    // volume back FIRST so the new fade captures a clean original.
    this.restoreOriginalVolume();
    this.generation += 1;
    const expiresAt = Date.now() + durationMs;
    this.lastNotifiedMinutes = Math.ceil(durationMs / 60_000);
    this.replace({ mode: 'duration', expiresAt, remainingMs: durationMs, trackKey: null });
    this.startTick();
    return true;
  }

  /**
   * Arms (or atomically replaces) an end-of-current-track timer attached to
   * THIS track's identity. Keeps playing normally — only the attached
   * track's natural completion consumes it (see consumeNaturalCompletion).
   */
  startEndOfTrack(track: Track): boolean {
    this.stopTick();
    this.restoreOriginalVolume();
    this.generation += 1;
    this.lastNotifiedMinutes = null;
    this.replace({
      mode: 'end-of-track',
      expiresAt: null,
      remainingMs: null,
      trackKey: trackIdentityKey(track),
    });
    // Same tick mechanism as duration mode: the end-of-track fade is
    // driven by the playhead, which only a tick can observe. In this mode
    // the tick never mutates this snapshot, so consumers still re-render
    // only when the timer itself changes.
    this.startTick();
    return true;
  }

  /**
   * Cancels the active timer: state cleared, tick stopped, generation
   * bumped. Never touches playback, queue, repeat/shuffle, history or
   * statistics — it only clears the timer itself.
   */
  cancel(): void {
    if (this.state.mode === null) return;
    this.stopTick();
    this.generation += 1;
    this.lastNotifiedMinutes = null;
    // Cancelling mid-fade must leave the user's volume exactly as it was.
    this.restoreOriginalVolume();
    this.replace(EMPTY_SLEEP_TIMER);
  }

  /**
   * The end-of-track completion gate, invoked by PlayerController when the
   * current track naturally completed — BEFORE repeat-one / repeat-queue /
   * next / autoplay. Returns true (consuming the completion) only when an
   * end-of-track timer is armed AND attached to exactly this track; the
   * timer then clears itself and playback stays ended. A duration timer, a
   * missing timer, or a different attached track returns false → normal
   * continuation runs unchanged.
   */
  consumeNaturalCompletion(track: Track): boolean {
    if (this.state.mode !== 'end-of-track') return false;
    if (this.state.trackKey !== trackIdentityKey(track)) return false;
    this.stopTick();
    this.generation += 1;
    this.lastNotifiedMinutes = null;
    // The track has ENDED (already silent): put the user's volume back so
    // a replay/next play is never muted by a completed fade.
    this.restoreOriginalVolume();
    this.replace(EMPTY_SLEEP_TIMER);
    return true;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private startTick(): void {
    // Capture the generation this interval belongs to: after any replace/
    // cancel bumps it, this callback becomes a no-op even if it was already
    // queued when the interval was cleared.
    const generation = this.generation;
    this.tickTimer = setInterval(() => {
      this.onTick(generation);
    }, TICK_INTERVAL_MS);
  }

  private stopTick(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private onTick(generation: number): void {
    if (generation !== this.generation) {
      this.stopTick();
      return;
    }
    const state = this.state;
    if (state.mode === null) {
      this.stopTick();
      return;
    }

    // End-of-track: the fade is driven by the PLAYHEAD (how much of the
    // attached track remains), evaluated fresh on every tick.
    if (state.mode === 'end-of-track') {
      this.fadeEndOfTrack();
      return;
    }

    if (state.expiresAt === null) {
      this.stopTick();
      return;
    }

    // Deadline comparison — NOT tick counting: a throttled or late wake
    // expires immediately here instead of drifting.
    const remainingMs = state.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.expire(generation);
      return;
    }

    // Sleep fade: the final 60 s reduce the user's volume linearly to 0 —
    // deterministic from the captured original and the remaining time (a
    // throttled background wake just lands on the level correct for now).
    if (remainingMs <= VOLUME_FADE_WINDOW_MS) {
      this.applyFade(remainingMs / VOLUME_FADE_WINDOW_MS);
    }

    // Display refresh at minute granularity: one re-render per minute, not
    // per tick.
    const minutes = Math.ceil(remainingMs / 60_000);
    if (minutes !== this.lastNotifiedMinutes) {
      this.lastNotifiedMinutes = minutes;
      this.replace({ ...state, remainingMs });
    }
  }

  // ── Volume fade ───────────────────────────────────────────────────────

  /**
   * Linear sleep-fade write through the ONE existing volume path
   * (PlayerController.setVolume → PlaybackEngine.setVolume → native mixer;
   * immediate, never persisted). The user's volume is captured ONCE when
   * the fade begins; every tick recomputes original × ratio — deterministic
   * from original volume + remaining time, no accumulated error.
   */
  private applyFade(ratio: number): void {
    const player = this.getPlayer();
    if (player === null) return;
    if (this.fadeOriginalVolume === null) {
      const current = player.getSnapshot().volume;
      this.fadeOriginalVolume = Number.isFinite(current) ? current : 1;
    }
    const clamped = Math.min(1, Math.max(0, ratio));
    player.setVolume(this.fadeOriginalVolume * clamped);
  }

  /**
   * End-of-track fade: the same 60 s window driven by the playhead — when
   * the attached track has ≤ 60 s left the volume fades toward 0 over
   * exactly what remains (a track shorter than the window fades over its
   * whole remainder). Before the window — or after a skip onto a longer
   * track — any active fade is released so playback returns to the user's
   * volume.
   */
  private fadeEndOfTrack(): void {
    const player = this.getPlayer();
    if (player === null) return;
    const snapshot = player.getSnapshot();
    if (snapshot.durationMs === null || snapshot.positionMs === null) {
      return; // loading/idle: nothing measurable yet, fade untouched
    }
    const trackRemainingMs = snapshot.durationMs - snapshot.positionMs;
    if (trackRemainingMs <= VOLUME_FADE_WINDOW_MS) {
      this.applyFade(trackRemainingMs / VOLUME_FADE_WINDOW_MS);
    } else {
      this.restoreOriginalVolume();
    }
  }

  /**
   * Puts the user's captured volume back through the same path and clears
   * the fade state. No-op when no fade is active — safe to call from every
   * teardown path (cancel, replace, completion, expiry).
   */
  private restoreOriginalVolume(): void {
    const original = this.fadeOriginalVolume;
    this.fadeOriginalVolume = null;
    if (original === null) return;
    const player = this.getPlayer();
    if (player === null) return;
    player.setVolume(original);
  }

  /**
   * Exactly one expiration action per timer:
   *  1. invalidate (generation + tick stopped) and clear the snapshot FIRST,
   *     so every indicator disappears immediately;
   *  2. act through the EXISTING PlayerController public API only —
   *     - 'playing'  → pause() (deterministic, never starts playback; keeps
   *                    queue/session/repeat/shuffle untouched),
   *     - 'loading'  → stop() (the only API that cancels an in-flight
   *                    selection, so a stream still resolving at the
   *                    deadline can never start audio),
   *     - anything else (paused/idle/stopped/error) → audio is already
   *       silent; the timer simply clears;
   *  3. any active volume fade is released (AFTER pause/stop land) so the
   *     user's configured volume survives the expiry untouched.
   * If playback already stopped before the deadline, this is a clean no-op.
   */
  private expire(generation: number): void {
    if (generation !== this.generation) return;
    if (this.state.mode !== 'duration') return;
    this.stopTick();
    this.generation += 1;
    this.lastNotifiedMinutes = null;
    this.replace(EMPTY_SLEEP_TIMER);

    const player = this.getPlayer();
    if (player === null) {
      this.restoreOriginalVolume();
      return;
    }
    const status = player.getSnapshot().status;
    if (status === 'playing') {
      void player
        .pause()
        .catch((error) => console.warn('[SLEEP_TIMER] could not pause playback.', error))
        // Restore ONLY after pause/stop landed: by then audio is silent,
        // so the user's configured volume survives the expiry untouched.
        .finally(() => this.restoreOriginalVolume());
    } else if (status === 'loading') {
      void player
        .stop()
        .catch((error) => console.warn('[SLEEP_TIMER] could not stop playback.', error))
        .finally(() => this.restoreOriginalVolume());
    } else {
      // Already silent (paused/idle/stopped/error): restore immediately.
      this.restoreOriginalVolume();
    }
  }

  private replace(next: SleepTimerSnapshot): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
