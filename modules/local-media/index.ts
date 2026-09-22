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
