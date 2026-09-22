import type { Track } from '../../../core/types/track';
import type { ResolvedStream } from '../types';
import type { StreamSource } from './types';

/**
 * EndpointStreamSource: Resolves tracks via a remote endpoint if one is configured.
 */
export class EndpointStreamSource implements StreamSource {
  readonly id = 'endpoint';

  constructor(private readonly endpointUrl?: string) {}

  canHandle(track: Track): boolean {
    return Boolean(this.endpointUrl) && track.origin === 'online';
  }

  async resolve(track: Track): Promise<ResolvedStream | null> {
    if (!this.canHandle(track) || !this.endpointUrl) {
      return null;
    }

    const cleanId = track.id.replace(/^yt:/, '');
    const url = `${this.endpointUrl.replace(/\/$/, '')}/resolve?id=${encodeURIComponent(cleanId)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Endpoint stream resolution failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data?.uri) {
      throw new Error(`Endpoint stream resolution returned invalid response for track ${track.id}`);
    }

    return {
      trackId: track.id,
      uri: data.uri,
      mimeType: data.mimeType ?? 'audio/mp4',
    };
  }
}

