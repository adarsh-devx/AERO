import { requireNativeModule } from 'expo-modules-core';

/**
 * Raw entry shape returned by the native LocalMedia module.
 * Mirrors LocalMediaQueries.queryAudio() in Kotlin exactly.
 */
export interface NativeAudioEntry {
  /** Stable MediaStore _ID as a string. */
  trackId: string;
  title: string;
  /** null when MediaStore reports "<unknown>" or missing metadata. */
  artist: string | null;
  /** null when MediaStore reports "<unknown>" or missing metadata. */
  album: string | null;
  /** Milliseconds; always > 0 (filtered natively). */
  durationMs: number;
  /**
   * Stable MediaStore ALBUM_ID as a string, or null when MediaStore has
   * no album for the entry. Used for album grouping above display titles.
   */
  albumId: string | null;
  /**
   * Track position within its disc, decoded natively from MediaStore's
   * TRACK column, or null when the tags carry none. Never a row index.
   */
  trackNumber: number | null;
  /**
   * Disc number, present ONLY when MediaStore's TRACK encodes one
   * (disc * 1000 + track); null for plain single-disc entries.
   */
  discNumber: number | null;
  /** Release year from the file's tags (MediaStore YEAR), or null. */
  year: number | null;
  /** Composer credit from the file's tags, or null when absent. */
  composer: string | null;
}

interface LocalMediaNativeModule {
  /** Whether media-audio permission is currently granted. */
  hasAudioPermission(): boolean;
  /** Asks the OS for media-audio permission; resolves true when granted. */
  requestAudioPermissionAsync(): Promise<boolean>;
  /** MediaStore audio entries; rejects with E_LOCAL_MEDIA_* codes. */
  getAudioAsync(): Promise<NativeAudioEntry[]>;
}

let cachedModule: LocalMediaNativeModule | null | undefined;

/**
 * Lazily resolves the native module. Returns null when it is not
 * linked (e.g. running in Expo Go, which cannot load custom native
 * modules) so callers can degrade explicitly instead of crashing.
 */
export function getLocalMediaModule(): LocalMediaNativeModule | null {
  if (cachedModule === undefined) {
    try {
      cachedModule = requireNativeModule<LocalMediaNativeModule>('LocalMedia');
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}
