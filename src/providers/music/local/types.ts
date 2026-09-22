import type { MusicProvider } from '../types';

/**
 * Contract for the LOCAL device (MediaStore) music provider.
 *
 * The concrete implementation lives in `LocalMusicProvider.ts`
 * (DeviceMusicProvider) and reaches Android MediaStore only through
 * the `src/native/localMedia.ts` boundary — never directly.
 */
export interface LocalMusicProvider extends MusicProvider {
  readonly id: 'local';
}

