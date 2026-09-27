import type { KeyValueStore } from '../core/storage/types';
import { nativeKeyValueStore } from '../core/storage/nativeKeyValueStore';
import {
  AERO_RELEASE_LATEST_URL,
  formatVersion,
  isNewer,
  parseVersion,
  selectUpdateAsset,
  type GithubReleaseAsset,
  type UpdateAsset,
} from '../core/update';
import { appUpdate, type AppUpdateSource } from '../native/appUpdate';

/**
 * UpdateService: Aero's ONE in-app update system — isolated from
 * MusicService, PlayerController, RecommendationService, DownloadService
 * and LocalMusicProvider by design (none of them know this exists).
 *
 * Flow (spec §2):
 *   startup/foreground → TTL-gated check → GitHub Releases latest
 *   → numeric version comparison against the ACTUAL installed version
 *   → single accepted universal APK asset → automatic download (.part +
 *   atomic rename) → persisted "ready" → user taps "Restart & Update" →
 *   Android's own package installer confirmation flow.
 *
 * Safety properties:
 * - NEVER blocks startup, playback, navigation or library loading: the
 *   navigator calls start() fire-and-forget well after first paint, and
 *   every network call here has a bounded timeout.
 * - No polling: at most one check per launch/foreground transition, and
 *   only when the 6h TTL has elapsed (first-ever check is immediate).
 * - No update loops: comparison is strict numeric "newer than installed",
 *   equality is a no-op, and a downloaded artifact whose version is
 *   already installed is discarded on the next launch.
 * - Failures are terminal for the session: any network/API/asset problem
 *   lands in `failed`, renders NO UI, and retries only on a future
 *   TTL-eligible check. The app keeps working normally throughout.
 * - Persistence holds only update metadata (last check attempt + ready
 *   APK identity) — never playback state, URLs beyond the check itself,
 *   credentials or transient UI state.
 */

/** Explicit update state machine (spec §11). */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'failed';

/** Everything the overlay renders — a stable, replaced-on-change snapshot. */
export interface UpdateSnapshot {
  readonly state: UpdateState;
  /** Normalised latest release version for display, e.g. "1.0.1". */
  readonly latestVersion: string | null;
  /** 0..1 download progress; null while unknown (server sent no total). */
  readonly progress: number | null;
  readonly bytesWritten: number;
  readonly totalBytes: number;
  /** User closed the card; cleared whenever a new phase begins. */
  readonly dismissed: boolean;
  /** The install-permission settings screen was opened; retry after granting. */
  readonly needsInstallPermission: boolean;
}

/** The ONE persisted update record (schema-validated on load). */
interface UpdateRecord {
  /** Epoch ms of the last check ATTEMPT (success or failure) — the TTL gate. */
  readonly lastAttemptAt?: number;
  /** A fully downloaded update APK awaiting user confirmation. */
  readonly ready?: {
    readonly version: string;
    readonly fileName: string;
    readonly sizeBytes: number;
  };
}

/** Normal checks are rate-limited to one per 6h window (spec §5). */
const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
/** Bounded API timeout — a hung request must never hold the state machine. */
const CHECK_TIMEOUT_MS = 12_000;
/** Single storage key; update metadata only. */
export const UPDATE_STORAGE_KEY = 'aero.update';

const IDLE_SNAPSHOT: UpdateSnapshot = {
  state: 'idle',
  latestVersion: null,
  progress: null,
  bytesWritten: 0,
  totalBytes: 0,
  dismissed: false,
  needsInstallPermission: false,
};

/** Native error codes that mean "this artifact is unusable — discard it". */
const FATAL_ARTIFACT_CODES = new Set([
  'E_APK_MISSING',
  'E_APK_UNREADABLE',
  'E_APK_MISMATCH',
  'E_APK_OLDER',
]);

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

export class UpdateService {
  private readonly store: KeyValueStore;
  private readonly native: AppUpdateSource;
  private readonly listeners = new Set<() => void>();
  private snapshot: UpdateSnapshot = IDLE_SNAPSHOT;
  private record: UpdateRecord = {};
  private readyPromise: Promise<void> | null = null;
  private inFlight: Promise<void> | null = null;
  private unsubscribeProgress: (() => void) | null = null;

