import type { KeyValueStore } from '../../core/storage/types';

export const SETTINGS_STORAGE_KEY = 'aero.settings';
/** Schema version — an incompatible record is discarded, never guessed at. */
export const SETTINGS_VERSION = 1;

/**
 * The persisted preference values — everything the user can configure,
 * and nothing else. Each key is documented in SETTINGS_DEFINITIONS below;
 * its default value lives ONLY in DEFAULT_SETTINGS.
 */
export interface SettingsValues {
  /** Search bar asks the provider for suggested queries while typing. */
  readonly searchSuggestionsEnabled: boolean;
  /** Submitted searches are persisted to the search-history store. */
  readonly searchHistoryEnabled: boolean;
  /** Successfully started plays are persisted to the playback-history store. */
  readonly playbackHistoryEnabled: boolean;
  /** Home's personalized sections may use history/likes/search signals. */
  readonly personalizedHomeEnabled: boolean;
  /** The Now Playing screen shows the Lyrics shortcut pill. */
  readonly showLyricsButtonEnabled: boolean;
}

/** Persisted envelope: preference values + schema metadata (ONE record). */
export interface SettingsRecord extends SettingsValues {
  readonly version: number;
}

export type SettingsKey = keyof SettingsValues;

/** Screen section a setting is grouped under. */
export type SettingsSection = 'Search' | 'Privacy' | 'Now Playing';

/** Settings keys whose value is boolean — exactly the switch rows. */
type BooleanSettingsKey = {
  [K in SettingsKey]: SettingsValues[K] extends boolean ? K : never;
}[SettingsKey];

/**
 * A setting's central declaration. Every current setting is a boolean row
 * — a switch rendered by SettingsScreen.
 */
export type SettingDefinition = {
  readonly key: BooleanSettingsKey;
  readonly type: 'boolean';
  readonly section: SettingsSection;
  readonly title: string;
  readonly description: string;
};

/**
 * Central definition of every setting (§15): stable key, type and
 * documented behavior, grouped in the order the Settings screen renders
 * them. No other file may invent a settings-like key or hardcode a
 * default — DEFAULT_SETTINGS below is the single source of defaults.
 *
 * Only settings with a real implementation behind them appear here; the
 * store deliberately has no key for anything the app cannot enforce.
 */
export const SETTINGS_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: 'searchSuggestionsEnabled',
    type: 'boolean',
    section: 'Search',
    title: 'Search suggestions',
    description: 'Suggest queries while you type in the search bar.',
  },
  {
    key: 'searchHistoryEnabled',
    type: 'boolean',
    section: 'Search',
    title: 'Save search history',
    description: 'Remember searches you submit. Existing history is kept.',
  },
  {
    key: 'playbackHistoryEnabled',
    type: 'boolean',
    section: 'Privacy',
    title: 'Save listening history',
    description: 'Remember tracks as they play. Existing history is kept.',
  },
  {
    key: 'personalizedHomeEnabled',
    type: 'boolean',
    section: 'Privacy',
    title: 'Personalized Home',
    description: 'Use your history and likes to build Home sections.',
  },
  {
    key: 'showLyricsButtonEnabled',
    type: 'boolean',
    section: 'Now Playing',
    title: 'Show lyrics button',
    description: 'Show the Lyrics shortcut above the player controls.',
  },
];

/**
 * Documented defaults — THE single source of default values (§15).
 * All switches enabled: a fresh install behaves
 * exactly like the app before Settings existed, and "Reset settings"
 * restores this record.
 */
