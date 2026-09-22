import type { StreamProvider } from '../types';

/**
 * Contract for ONLINE stream resolution (remote catalogue → playable
 * stream). INTERFACE ONLY — deliberately unimplemented.
 *
 * How online streams are obtained is the core undecided provider
 * question (docs/PROVIDERS.md §13); no extraction, no API calls, and
 * no placeholder URIs may be added here until that decision is made.
 */
export interface OnlineStreamProvider extends StreamProvider {
  readonly id: 'online';
}
