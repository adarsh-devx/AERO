import { requireNativeModule } from 'expo-modules-core';

export interface NativeStreamResult {
  uri: string;
  mimeType: string;
  bitrate?: number;
  format?: string;
  /**
   * User-Agent the extractor used. googlevideo ties a stream URL to the
   * client that requested it, so the player must replay this when fetching
   * the URL or the request is rejected.
   */
  userAgent?: string;
}

export interface StreamResolutionNativeModule {
  resolveStreamAsync(videoId: string): Promise<NativeStreamResult>;
  /**
   * Cold-start warm-up: initialises NewPipe and the extractor's service
   * registry ahead of the first resolution. Issues no network request and
   * resolves regardless of outcome (warm-up is always best effort).
   */
  warmUpAsync(): Promise<null>;
}

let cachedModule: StreamResolutionNativeModule | null | undefined;

/**
 * Lazily resolves the StreamResolution native module.
 * Returns null if running in an environment where the native module is not linked.
 */
export function getStreamResolutionModule(): StreamResolutionNativeModule | null {
  if (cachedModule === undefined) {
    try {
      cachedModule = requireNativeModule<StreamResolutionNativeModule>('StreamResolution');
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}

/**
 * Best-effort cold-start warm-up of the native extractor.
 *
 * No-ops when the native module is not linked (e.g. Expo Go), and never
 * rejects: warm-up must not be able to fail a flow that would otherwise work.
 */
export async function warmUpStreamResolution(): Promise<void> {
  const nativeModule = getStreamResolutionModule();
  if (!nativeModule) return;
  await nativeModule.warmUpAsync();
}