export const DEFAULT_SETTINGS: SettingsValues = {
  searchSuggestionsEnabled: true,
  searchHistoryEnabled: true,
  playbackHistoryEnabled: true,
  personalizedHomeEnabled: true,
  showLyricsButtonEnabled: true,
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as readonly SettingsKey[];

/** Value equality over the known keys (the version field is constant). */
function settingsEqual(a: SettingsValues, b: SettingsValues): boolean {
  return SETTINGS_KEYS.every((key) => a[key] === b[key]);
}

/**
 * Structural check + per-key validation for a persisted envelope.
 * Returns null when the record is malformed or from another schema
 * version — the caller then discards ONLY this record. A record with a
 * wrong-typed or missing key falls back to that key's documented default
 * instead of discarding the user's other preferences.
 */
function normalizeRecord(value: unknown): SettingsRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== SETTINGS_VERSION) return null;
  // Mutable mirror of SettingsValues: every key below is assigned either its
  // type-checked persisted value or its documented default.
  const values = {} as { -readonly [K in SettingsKey]: SettingsValues[K] };
  for (const key of SETTINGS_KEYS) {
    const raw = candidate[key];
    values[key] = typeof raw === 'boolean' ? raw : DEFAULT_SETTINGS[key];
  }
  return { version: SETTINGS_VERSION, ...values };
}

/**
 * SettingsStore: the ONE persisted preferences record.
 *
 * Follows the same framework-free store conventions as the other
 * persistent features: subscribe/getSnapshot for useSyncExternalStore,
 * a shared hydrate-once promise, copy-on-write replace + notify, and
 * graceful storage failure. It holds preferences only — every consumer
 * (history stores, the recommendation service, screens) reads it through
 * its snapshot; nothing else persists a settings-like key, and this
 * store never touches any other key.
 *
 * Hydration is local and fast: one KeyValueStore read → structural
 * validation → defaults. No network, no stream resolution, no effect on
 * playback-session restoration. Malformed or incompatible data discards
 * ONLY this record (§14), so startup can never crash because of settings.
 */
export class SettingsStore {
  private readonly store: KeyValueStore;
  private readonly listeners = new Set<() => void>();
  private settings: SettingsRecord = { version: SETTINGS_VERSION, ...DEFAULT_SETTINGS };
  private readyPromise: Promise<void> | null = null;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  /** React external-store subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** React external-store snapshot: the current record (stable reference). */
  getSnapshot = (): SettingsRecord => this.settings;

  /**
   * Loads persisted settings once; concurrent callers share the promise.
   * Never rejects: storage failures and malformed records degrade to the
   * documented defaults (§14/§18).
   */
  hydrate(): Promise<void> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /**
   * Applies one preference and persists it. Awaits hydration first so a
   * toggle made immediately after launch can never clobber stored values,
   * and same-value writes are no-ops — switches never rewrite identical
   * records (§16). Resolves after the write succeeds; rejects only when
   * persistence fails, with the in-memory value already applied so the
   * session stays consistent (§18).
   */
  async set<K extends SettingsKey>(key: K, value: SettingsValues[K]): Promise<void> {
    await this.hydrate();
    if (this.settings[key] === value) return;
    this.replace({ ...this.settings, [key]: value });
    await this.persist();
  }

  /**
   * Restores documented defaults: applies them in memory, notifies
   * subscribers and persists the defaults record (§12). Touches NOTHING
   * but this record — playlists, liked songs, downloads, playback
   * history, search history and the playback session are separate keys
   * and are never read or written here. Rejects only if the defaults
   * could not be persisted (§18).
   */
  async reset(): Promise<void> {
    await this.hydrate();
    this.replace({ version: SETTINGS_VERSION, ...DEFAULT_SETTINGS });
    await this.persist();
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(SETTINGS_STORAGE_KEY);
    } catch (error) {
      console.warn('[SETTINGS] storage unavailable; starting with defaults.', error);
      return;
    }
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[SETTINGS] malformed settings discarded.');
      await this.discard();
      return;
    }
    const record = normalizeRecord(parsed);
    if (record === null) {
      console.warn('[SETTINGS] incompatible/invalid settings discarded.');
      await this.discard();
      return;
    }
    this.replace(record);
  }

  /** Best-effort removal of ONLY the settings record; never other keys. */
  private async discard(): Promise<void> {
    try {
      await this.store.removeItem(SETTINGS_STORAGE_KEY);
    } catch (error) {
      console.warn('[SETTINGS] could not discard invalid settings.', error);
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.warn('[SETTINGS] could not persist settings.', error);
      throw error; // surfaced by the initiating screen (§18)
    }
  }

  private replace(next: SettingsRecord): void {
    if (settingsEqual(this.settings, next)) return;
    this.settings = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
