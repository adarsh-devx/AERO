import { getAppStorageModule } from '../../../modules/app-storage';
import { NativeModuleUnavailableError } from '../errors';
import type { KeyValueStore } from './types';

/**
 * KeyValueStore backed by the native AppStorage module (Android
 * SharedPreferences). This is the only file allowed to touch that
 * native module; everything above depends on the KeyValueStore shape.
 */
class NativeKeyValueStore implements KeyValueStore {
  private requireModule() {
    const nativeModule = getAppStorageModule();
    if (!nativeModule) {
      throw new NativeModuleUnavailableError('AppStorage');
    }
    return nativeModule;
  }

  async getItem(key: string): Promise<string | null> {
    return this.requireModule().getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.requireModule().setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.requireModule().removeItem(key);
  }
}

/** Singleton storage instance used by app-level state owners. */
export const nativeKeyValueStore: KeyValueStore = new NativeKeyValueStore();
