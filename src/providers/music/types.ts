import type { Track } from '../../core/types/track';

/**
 * Discovery-provider boundary. DEFINED ONLY — no implementation exists
 * and the remote provider itself is undecided (docs/PROVIDERS.md §13).
 *
 * Exists so the MusicService and UI can depend on this shape and never
 * on a concrete provider. Concrete contracts live in `local/` and
 * `online/`.
 */
export interface MusicProvider {
  /** Stable identifier for this provider (e.g. 'local', 'online'). */
  readonly id: string;

  /** Search the provider catalogue. Must be non-blocking; errors reject. */
  search(query: string): Promise<Track[]>;

  // TBD: getTrack(id) — add only when a feature actually needs to
  // re-fetch a single track by id (e.g. deep-link resolution).
}

