/**
 * Minimal persistent key-value contract for app-level state.
 *
 * Deliberately tiny: features that need durable local state depend on
 * this shape, never on Android specifics or a concrete storage library.
 * Values are opaque strings — serialization belongs to the caller.
 *
 * Implementations may be unavailable at runtime (e.g. a runtime without
 * the native module). Unavailability must surface as a rejection, not as
 * a silent no-op or a fabricated empty value.
 */
export interface KeyValueStore {
  /** Resolves null when the key has never been written. */
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
