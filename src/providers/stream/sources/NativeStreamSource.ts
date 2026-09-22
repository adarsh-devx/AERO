import type { Track } from '../../../core/types/track';
import { NativeModuleUnavailableError } from '../../../core/errors';
import { getStreamResolutionModule } from '../../../../modules/stream-resolution';
import type { ResolvedStream } from '../types';
import type { StreamSource } from './types';

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

    console.log('[STREAM_RESOLVER] NativeStreamSource resolving track:', track.id, track.title);
    const result = await nativeModule.resolveStreamAsync(track.id);

    if (!result?.uri) {
      throw new Error(`Native stream resolution returned empty URI for track ${track.id}`);
    }

    console.log('[STREAM_RESOLVER] NativeStreamSource resolved URI successfully (mimeType=' + result.mimeType + ')');

    return {
      trackId: track.id,
      uri: result.uri,
      mimeType: result.mimeType,
      // Replay the extractor's User-Agent when fetching, or the CDN rejects it.
      headers: result.userAgent ? { 'User-Agent': result.userAgent } : undefined,
    };
  }
}