  constructor(store: KeyValueStore, native: AppUpdateSource) {
    this.store = store;
    this.native = native;
  }

  /** React external-store subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** React external-store snapshot (stable reference between changes). */
  getSnapshot = (): UpdateSnapshot => this.snapshot;

  /**
   * One-time post-startup entry point. Fire-and-forget from the navigator:
   * resolves quickly, never rejects, never blocks UI, playback or
   * navigation. Safe to call repeatedly (launch + foreground); concurrent
   * callers share the same promise.
   */
  start(): Promise<void> {
    this.readyPromise ??= this.init().catch((error: unknown) => {
      // Defensive: init must never take the app down. The session simply
      // runs without update checks; the next launch retries.
      console.warn('[UPDATE] startup initialization failed.', error);
    });
    return this.readyPromise;
  }

  /**
   * Foreground hook (wired to AppState 'active'). Only two jobs:
   * resolve an in-flight installer outcome (user cancelled the system
   * dialog → offer the ready update again) and run a TTL-eligible check.
   * No timers exist anywhere in this service.
   */
  async onAppForegrounded(): Promise<void> {
    await this.start();
    if (this.snapshot.state === 'installing') {
      await this.verifyInstallOutcome();
      return;
    }
    if (this.snapshot.state === 'idle' || this.snapshot.state === 'failed') {
      await this.maybeCheckByTtl();
    }
  }

  /** User closed the card (download continues / ready state is kept). */
  dismiss(): void {
    this.set({ dismissed: true });
  }

  /**
   * "Restart & Update": Android O+ install-permission gate, then the
   * validated FileProvider installer Intent. The system confirmation
   * dialog ALWAYS appears — nothing installs silently (spec §9).
   */
  async install(): Promise<void> {
    if (this.snapshot.state !== 'ready') return;
    const ready = this.record.ready;
    if (!ready) {
      this.set({ state: 'idle', latestVersion: null });
      return;
    }

    this.set({ state: 'installing', needsInstallPermission: false });

    try {
      if (!this.native.canInstallPackages()) {
        // Supported flow: send the user to this app's "Install unknown
        // apps" screen and come back to the ready card. No bypass.
        this.native.openInstallPermissionSettings();
        this.set({ state: 'ready', needsInstallPermission: true });
        return;
      }
      await this.native.installApk(ready.fileName);
      // The system installer now owns the screen. We stay in 'installing':
      // success kills this process (relaunch lands on the new version,
      // which self-cleans below); a cancel/reject is detected when the app
      // returns to the foreground.
    } catch (error) {
      if (FATAL_ARTIFACT_CODES.has(errorCode(error))) {
        // The artifact is unusable (missing/corrupt/wrong package/
        // downgrade) — never offer it again.
        await this.discardReady();
        this.set({ state: 'failed', latestVersion: null });
      } else {
        // Transient (e.g. no foreground activity) — keep it ready.
        this.set({ state: 'ready' });
      }
    }
  }

  // ── internals ────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    await this.hydrate();
    if (!this.native.isAvailable()) return; // Expo Go: silent no-op

    // A session killed mid-download leaves `.part` files; clear them safely.
    await this.native.deletePartials();

    // Recognise an APK downloaded by a previous session WITHOUT any network
    // call: relaunching must never re-download a ready update (spec §6/§11).
    const ready = this.record.ready;
    if (ready) {
      const installed = await this.readInstalledVersion();
      const readyVersion = parseVersion(ready.version);
      if (readyVersion && installed && !isNewer(readyVersion, installed)) {
        // Already on (or past) this version — stale artifact from an
        // update that went through another path. Removes any loop.
        await this.discardReady();
      } else {
        const info = await this.native.getUpdateFileInfo(ready.fileName);
        if (
          info !== null &&
          info.exists &&
          info.sizeBytes > 0 &&
          (ready.sizeBytes <= 0 || info.sizeBytes === ready.sizeBytes)
        ) {
          this.set({
            state: 'ready',
            latestVersion: ready.version,
            dismissed: false,
          });
        } else {
          await this.discardReady(); // file vanished or truncated
        }
      }
    }

