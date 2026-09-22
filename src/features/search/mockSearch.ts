import type { Track } from '../../core/types/track';

/**
 * MOCK / DEMO DATA — not from any API or provider.
 *
 * Clearly local-only, used solely to demonstrate the search UI states.
 * This is NOT a provider implementation and must be deleted when a real
 * MusicSearchProvider is connected (see docs/PROVIDERS.md — decision pending).
 */
export const MOCK_TRACKS: Track[] = [
  { id: 'mock-1', title: 'Midnight Demo Drive', artist: 'The Placeholders' },
  { id: 'mock-2', title: 'Skeleton in the Code', artist: 'State Machine' },
  { id: 'mock-3', title: 'Await the Sunrise', artist: 'Async & The Promises' },
  { id: 'mock-4', title: 'Refactor Blues', artist: 'The Strict Typists' },
];

/**
 * Demo-only mock "search": filters MOCK_TRACKS by substring.
 * Deliberately NOT behind the MusicSearchProvider interface — do not
 * build provider architecture around this.
 */
export function mockSearch(query: string): Promise<Track[]> {
  const needle = query.trim().toLowerCase();
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(MOCK_TRACKS.filter((t) => t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle)));
    }, 500);
  });
}
