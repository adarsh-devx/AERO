import type { Track } from '../../../core/types/track';
import { NativeModuleUnavailableError, PermissionDeniedError } from '../../../core/errors';
import { localAudioSource, type LocalAudioSource } from '../../../native/localMedia';
import type { LocalMusicProvider } from './types';

/**
 * Real local-device music provider.
 *
 * Flow: permission check → (request if needed) → MediaStore via the
 * native LocalMedia module → Track[] with origin 'local'. No file
 * paths, no network, no MediaStore specifics above the native
 * boundary.
 *
 * Deliberately throws (never returns []) on denied permission or an
 * unavailable native module — a denied permission must not look like
 * an empty library.
 */
export class DeviceMusicProvider implements LocalMusicProvider {
  readonly id = 'local' as const;

  constructor(private readonly source: LocalAudioSource = localAudioSource) {}

  async search(query: string): Promise<Track[]> {
    const entries = await this.loadEntries();
    const needle = query.trim().toLowerCase();

    console.log('[SEARCH] provider=local query=', query, 'entries count=', entries.length);

    const matched = needle.length === 0
      ? entries
      : entries.filter((entry) => {
          const haystacks = [entry.title, entry.artist, entry.album];
          return haystacks.some((field) => field?.toLowerCase().includes(needle));
        });

    // Count only. Serialising every matched title with JSON.stringify was a
    // synchronous, library-sized allocation on this promise's resolve path,
    // i.e. work the caller was waiting on before it could see any results.
    console.log('[SEARCH] provider=local matched count=', matched.length);

    return matched.map((entry) => ({
      id: entry.trackId,
      title: entry.title,
      artist: entry.artist ?? 'Unknown artist',
      album: entry.album ?? undefined,
      durationMs: entry.durationMs,
      origin: 'local' as const,
    }));
  }

  private async loadEntries() {
    if (!this.source.isAvailable()) {
      throw new NativeModuleUnavailableError('LocalMedia');
    }
    if (!(await this.source.hasAudioPermission())) {
      const granted = await this.source.requestAudioPermission();
      if (!granted) {
        throw new PermissionDeniedError('Local audio permission was denied by the user.');
      }
    }
    return this.source.getAudioEntries();
  }
}