    this.unsubscribeProgress ??= this.native.subscribeProgress(this.onProgress);
    await this.maybeCheckByTtl();
  }

  /** At most one check in flight; repeat callers share it. */
  check(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    const run = this.doCheck().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async maybeCheckByTtl(): Promise<void> {
    const state = this.snapshot.state;
    if (state === 'checking' || state === 'downloading' || state === 'installing') return;
    const lastAttempt = this.record.lastAttemptAt ?? 0;
    if (lastAttempt > 0 && Date.now() - lastAttempt < CHECK_TTL_MS) return;
    void this.check(); // fire-and-forget: startup/UI never await this
  }

  private async doCheck(): Promise<void> {
    if (!this.native.isAvailable()) return;
    const state = this.snapshot.state;
    if (state === 'downloading' || state === 'installing') return;

    this.set({ state: 'checking' });
    // Attempt-based TTL (covers failures too): a flaky network can never
    // turn launch/foreground transitions into a request loop.
    this.record = { ...this.record, lastAttemptAt: Date.now() };
    await this.persist();

    try {
      const release = await this.fetchLatestRelease();
      const latest = parseVersion(release.tag_name);
      if (latest === null) {
        this.failOrKeepReady(); // malformed tag — ignore gracefully
        return;
      }
      const installed = await this.readInstalledVersion();
      if (installed === null) {
        this.failOrKeepReady();
        return;
      }

      if (!isNewer(latest, installed)) {
        // Current >= latest: nothing to do, no downgrade, no loop. Any
        // ready artifact is stale by definition.
        if (this.record.ready) await this.discardReady();
        this.set({ state: 'idle', latestVersion: null, progress: null });
        return;
      }

      const version = formatVersion(latest);
      const asset = selectUpdateAsset(release.assets);
      if (asset === null) {
        // Release without an acceptable APK — fail gracefully, no broken
        // update state (spec §3).
        this.failOrKeepReady();
        return;
      }

      // Already downloaded this exact version? Go straight to ready.
      const ready = this.record.ready;
      if (ready) {
        if (ready.version === version) {
          const info = await this.native.getUpdateFileInfo(ready.fileName);
          if (info !== null && info.exists && info.sizeBytes > 0) {
            this.set({ state: 'ready', latestVersion: version, dismissed: false });
            return;
          }
        }
        await this.discardReady(); // older or unusable artifact
      }

      this.set({ state: 'available', latestVersion: version, dismissed: false });
      await this.download(asset, version);
    } catch (error) {
      console.warn('[UPDATE] release check failed.', error);
      this.failOrKeepReady();
    }
  }

  private async download(asset: UpdateAsset, version: string): Promise<void> {
    const fileName = `aero-${version}.apk`;
    this.set({
      state: 'downloading',
      progress: 0,
      bytesWritten: 0,
      totalBytes: asset.sizeBytes,
      dismissed: false,
    });

    try {
      const result = await this.native.downloadUpdate(asset.url, fileName, {
        'User-Agent': 'Aero-Updater',
      });
      if (result.sizeBytes <= 0) {
        throw new Error('Downloaded update file is empty.');
      }
      const info = await this.native.getUpdateFileInfo(fileName);
      if (info === null || !info.exists || info.sizeBytes <= 0) {
        throw new Error('Downloaded update file could not be verified.');
      }

      this.record = {
        ...this.record,
        ready: { version, fileName, sizeBytes: result.sizeBytes },
      };
      await this.persist();
      this.set({ state: 'ready', progress: 1, dismissed: false });
    } catch (error) {
      console.warn('[UPDATE] update download failed.', error);
      // Terminal for this session: no trap UI, no retry loop — the next
      // TTL-eligible check (or the next launch after it) retries.
      this.set({ state: 'failed', progress: null, dismissed: false });
    }
  }

  /** After the system installer closes without a process death: re-evaluate. */
  private async verifyInstallOutcome(): Promise<void> {
    const ready = this.record.ready;
    const installed = await this.readInstalledVersion();
    if (ready === null || ready === undefined) {
      this.set({ state: 'idle', latestVersion: null });
      return;
    }
    const readyVersion = parseVersion(ready.version);
    if (readyVersion && installed && !isNewer(readyVersion, installed)) {
      // The update actually landed without killing us (edge case).
      await this.discardReady();
      this.set({ state: 'idle', latestVersion: null });
      return;
    }
    // User cancelled or Android rejected the confirmation — offer it again.
    this.set({ state: 'ready', latestVersion: ready.version, needsInstallPermission: false });
  }

  /**
   * A failed check must never hide a ready update (a background TTL
   * re-check failing while the card is up would be a regression).
   */
  private failOrKeepReady(): void {
    if (this.record.ready) {
      this.set({ state: 'ready', progress: null });
    } else {
      this.set({ state: 'failed', progress: null });
    }
  }

  private onProgress = (event: { bytesWritten: number; totalBytes: number }): void => {
    if (this.snapshot.state !== 'downloading') return;
    const total =
      event.totalBytes > 0 ? event.totalBytes : this.snapshot.totalBytes;
    const bytes = Math.max(0, event.bytesWritten);
    this.set({
      bytesWritten: bytes,
      totalBytes: total,
      progress: total > 0 ? Math.min(1, bytes / total) : null,
    });
  };

  private async readInstalledVersion() {
    const info = await this.native.getInstalledVersion();
    if (!info || typeof info.versionName !== 'string') return null;
    return parseVersion(info.versionName);
  }

  private async fetchLatestRelease(): Promise<{
    tag_name: string;
    assets: GithubReleaseAsset[];
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(AERO_RELEASE_LATEST_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Aero-Updater',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`GitHub responded with HTTP ${response.status}`);
      }
      const body: unknown = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        typeof (body as { tag_name?: unknown }).tag_name !== 'string'
      ) {
        throw new Error('Malformed GitHub release payload.');
      }
      const { tag_name: tagName, assets } = body as {
        tag_name: string;
        assets?: unknown;
      };
      return {
        tag_name: tagName,
        assets: Array.isArray(assets) ? (assets as GithubReleaseAsset[]) : [],
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Removes the ready artifact (file + record); state changes are the callers' job. */
  private async discardReady(): Promise<void> {
    const ready = this.record.ready;
    if (!ready) return;
    const { ready: _discarded, ...rest } = this.record;
    this.record = rest;
    await this.persist();
    await this.native.deleteUpdateFile(ready.fileName).catch(() => false);
  }

  // ── persistence (hydrate-once, copy-on-write, never rejects) ─────────

  private hydrate(): Promise<void> {
    return this.load();
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.store.getItem(UPDATE_STORAGE_KEY);
    } catch (error) {
      console.warn('[UPDATE] storage unavailable; starting with no record.', error);
      return;
    }
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[UPDATE] malformed update record discarded.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;

    const candidate = parsed as Record<string, unknown>;
    const lastAttemptAt =
      typeof candidate.lastAttemptAt === 'number' && Number.isFinite(candidate.lastAttemptAt)
        ? candidate.lastAttemptAt
        : undefined;

    let ready: UpdateRecord['ready'];
    const readyRaw = candidate.ready;
    if (typeof readyRaw === 'object' && readyRaw !== null) {
      const r = readyRaw as Record<string, unknown>;
      if (
        typeof r.version === 'string' &&
        typeof r.fileName === 'string' &&
        typeof r.sizeBytes === 'number' &&
        Number.isFinite(r.sizeBytes) &&
        /^aero-\d+\.\d+\.\d+\.apk$/.test(r.fileName)
      ) {
        ready = { version: r.version, fileName: r.fileName, sizeBytes: r.sizeBytes };
      }
    }

    this.record = { lastAttemptAt, ready };
  }

  private async persist(): Promise<void> {
    try {
      await this.store.setItem(UPDATE_STORAGE_KEY, JSON.stringify(this.record));
    } catch (error) {
      console.warn('[UPDATE] could not persist update record.', error);
    }
  }

  private set(patch: Partial<UpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** Singleton owned by the update feature; nothing else constructs one. */
export const updateService = new UpdateService(nativeKeyValueStore, appUpdate);
