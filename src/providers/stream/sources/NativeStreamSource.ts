import type { Track } from '../../../core/types/track';
import { NativeModuleUnavailableError } from '../../../core/errors';
import { getStreamResolutionModule } from '../../../../modules/stream-resolution';
import type { ResolvedStream } from '../types';
import type { StreamSource } from './types';
import { sanitizeStreamHost } from '../streamUtils';

/**
 * NativeStreamSource: Resolves online YouTube tracks using the native Android
 * StreamResolution module (backed by NewPipeExtractor).
 */
export class NativeStreamSource implements StreamSource {
  readonly id = 'native';

  canHandle(track: Track): boolean {
    return track.origin === 'online' || track.id.startsWith('yt:') || !/^\d+$/.test(track.id);
  }

  async resolve(track: Track): Promise<ResolvedStream | null> {
    if (!this.canHandle(track)) {
      return null;
    }

    const nativeModule = getStreamResolutionModule();
    if (!nativeModule) {
      throw new NativeModuleUnavailableError('StreamResolution');
    }

    const result = await nativeModule.resolveStreamAsync(track.id);

    if (!result?.uri) {
      throw new Error(`Native stream resolution returned empty URI for track ${track.id}`);
    }

    const sanitizedHost = sanitizeStreamHost(result.uri);

    return {
      trackId: track.id,
      uri: result.uri,
      mimeType: result.mimeType,
      // Replay the extractor's User-Agent when fetching, or the CDN rejects it.
      headers: result.userAgent ? { 'User-Agent': result.userAgent } : undefined,
      metadata: {
        sourceType: 'online',
        mimeType: result.mimeType,
        format: result.format && result.format !== 'unknown' ? result.format.toUpperCase() : undefined,
        bitrate: typeof result.bitrate === 'number' && result.bitrate > 0 ? result.bitrate : undefined,
        sanitizedHost,
        deliveryMethod: 'Progressive HTTP (NewPipe)',
      },
    };
  }
}


