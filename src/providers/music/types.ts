import type { Track } from '../../core/types/track';

/**
 * Discovery-provider boundary (implemented by `providers/music/local` and
 * `providers/music/online`; orchestrated by MusicService).
 *
 * Exists so the MusicService and UI can depend on this shape and never
 * on a concrete provider. Search is required; suggestions are an optional
 * capability a provider may add when it genuinely has an autocomplete source.
 */
export interface MusicProvider {
  /** Stable identifier for this provider (e.g. 'local', 'online'). */
  readonly id: string;

  /** Search the provider catalogue. Must be non-blocking; errors reject. */
  search(query: string): Promise<Track[]>;

  /**
   * OPTIONAL search-bar autocomplete for this provider: candidate queries for
   * what the user is typing, in display order.
   *
   * Only providers that genuinely have a suggestion source implement it (the
   * online/InnerTube provider does; a device scan has nothing to suggest), so
   * callers must treat its absence as "no suggestions from this provider"
   * rather than as a failure. Must be non-blocking; errors reject.
   *
   * Returns query strings, not Tracks: a suggestion is a search Aero has not
   * run yet, and resolving it into playable tracks is exactly what search()
   * already does once the user picks one.
   */
  suggestions?(query: string): Promise<string[]>;

  /**
   * OPTIONAL direct lookup of ONE catalogue item by its provider id —
   * the capability shared links need (a YouTube video id from an Android
   * share intent must become a real Track without a search guess).
   *
   * Only providers that can genuinely identify a single item implement it;
   * callers must treat its absence as "this provider cannot resolve ids"
   * rather than as a failure. Contract:
   *
   *  - resolves the EXISTING Track type for exactly this id;
   *  - resolves null when the id is well-formed but cannot be identified —
   *    never a different or guessed item;
   *  - rejects only on provider/network failure, so callers can tell
   *    "not found" from "could not load".
   *
   * Discovery only: this produces metadata, never audio — stream
   * resolution stays behind the stream layer.
   */
  getTrack?(id: string): Promise<Track | null>;

  /**
   * OPTIONAL real loudness metadata for ONE catalogue item — the
   * provider-side source for Aero's loudness normalization (the pure
   * loudness→gain math lives in `playback/loudnessNormalization.ts`; the
   * application lives in the playback engine, never in screens).
   *
   * Only providers with a genuine loudness source implement it; callers
   * must treat its absence — or a null answer — as "no normalization for
   * this track" rather than as a failure. Contract:
   *
   *  - resolves the source's REAL loudness for exactly this id in the
   *    source's own documented unit (for the InnerTube player endpoint:
   *    the `loudnessDb` deviation in dB from YouTube's -14 LUFS target);
   *  - resolves null when the source has no usable value for this id;
   *  - never rejects (source/network/parse failures resolve null);
   *  - never invents a value: local sources without loudness metadata
   *    return null instead of fabricating one.
   */
  getTrackLoudnessDb?(id: string): Promise<number | null>;
}

