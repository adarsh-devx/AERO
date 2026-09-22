import type { Track } from '../../../core/types/track';
import type { ResolvedStream } from '../types';
import type { OnlineStreamProvider } from './types';
import type { StreamSource } from '../sources/types';
import { DirectStreamSource } from '../sources/DirectStreamSource';
import { NativeStreamSource } from '../sources/NativeStreamSource';
import { EndpointStreamSource } from '../sources/EndpointStreamSource';

/**
 * YouTubeStreamProvider: Concrete OnlineStreamProvider that resolves online tracks
 * through a chain of StreamSources (Direct → Native → Endpoint) following the NØTE architecture.
 */
export class YouTubeStreamProvider implements OnlineStreamProvider {
  readonly id = 'online' as const;

  private readonly sources: readonly StreamSource[];

  constructor(customSources?: readonly StreamSource[]) {
    this.sources = customSources ?? [
      new DirectStreamSource(),
      new NativeStreamSource(),
      new EndpointStreamSource(),
    ];
  }

  async resolve(track: Track): Promise<ResolvedStream> {
    let lastError: Error | null = null;

    for (const source of this.sources) {
      if (source.canHandle(track)) {
        try {
          const stream = await source.resolve(track);
          if (stream) {
            return stream;
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`[STREAM_RESOLVER] Source ${source.id} failed:`, lastError.message);
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error(`Unable to resolve stream for online track "${track.title}" (${track.id}).`);
  }
}

