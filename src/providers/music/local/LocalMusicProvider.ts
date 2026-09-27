import type { Track, TrackCredit } from '../../../core/types/track';
import {
  normalizeMetadataText,
  normalizeReleaseDate,
} from '../../../core/types/track';
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

    const matched = needle.length === 0
      ? entries
      : entries.filter((entry) => {
          const haystacks = [entry.title, entry.artist, entry.album];
          return haystacks.some((field) => field?.toLowerCase().includes(needle));
        });

    return matched.map((entry) => {
      // Enriched tag metadata: each field is included ONLY when genuinely
      // present — an unknown year/composer/track stays an absent field,
      // never a placeholder. Display-only: playback identity still comes
      // from origin + id alone.
      const composer = normalizeMetadataText(entry.composer);
      const credits: TrackCredit[] | undefined = composer
        ? [{ role: 'composer', name: composer }]
        : undefined;
      const releaseDate = normalizeReleaseDate(entry.year);
      return {
        id: entry.trackId,
        title: entry.title,
        artist: entry.artist ?? 'Unknown artist',
        album: entry.album ?? undefined,
        albumId: entry.albumId ?? undefined,
        durationMs: entry.durationMs,
        origin: 'local' as const,
        ...(entry.trackNumber !== null ? { trackNumber: entry.trackNumber } : {}),
        ...(entry.discNumber !== null ? { discNumber: entry.discNumber } : {}),
        ...(releaseDate !== undefined ? { releaseDate } : {}),
        ...(credits ? { credits } : {}),
      };
    });
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
