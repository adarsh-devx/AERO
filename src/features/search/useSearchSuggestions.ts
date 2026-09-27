import { useEffect, useRef, useState } from 'react';

import { musicService } from '../../services/composition';
import { useSettings } from '../settings/useSettings';

/**
 * How long the input must be quiet before the provider suggestion RPC is
 * asked. Long enough that a normal typing burst costs one request instead of
 * one per keystroke, short enough that suggestions feel immediate.
 */
export const SUGGESTION_DEBOUNCE_MS = 250;

export interface SearchSuggestions {
  /** Suggestion queries for the current input, in provider order. */
  readonly suggestions: readonly string[];
  /** True while a suggestion request for the current input is outstanding. */
  readonly loading: boolean;
  /**
   * True once a response (success OR failure) for the CURRENT input has
   * been applied. Lets the UI distinguish "settled, nothing to show" from
   * "haven't asked yet" (the debounce window) — so an honest
   * "No suggestions" hint never flashes before the request has run.
   */
  readonly settled: boolean;
}

const NO_SUGGESTIONS: readonly string[] = [];

/**
 * Debounced search-bar suggestions for the online provider.
 *
 * Contract:
 * - the RPC is only asked once the input has been still for
 *   SUGGESTION_DEBOUNCE_MS, so typing never fires per-keystroke requests;
 * - only the newest request may update state: each effect run owns an id, and a
 *   response whose id is no longer the latest is dropped, so a slow answer for
 *   "bli" can never replace the suggestions for "blinding";
 * - an empty/whitespace input clears the suggestions and issues no request;
 * - the "Search suggestions" setting gates the whole flow: while it is
 *   off no request is issued and the list stays empty (reactive — flips
 *   apply without a restart);
 * - a query whose suggestions are already on screen is not re-requested;
 * - failures are silent (suggestions are an enhancement): the UI simply keeps
 *   whatever it had, and the full search a tap triggers reports its own errors.
 *
 * The network-side cache and in-flight de-duplication live in the provider
 * (YouTubeMusicProvider.suggestions), so they are shared by every caller instead
 * of being duplicated per hook.
 */
export function useSearchSuggestions(rawQuery: string): SearchSuggestions {
  const query = rawQuery.trim();
  const [state, setState] = useState<{
    suggestions: readonly string[];
    loading: boolean;
  }>({
    suggestions: NO_SUGGESTIONS,
    loading: false,
  });

  /** Id of the latest effect run; responses carrying an older id are stale. */
  const requestIdRef = useRef(0);
  /** Query the currently displayed suggestions belong to (repeat suppression). */
  const answeredQueryRef = useRef<string | null>(null);

  // Search suggestions can be switched off in Settings; this component
  // re-renders the moment the persisted value changes.
  const { searchSuggestionsEnabled } = useSettings();

  useEffect(() => {
    // Invalidate anything in flight first: the newest input always wins.
    const requestId = (requestIdRef.current += 1);

    if (!searchSuggestionsEnabled || query.length === 0) {
      answeredQueryRef.current = null;
      setState((current) =>
        current.suggestions.length === 0 && !current.loading
          ? current
          : { suggestions: NO_SUGGESTIONS, loading: false },
      );
      return;
    }

    // Already showing this exact query's suggestions: nothing to do.
    if (answeredQueryRef.current === query) return;

    const timer = setTimeout(() => {
      setState((current) => (current.loading ? current : { suggestions: current.suggestions, loading: true }));
      void musicService.suggestions(query).then(
        (suggestions) => {
          if (requestId !== requestIdRef.current) return; // stale answer
          answeredQueryRef.current = query;
          setState({ suggestions, loading: false });
        },
        () => {
          if (requestId !== requestIdRef.current) return; // stale failure
          answeredQueryRef.current = query;
          setState({ suggestions: NO_SUGGESTIONS, loading: false });
        },
      );
    }, SUGGESTION_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, searchSuggestionsEnabled]);

  return {
    ...state,
    // Derived, not stored: the ref is bumped exactly when a response for
    // THIS input lands (or the input is cleared/disabled), so the first
    // render after a keystroke already reads `settled: false`.
    settled:
      query.length > 0 &&
      searchSuggestionsEnabled &&
      answeredQueryRef.current === query,
  };
}
