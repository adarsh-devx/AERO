import type { KeyValueStore } from '../../core/storage/types';

export const SEARCH_HISTORY_STORAGE_KEY = 'aero:search_history';
export const SEARCH_HISTORY_LIMIT = 20;

/**
 * The exact settings surface consumed to gate recording — structurally
 * satisfied by the app-level SettingsStore (wired in composition).
 */
export interface SearchHistorySettingsSource {
  /** Resolves once persisted settings have been read (shared promise). */
  hydrate(): Promise<void>;
  /** Current recording preference; valid once hydrate() resolves. */
  getSnapshot(): { readonly searchHistoryEnabled: boolean };
}

/**
 * Persistent Search History (newest first).
 *
 * Stores user-submitted queries in NativeKeyValueStore.
 * Supports useSyncExternalStore for reactive UI updates.
 */
export class SearchHistory {
  private readonly store: KeyValueStore;
  private readonly settings?: SearchHistorySettingsSource;
  private readonly listeners = new Set<() => void>();
  private queries: readonly string[] = [];
  private readyPromise: Promise<void> | null = null;

  constructor(store: KeyValueStore, settings?: SearchHistorySettingsSource) {
    this.store = store;
    this.settings = settings;
  }

  /** React external-store subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** React external-store snapshot: newest → oldest. */
  getSnapshot = (): readonly string[] => this.queries;

  /** Loads persisted search history once. */
  hydrate(): Promise<void> {
    this.readyPromise ??= this.load();
    return this.readyPromise;
  }

  /**
   * Records a search query.
   * De-duplicates case-insensitively and puts it at the top.
   */
  record(rawQuery: string): void {
    const q = rawQuery.trim();
    if (!q) return;
    void this.recordInternal(q);
  }

  /** Removes a specific query from history. */
  remove(targetQuery: string): void {
    void this.removeInternal(targetQuery.trim());
  }

  /** Clears all search history. */
  clear(): void {
    this.replace([]);
    void this.persist();
  }

  private async recordInternal(q: string): Promise<void> {
    // Recording can be switched off in Settings: while off nothing new
    // is persisted, and existing history is never touched (§7).
    if (this.settings) {
      await this.settings.hydrate();
      if (!this.settings.getSnapshot().searchHistoryEnabled) return;
    }
    await this.hydrate();
    const remaining = this.queries.filter(
      (item) => item.toLowerCase() !== q.toLowerCase(),
    );
    this.replace([q, ...remaining].slice(0, SEARCH_HISTORY_LIMIT));
    await this.persist();
  }

  private async removeInternal(q: string): Promise<void> {
    await this.hydrate();
    const remaining = this.queries.filter(
      (item) => item.toLowerCase() !== q.toLowerCase(),
    );
    this.replace(remaining);
    await this.persist();
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(SEARCH_HISTORY_STORAGE_KEY);
    } catch (error) {
      console.warn('[SEARCH_HISTORY] storage unavailable; starting empty.', error);
      return;
    }

    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      const valid = parsed
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, SEARCH_HISTORY_LIMIT);
      this.replace(valid);
    } catch (error) {
      console.warn('[SEARCH_HISTORY] malformed stored search history ignored.', error);
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.store.setItem(
        SEARCH_HISTORY_STORAGE_KEY,
        JSON.stringify(this.queries),
      );
    } catch (error) {
      console.warn('[SEARCH_HISTORY] could not persist search history.', error);
    }
  }

  private replace(next: readonly string[]): void {
    this.queries = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
