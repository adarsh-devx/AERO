import type { MusicProvider } from '../types';

/**
 * Contract for an ONLINE (remote catalogue) music provider.
 * INTERFACE ONLY — deliberately unimplemented.
 *
 * The concrete provider (YouTube-family, other catalogue services) is
 * an undecided product/policy decision (docs/PROVIDERS.md §13). No
 * implementation, API calls, or extraction may be added here until
 * that decision and its distribution implications are recorded.
 */
export interface OnlineMusicProvider extends MusicProvider {
  readonly id: 'online';
}
