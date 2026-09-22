import type { Track } from '../core/types/track';

/** The seam the preloader needs — structurally satisfied by MusicService. */
export interface StreamPrefetchSeam {
  /** Best-effort check that a resolve could even be attempted. */
  canResolve(track: Track): boolean;
  /** Cached, unexpired stream, if one already exists. */
  peekStream(track: Track): ResolvedStreamHint | undefined;
  /** Resolves (populating the cache); must never start playback. */
  prefetchStream(track: Track): Promise<unknown>;
}

/** Structural type only; the real shape comes from the stream layer. */
type ResolvedStreamHint = unknown;

/**
 * Rolling next-track preloader (verified NØTE `preload.ts` parity).
 *
 * Only ever one track ahead is in flight. The queue decides *what*
 * should be warm; this decides *when* to stop caring about it.
 *
 * Aero limitation vs NØTE: Aero's StreamProvider.resolve() does not
 * accept an AbortSignal (the native module API has none), so cancel()
 * drops the obsolete request rather than aborting it mid-flight. The
 * wasted resolution still populates the cache and is cleaned up by the
 * resolver's TTL; it just cannot be interrupted. Nothing here can start
 * audio playback or change the current track.
 */
class PreloadManager {
  private targetId: string | null = null;

  /** Warm `track` unless it is already warm or already being warmed. */
  schedule(track: Track | null): void {
    const seam = this.seam;
    if (!track || !seam) {
      this.cancel();
      return;
    }

    // Already the active target: leave the in-flight request alone.
    if (this.targetId === track.id) return;

    // A different track is wanted now, so the previous one is obsolete.
    this.cancel();

    if (!seam.canResolve(track)) return;
    // Already cached and unexpired: nothing to do.
    if (seam.peekStream(track)) return;

    this.targetId = track.id;
    if (__DEV__) console.log('[preload] warming', track.title);

    void seam
      .prefetchStream(track)
      .catch(() => {
        // A preload failure is not a user-visible event: the track will be
        // resolved again (and the error surfaced) if it ever becomes current.
      })
      .finally(() => {
        // Only clear if this is still the active attempt.
        if (this.targetId === track.id) {
          this.targetId = null;
        }
      });
  }

  /**
   * Stop tracking a track that is becoming current, WITHOUT cancelling it:
   * the resolver's in-flight map hands playback the very same promise, so
   * adopting it means the play path awaits the one already-running resolve.
   */
  adopt(trackId: string | null): void {
    if (trackId && this.targetId === trackId) {
      this.targetId = null;
      return;
    }
    this.cancel();
  }

  /** Stop tracking an obsolete prefetch target. Safe to call repeatedly. */
  cancel(): void {
    if (__DEV__ && this.targetId) console.log('[preload] cancelled', this.targetId);
    this.targetId = null;
  }

  /** The track id currently being warmed, for diagnostics. */
  get pending(): string | null {
    return this.targetId;
  }

  /** Wiring point (composition root). */
  setSeam(seam: StreamPrefetchSeam): void {
    this.seam = seam;
  }

  private seam: StreamPrefetchSeam | null = null;
}

export const preloader = new PreloadManager();
