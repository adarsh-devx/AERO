import {
  getAppUpdateModule,
  type InstalledVersionInfo,
  type UpdateFileInfo,
  type UpdateFileResult,
  type UpdateProgressEvent,
} from '../../modules/app-update';

export type { InstalledVersionInfo, UpdateFileInfo, UpdateFileResult, UpdateProgressEvent };

/**
 * Typed native boundary for Aero's in-app update system — the ONLY file
 * in src/ allowed to touch the AppUpdate native module. UpdateService
 * depends on this interface, never on Android specifics. Every operation
 * degrades explicitly when the native module is missing (Expo Go): version
 * reads report null, file checks report "absent", deletes report success
 * and downloads/installs refuse with a clear error — never a crash.
 */
export interface AppUpdateSource {
  /** Whether the native module is present in this runtime. */
  isAvailable(): boolean;
  /** The ACTUAL installed version from PackageManager; null when unreadable. */
  getInstalledVersion(): Promise<InstalledVersionInfo | null>;
  /** Streams an HTTPS URL to the private update directory (`.part` → rename). */
  downloadUpdate(
    url: string,
    fileName: string,
    headers?: Readonly<Record<string, string>>,
  ): Promise<UpdateFileResult>;
  /** Deletes leftover `.part` files from a killed session. */
  deletePartials(): Promise<number>;
  /** Whether a previously downloaded update APK still exists (with size). */
  getUpdateFileInfo(fileName: string): Promise<UpdateFileInfo | null>;
  /** Deletes one update file; a missing file counts as success. */
  deleteUpdateFile(fileName: string): Promise<boolean>;
  /** Validates the APK (package identity, no downgrade) and opens the system installer. */
  installApk(fileName: string): Promise<void>;
  /** Android O+: whether the install-unknown-apps permission is granted. */
  canInstallPackages(): boolean;
  /** Opens the supported per-app system settings screen for that permission. */
  openInstallPermissionSettings(): void;
  /** Subscribes to throttled native progress events; returns unsubscribe. */
  subscribeProgress(listener: (event: UpdateProgressEvent) => void): () => void;
}

class AppUpdate implements AppUpdateSource {
  isAvailable(): boolean {
    return getAppUpdateModule() !== null;
  }

  async getInstalledVersion(): Promise<InstalledVersionInfo | null> {
    try {
      return getAppUpdateModule()?.getInstalledVersion() ?? null;
    } catch {
      return null;
    }
  }

  async downloadUpdate(
    url: string,
    fileName: string,
    headers?: Readonly<Record<string, string>>,
  ): Promise<UpdateFileResult> {
    const module = this.requireModule('download');
    return module.downloadUpdateAsync(url, JSON.stringify(headers ?? {}), fileName);
  }

  async deletePartials(): Promise<number> {
    try {
      return (await getAppUpdateModule()?.deletePartialsAsync()) ?? 0;
    } catch {
      return 0;
    }
  }

  async getUpdateFileInfo(fileName: string): Promise<UpdateFileInfo | null> {
    try {
      return (await getAppUpdateModule()?.getUpdateFileInfoAsync(fileName)) ?? null;
    } catch {
      return null;
    }
  }

  async deleteUpdateFile(fileName: string): Promise<boolean> {
    const module = getAppUpdateModule();
    if (!module) return true; // nothing exists to delete
    try {
      return await module.deleteUpdateFileAsync(fileName);
    } catch {
      return false;
    }
  }

  async installApk(fileName: string): Promise<void> {
    await this.requireModule('install').installApkAsync(fileName);
  }

  canInstallPackages(): boolean {
    try {
      return getAppUpdateModule()?.canInstallPackages() ?? false;
    } catch {
      return false;
    }
  }

  openInstallPermissionSettings(): void {
    try {
      getAppUpdateModule()?.openInstallPermissionSettings();
    } catch {
      // Supported settings screen unavailable — surface nothing; the
      // caller keeps the update ready for a later attempt.
    }
  }

  subscribeProgress(listener: (event: UpdateProgressEvent) => void): () => void {
    const module = getAppUpdateModule();
    if (!module) return () => {};
    const subscription = module.addListener('updateProgress', listener);
    return () => subscription.remove();
  }

  private requireModule(operation: string) {
    const module = getAppUpdateModule();
    if (!module) {
      throw new Error(
        `App updates are not available in this build (${operation} unsupported).`,
      );
    }
    return module;
  }
}

/** Singleton boundary instance used by the update service. */
export const appUpdate: AppUpdateSource = new AppUpdate();
