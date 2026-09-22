import { requireNativeModule } from 'expo-modules-core';

/**
 * Raw entry shape exposed by the native AppStorage module.
 * Mirrors AppStorageModule.kt exactly.
 */
interface AppStorageNativeModule {
  /** Returns null when the key has never been written. */
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let cachedModule: AppStorageNativeModule | null | undefined;

/**
 * Lazily resolves the native module. Returns null when it is not linked
 * (e.g. running in Expo Go, which cannot load custom native modules) so
 * callers can degrade explicitly instead of crashing.
 */
export function getAppStorageModule(): AppStorageNativeModule | null {
  if (cachedModule === undefined) {
    try {
      cachedModule = requireNativeModule<AppStorageNativeModule>('AppStorage');
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}
