import { requireNativeModule } from 'expo-modules-core';

/** One throttled progress event for an active download. */
export interface FileDownloadProgressEvent {
  /** Identity key of the track being downloaded. */
  id: string;
  bytesWritten: number;
  /** Total size in bytes; -1 when the server did not report one. */
  totalBytes: number;
}

export interface FileDownloadResult {
  /** Absolute path of the completed file inside the downloads directory. */
  filePath: string;
  sizeBytes: number;
}

export interface DownloadedFileRef {
  filePath: string;
  lastModified: number;
}

/** Raw entry shape exposed by the native FileDownloads module. */
export interface FileDownloadsNativeModule {
  getDownloadsDirectory(): string;
  downloadAsync(
    id: string,
    url: string,
    fileName: string,
    headersJson: string,
  ): Promise<FileDownloadResult>;
  cancelDownload(id: string): void;
  deleteFileAsync(path: string): Promise<boolean>;
  fileExistsAsync(path: string): Promise<boolean>;
  listFilesAsync(): Promise<DownloadedFileRef[]>;
  addListener(
    event: 'downloadProgress',
    listener: (event: FileDownloadProgressEvent) => void,
  ): { remove(): void };
}

let cachedModule: FileDownloadsNativeModule | null | undefined;

/**
 * Lazily resolves the native module. Returns null when it is not linked
 * (e.g. running in Expo Go) so callers can degrade explicitly instead of
 * crashing.
 */
export function getFileDownloadsModule(): FileDownloadsNativeModule | null {
  if (cachedModule === undefined) {
    try {
      cachedModule = requireNativeModule<FileDownloadsNativeModule>('FileDownloads');
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}
