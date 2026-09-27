import { requireNativeModule } from 'expo-modules-core';

/**
 * Event delivered when an intent carries text/URL payload into Aero while
 * the app is alive — either another app sharing text (ACTION_SEND) or the
 * user opening a supported URL (ACTION_VIEW). `text` is the raw EXTRA_TEXT
 * or the opened URL — parsing and validation belong entirely to TypeScript
 * (`parseSharedLink`), never here.
 */
export interface SharedTextEvent {
  readonly text: string;
}

/**
 * Raw entry shape exposed by the native ShareIntent module (ACTION_SEND
 * shares AND ACTION_VIEW deep links — one thin bridge, one payload type).
 *
 * Exactly-once delivery is enforced NATIVELY (the payload is consumed when
 * read: EXTRA_TEXT removed / intent data cleared), so JS sees each intent
 * through either:
 *  - `getInitialSharedText()` — the cold-start launch intent, and any text
 *    that arrived before a JS listener existed (pending handoff); or
 *  - one `onSharedText` event — warm arrivals.
 */
export interface ShareIntentNativeModule {
  getInitialSharedText(): string | null | Promise<string | null>;
  addListener(
    event: 'onSharedText',
    listener: (event: SharedTextEvent) => void,
  ): { remove(): void };
}

let cachedModule: ShareIntentNativeModule | null | undefined;

/**
 * Lazily resolves the native module. Returns null when it is not linked
 * (e.g. running in Expo Go) so callers can degrade explicitly instead of
 * crashing — the same contract as getMediaControlsModule().
 */
export function getShareIntentModule(): ShareIntentNativeModule | null {
  if (cachedModule === undefined) {
    try {
      cachedModule = requireNativeModule<ShareIntentNativeModule>('ShareIntent');
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}
