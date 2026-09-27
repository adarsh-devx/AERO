import { requireNativeModule } from 'expo-modules-core';

/** Actual installed version, straight from Android PackageManager. */
export interface InstalledVersionInfo {
  versionName: string;
  versionCode: number;
}

/** Result of a completed update APK download (`.part` already renamed). */
export interface UpdateFileResult {
  filePath: string;
  sizeBytes: number;
}

/** Existence + size of a previously downloaded update APK. */
export interface UpdateFileInfo {
  exists: boolean;
  sizeBytes: number;
}

/** Throttled native progress event for the ONE update download. */
export interface UpdateProgressEvent {
  bytesWritten: number;
  /** Total size in bytes; -1 when the server did not report one. */
  totalBytes: number;
}

/** Raw entry shape exposed by the native AppUpdate module. */
export interface AppUpdateNativeModule {
  getInstalledVersion(): InstalledVersionInfo | null;
  downloadUpdateAsync(
    url: string,
    headersJson: string,
    fileName: string,
  ): Promise<UpdateFileResult>;
  deletePartialsAsync(): Promise<number>;
  getUpdateFileInfoAsync(fileName: string): Promise<UpdateFileInfo>;
  deleteUpdateFileAsync(fileName: string): Promise<boolean>;
  installApkAsync(fileName: string): Promise<void>;
  canInstallPackages(): boolean;
  openInstallPermissionSettings(): void;
  addListener(
    event: 'updateProgress',
    listener: (event: UpdateProgressEvent) => void,
  ): { remove(): void };
}

let cachedModule: AppUpdateNativeModule | null | undefined;

/**
 * Lazily resolves the native module. Returns null when it is not linked
 * (e.g. running in Expo Go) so the update system degrades to a silent
 * no-op instead of crashing.
 */
export function getAppUpdateModule(): AppUpdateNativeModule | null {
  if (cachedModule === undefined) {
    try {
      cachedModule = requireNativeModule<AppUpdateNativeModule>('AppUpdate');
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}
