import type { Track } from '../../../core/types/track';

/**
 * Song-identification result model (internal — never rendered verbatim,
 * never persisted).
 *
 * HONESTY CONTRACT: Instagram exposes no official API for "the song
 * behind this Reel". Identification therefore only ever reports what a
 * legitimate source actually provided:
 *  - there is NO confidence model and NO numeric score anywhere;
 *  - 'matched' means ONE unambiguous candidate after conservative
 *    normalised title/artist comparison — not a probabilistic guess;
 *  - 'ambiguous' means the user must choose; nothing auto-plays;
 *  - 'unavailable' means the platform/public page did not expose enough
 *    song information (or could not be read) — the feature says so
 *    instead of fabricating a result.
 */

/**
 * Where a song clue came from. 'instagram-metadata': standard public HTML
 * metadata of the Reel page (Open Graph tags or a music-note caption
 * attribution) — best effort, page-authored, NOT platform audio data.
 * 'shared-text': words the user shared alongside the URL — a search clue
 * only, never claimed to have come from Instagram.
 */
export type IdentificationSource = 'instagram-metadata' | 'shared-text';

/**
 * A song clue — a SEARCH HINT, not verified metadata. `title` doubles as
 * the search query when no artist was discerned from the source text.
 */
export interface SongClue {
  readonly title: string;
  readonly artist?: string;
  readonly source: IdentificationSource;
}

/** Why a song could not even be looked for. */
export type UnavailableReason =
  /** The public Reel page exposed no recognizable song information. */
  | 'no-public-metadata'
  /** The public page or the music-provider search could not be reached. */
  | 'network';

/**
 * Result of identifying the song behind one Instagram Reel and matching
 * it against Aero's existing music providers (search → conservative
 * comparison → Track). Identification ends HERE: no stream is resolved,
 * nothing is played until the caller acts on a 'matched' track or the
 * user explicitly picks from 'ambiguous' candidates.
 */
export type SongIdentificationResult =
  /** Exactly one unambiguous candidate — safe to play through the normal path. */
  | { readonly status: 'matched'; readonly clue: SongClue; readonly track: Track }
  /** Several plausible candidates — the user chooses; nothing auto-plays. */
  | {
      readonly status: 'ambiguous';
      readonly clue: SongClue;
      readonly candidates: readonly Track[];
    }
  /** A real clue existed, but no provider result resembled it. */
  | { readonly status: 'not-found'; readonly clue: SongClue }
  /** No legitimate song information was obtainable — honest failure. */
  | { readonly status: 'unavailable'; readonly reason: UnavailableReason };
