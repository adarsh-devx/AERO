import {
  getFileDownloadsModule,
  type DownloadedFileRef,
  type FileDownloadProgressEvent,
  type FileDownloadResult,
} from '../../modules/file-downloads';

export type { DownloadedFileRef, FileDownloadProgressEvent, FileDownloadResult };

export interface FileDownloadRequest {
  /** Identity key of the track — single-flight id AND progress routing key. */
  readonly id: string;
  /** Fully resolved (possibly expiring) stream URL to fetch exactly once. */
  readonly url: string;
  /** Deterministic, sanitized file name; never derived from raw titles. */
  readonly fileName: string;
  /** Headers the stream was resolved with (e.g. the bound User-Agent). */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Typed native boundary for Aero's offline download storage.
 *
 * This is the ONLY file in src/ allowed to touch the FileDownloads native
 * module — DownloadService, the Downloads store and every screen depend on
 * this interface, never on Android specifics. Every operation degrades
 * explicitly when the native module is missing (Expo Go): downloads refuse
 * to start with a clear error, file checks report "absent", and cleanup
 * operations report success (there is nothing to clean).
 */
export interface FileDownloadsSource {
  /** Whether the native module is present in this runtime. */
  isAvailable(): boolean;
  /** Streams the resolved URL to persistent local storage. */
  download(request: FileDownloadRequest): Promise<FileDownloadResult>;
  /** Stops an active download (idempotent for unknown ids). */
  cancel(id: string): void;
  /** Deletes a file; a missing file counts as success (true). */
  deleteFile(filePath: string): Promise<boolean>;
  /** Whether a file currently exists. */
  fileExists(filePath: string): Promise<boolean>;
  /** Lists downloads-directory files (startup reconciliation). */
  listFiles(): Promise<DownloadedFileRef[]>;
  /** Subscribes to throttled native progress events; returns unsubscribe. */
  subscribeProgress(
    listener: (event: FileDownloadProgressEvent) => void,
  ): () => void;
}

class FileDownloads implements FileDownloadsSource {
  isAvailable(): boolean {
    return getFileDownloadsModule() !== null;
  }

  async download(request: FileDownloadRequest): Promise<FileDownloadResult> {
    const module = this.requireModule('download');
    return module.downloadAsync(
      request.id,
      request.url,
      request.fileName,
      JSON.stringify(request.headers ?? {}),
    );
  }

  cancel(id: string): void {
    getFileDownloadsModule()?.cancelDownload(id);
  }

  async deleteFile(filePath: string): Promise<boolean> {
    const module = getFileDownloadsModule();
    if (!module) return true; // nothing exists to delete
    try {
      const deleted = await module.deleteFileAsync(filePath);
      // A file that is already gone is a successful cleanup.
      if (!deleted) return !(await module.fileExistsAsync(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    const module = getFileDownloadsModule();
    if (!module) return false;
    try {
      return await module.fileExistsAsync(filePath);
    } catch {
      return false;
    }
  }

  async listFiles(): Promise<DownloadedFileRef[]> {
    const module = getFileDownloadsModule();
    if (!module) return [];
    try {
      return await module.listFilesAsync();
    } catch (error) {
      console.warn('[FILE_DOWNLOADS] could not list downloads directory.', error);
      return [];
    }
  }

  subscribeProgress(
    listener: (event: FileDownloadProgressEvent) => void,
  ): () => void {
    const module = getFileDownloadsModule();
    if (!module) return () => {};
    const subscription = module.addListener('downloadProgress', listener);
    return () => subscription.remove();
  }

  private requireModule(operation: string) {
    const module = getFileDownloadsModule();
    if (!module) {
      throw new Error(
        `File downloads are not available in this build (${operation} unsupported).`,
      );
    }
    return module;
  }
}

/** Singleton boundary instance used by the download service. */
export const fileDownloads: FileDownloadsSource = new FileDownloads();
