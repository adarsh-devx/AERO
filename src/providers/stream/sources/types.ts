import type { Track } from '../../../core/types/track';
import type { ResolvedStream } from '../types';

/**
 * Single stream source in the resolution chain (NØTE architecture).
 */
export interface StreamSource {
  readonly id: string;

  /** Checks whether this source can attempt resolution for the track. */
  canHandle(track: Track): boolean;

  /** Resolves the track into a playable stream. Returns null if this source cannot resolve it. */
  resolve(track: Track): Promise<ResolvedStream | null>;
}

