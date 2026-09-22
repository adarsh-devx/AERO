import type { Track } from '../../core/types/track';

/** Lifecycle of a search run. */
export type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Search feature state model. Owned by SearchScreen (local state for now);
 * no global store until cross-feature state genuinely appears.
 */
export interface SearchState {
  /** Current input text. Kept separate from the submitted query. */
  query: string;
  /** The query the current `results` correspond to. */
  submittedQuery: string;
  status: SearchStatus;
  results: Track[];
  /** Present only when status is 'error'. Human-readable message. */
  errorMessage: string | null;
}

export const INITIAL_SEARCH_STATE: SearchState = {
  query: '',
  submittedQuery: '',
  status: 'idle',
  results: [],
  errorMessage: null,
};
