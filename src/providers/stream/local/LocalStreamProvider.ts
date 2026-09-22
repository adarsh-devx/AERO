import type { Track } from '../../../core/types/track';
import type { ResolvedStream, StreamProvider } from '../types';

/**
 * Real local stream resolution: MediaStore _ID → playable content URI.
 *
 * The URI format is Android's official MediaStore audio content URI
 * (content://media/external/audio/media/<id>), valid on all supported
 * API levels and directly consumable by ExoPlayer/Media3. No
 * filesystem paths, no file copies, no network access.
 */
export class LocalFileStreamProvider {
  readonly id = 'local' as const;

  async resolve(track: Track): Promise<ResolvedStream> {
    if (!/^\d+$/.test(track.id)) {
      throw new Error(
        `Track "${track.id}" is not a local MediaStore track; only numeric MediaStore ids can be resolved locally.`,
      );
    }
    return {
      trackId: track.id,
      uri: `content://media/external/audio/media/${track.id}`,
    };
  }
}

// Type-conformance check without exporting a redundant alias.
const _conformance: StreamProvider = new LocalFileStreamProvider();
void _conformance;
