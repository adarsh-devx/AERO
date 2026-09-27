import type { Track } from '../../../core/types/track';
import type { ResolvedStream } from '../types';
import type { StreamSource } from './types';
import { sanitizeStreamHost } from '../streamUtils';

/**
 * DirectStreamSource: Resolves tracks that already contain a direct playable URL.
 */
export class DirectStreamSource implements StreamSource {
  readonly id = 'direct';

  canHandle(track: Track): boolean {
    return typeof track.id === 'string' && (
      track.id.startsWith('http://') ||
      track.id.startsWith('https://') ||
      track.id.startsWith('file://') ||
      track.id.startsWith('content://')
    );
  }

  async resolve(track: Track): Promise<ResolvedStream | null> {
    if (!this.canHandle(track)) {
      return null;
    }
    const uri = track.id;
    const isLocal = uri.startsWith('content://') || uri.startsWith('file://');
    return {
      trackId: track.id,
      uri,
      metadata: {
        sourceType: isLocal ? 'local' : 'online',
        sanitizedHost: sanitizeStreamHost(uri),
        deliveryMethod: isLocal ? 'Local Media URI' : 'Direct Stream URL',
      },
    };
  }
}


