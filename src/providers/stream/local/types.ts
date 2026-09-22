import type { StreamProvider } from '../types';

/**
 * Contract for LOCAL stream resolution (device file → playable
 * stream). INTERFACE ONLY — deliberately unimplemented.
 *
 * MediaStore file descriptors/content URIs and permission handling
 * arrive with the local-library implementation step.
 */
export interface LocalStreamProvider extends StreamProvider {
  readonly id: 'local';
}
