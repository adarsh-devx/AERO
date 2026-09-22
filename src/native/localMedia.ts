import {
  getLocalMediaModule,
  type NativeAudioEntry,
} from '../../modules/local-media';
import { NativeModuleUnavailableError, PermissionDeniedError } from '../core/errors';

/**
 * Typed native boundary for local (device) audio discovery.
 *
 * This is the ONLY file in src/ allowed to touch the LocalMedia native
 * module. Everything above it (providers, service, UI) depends on the
 * LocalAudioSource interface, never on Android specifics.
 */
export interface LocalAudioSource {
  /** Whether the native module is present in this runtime. */
  isAvailable(): boolean;
  /** Whether media-audio permission is currently granted. */
  hasAudioPermission(): Promise<boolean>;
  /** Requests permission; resolves true when granted afterwards. */
  requestAudioPermission(): Promise<boolean>;
  /** Reads the device audio catalogue. Throws PermissionDeniedError when denied. */
  getAudioEntries(): Promise<NativeAudioEntry[]>;
}

const PERMISSION_DENIED_CODE = 'E_LOCAL_MEDIA_PERMISSION_DENIED';

class ExpoLocalAudioSource implements LocalAudioSource {
  isAvailable(): boolean {
    return getLocalMediaModule() !== null;
  }

  private requireModule() {
    const nativeModule = getLocalMediaModule();
    if (!nativeModule) {
      throw new NativeModuleUnavailableError('LocalMedia');
    }
    return nativeModule;
  }

  async hasAudioPermission(): Promise<boolean> {
    return this.requireModule().hasAudioPermission();
  }

  async requestAudioPermission(): Promise<boolean> {
    return this.requireModule().requestAudioPermissionAsync();
  }

  async getAudioEntries(): Promise<NativeAudioEntry[]> {
    try {
      return await this.requireModule().getAudioAsync();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === PERMISSION_DENIED_CODE) {
        throw new PermissionDeniedError('Local audio permission was denied on the device.');
      }
      throw error;
    }
  }
}

/** Singleton boundary instance used by the local music provider. */
export const localAudioSource: LocalAudioSource = new ExpoLocalAudioSource();
