import type { Track } from '../core/types/track';
import { trackIdentityKey, trackOrigin } from '../core/types/track';
import type { StreamResolver } from '../providers/stream/types';
import type { Downloads } from '../features/downloads/Downloads';
import type { FileDownloadsSource } from '../native/fileDownloads';

export interface DownloadServiceDependencies {
  /** The ONE stream resolver — the same instance playback resolves through. */
  readonly resolver: StreamResolver;
  /** The ONE persisted downloads store (state + persistence). */
  readonly downloads: Downloads;
  /** Native file boundary (streaming download, cancel, delete, list). */
  readonly files: FileDownloadsSource;
}

// ── Scheduler bounds (all documented, none arbitrary) ──────────────────
/**
 * Maximum downloads transferring AT THE SAME TIME. Conservative on
 * purpose: two parallel transfers saturate a typical connection without
 * starving playback/prefetch, and the rest of the queue simply waits
 * (§3/§4). A module constant, not a user setting — the current Settings
 * architecture has no network-type detection, so nothing here pretends to
 * be tunable infrastructure.
 */
const MAX_ACTIVE_DOWNLOADS = 2;
/**
 * Automatic attempts per job (1 initial + 2 retries), transient failures
 * only (§8). A permanent failure (invalid stream, 4xx, permission,
 * cancellation…) fails immediately and waits for the user's Retry.
 */
const MAX_ATTEMPTS = 3;
/** Backoff base: RETRY_BASE_DELAY_MS * 2^(attempt-1) → 2s, then 4s. */
const RETRY_BASE_DELAY_MS = 2_000;

/**
 * Live job states (in-memory only — §35). A job is in exactly one phase:
 *  - 'queued':    in the FIFO, waiting for a scheduler slot;
 *  - 'active':    occupying a slot; a native transfer (or its resolve) is
 *                 running — this is the ONLY phase with network progress;
 *  - 'retrying':  transient failure, waiting out the backoff timer with
 *                 NO slot held (unrelated downloads keep running).
 */
type JobPhase = 'queued' | 'active' | 'retrying';

/** One in-flight download job for a track identity. */
interface DownloadJob {
  readonly track: Track;
  readonly key: string;
  phase: JobPhase;
  /** Attempts made so far (network operations, including the current one). */
  attempts: number;
  /** Set when the user cancelled; observed by the running attempt. */
  cancelled: boolean;
  /** The running attempt's promise while one is in flight (else null). */
  promise: Promise<void> | null;
  /** Backoff timer while 'retrying' (cleared on cancel). */
  retryTimer: ReturnType<typeof setTimeout> | null;
}

/** Internal signal: the user cancelled before/while the file stage ran. */
class DownloadCancelledError extends Error {
  constructor() {
    super('Download cancelled.');
  }
}

/**
 * First line only, capped — persistence errors must never surface in the
 * UI as raw multi-line messages or stack traces.
 */
function userFacingMessage(raw: string): string {
  const firstLine = raw.split('\n')[0].trim();
  return (firstLine || 'Download failed.').slice(0, 160);
}

/**
 * Transient failure classification (§8) — retry ONLY what can plausibly
 * succeed on a second try. Explicit HTTP statuses: 408/425/429 and 5xx;
 * transport-level timeouts, resets, DNS hiccups and connection refusals;
 * the native "already running" race (our single-flight makes it a settle
 * race, so one retry is safe). Everything else — invalid stream, 4xx,
 * storage/permission errors, cancellation — is PERMANENT: no auto-retry.
 */
const TRANSIENT_ERROR_PATTERNS: readonly RegExp[] = [
  /timed?\s?out|timeout/i,
  /\bECONNRESET\b|\bETIMEDOUT\b|\bECONNREFUSED\b|\bENETUNREACH\b|\bEHOSTUNREACH\b|\bEPIPE\b|\bEAI_AGAIN\b/i,
  /network request failed|network error/i,
  /failed to connect|connection (reset|refused|closed|aborted|timed out)|broken pipe|software caused connection abort/i,
  /unable to resolve host|unknown host|could not resolve host|name or service not known|getaddrinfo/i,
];

function isTransientFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const rawCode = (error as { code?: unknown }).code;
  const code = typeof rawCode === 'string' ? rawCode : '';
  if (code === 'E_DOWNLOAD_IN_PROGRESS') return true;
  if (code !== '' && code !== 'E_DOWNLOAD_FAILED') return false; // cancel/storage: permanent

  const http = /HTTP (\d{3})/.exec(error.message);
  if (http !== null) {
    const status = Number(http[1]);
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

/** Whether a rejection means "cancelled", by flag or by native code/message. */
function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'E_DOWNLOAD_CANCELLED') return true;
  return error.message === 'Download cancelled.';
}

/** Maps a resolved stream's MIME type to a safe file extension. */
function extensionFor(mimeType?: string): string {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('ogg') || mime.includes('opus')) return 'ogg';
  // NewPipe's progressive default is audio/mp4 (m4a), also the fallback.
  return 'm4a';
}

/**
 * Deterministic, collision-free file name: the track's identity key
 * (origin:id) sanitized to a filename-safe charset — never a raw title.
 * Two different identities can only collide if their ids collide after
 * sanitizing, which cannot happen for real provider ids (YouTube ids are
 * [A-Za-z0-9_-]{11}).
 */
function downloadFileName(identityKey: string, extension: string): string {
  const safe = identityKey.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${safe}.${extension}`;
}

/**
 * DownloadService: the ONE place downloads are orchestrated — a bounded
 * FIFO queue in front of the ONE native downloader (§2/§34).
 *
 * Flow (never inlined into a screen):
 *
 *   UI → DownloadService.enqueue semantics (startDownload) → FIFO queue
 *      → scheduler (≤ MAX_ACTIVE_DOWNLOADS active) → StreamResolver (online
 *      resolve) → native file download → persistent local file → Downloads
 *      store entry
 *
 * Queue & concurrency (§3/§4):
 * - a tapped download becomes a QUEUED job (store shows "Waiting…", no
 *   fake progress); the scheduler starts jobs FIFO while slots are free;
 * - one slot per attempt, released in exactly ONE place (the attempt's
 *   finally) — correct across success, failure, cancellation, retry and
 *   native errors; duplicates can never exist because the jobs map is the
 *   single-flight gate for queued AND active jobs alike;
 * - one failing job never stops the others: its slot is released and the
 *   queue keeps draining (§33).
 *
 * Retry (§8): transient failures only, MAX_ATTEMPTS total with doubling
 * backoff; a job waiting out its backoff holds NO slot, so unrelated
 * downloads continue. Manual Retry (startDownload on a failed track)
 * creates a fresh job — attempts start at zero by construction.
 *
 * Cancellation (§15): queued → dropped from the queue immediately;
 * downloading → native cancel + immediate store clear (the attempt
 * settles and cleans its .part natively); failed → transient state
 * dismissed; completed → no-op (cancel never touches an entry). A
 * cancel→immediate-Retry chains the fresh start BEHIND the old attempt's
 * settle, so two native jobs never share one id.
 *
 * Pause/resume is DELIBERATELY NOT offered: the native downloader has no
 * range/resume support (it restarts from scratch), so a pause button
 * would be theatre. Cancel + Retry is the honest control surface.
 *
 * Guarantees kept from the previous single-download version:
 * - progress flows through the store (native events are already
 *   throttled), so every screen shows the same numbers;
 * - remove deletes the file first (missing file = success), then the
 *   store entry;
 * - downloaded playback never comes back here: the resolver's local-
 *   download seam serves the file directly (no re-resolution).
 *
 * Downloads run in the foreground of the app process (the native module
 * is an in-process coroutine): a killed process loses queued/transient
 * state and any running transfer — this service does not pretend
 * otherwise, and never touches the media playback service.
 */
export class DownloadService {
  private readonly deps: DownloadServiceDependencies;
  /** Every live job (queued, active or retrying) by track identity. */
  private readonly jobs = new Map<string, DownloadJob>();
  /** FIFO of job keys waiting for a slot (only phase-'queued' keys). */
  private readonly queue: string[] = [];
  /** Attempts currently occupying a slot (≤ MAX_ACTIVE_DOWNLOADS). */
  private activeCount = 0;

  constructor(deps: DownloadServiceDependencies) {
    this.deps = deps;

    // Native progress events are already throttled (>=150ms); they are
    // routed to the store only for jobs this service still owns AND only
    // while that job is actively transferring (a late event from a job
    // that already backed off to 'retrying' is dropped).
    deps.files.subscribeProgress((event) => {
      const job = this.jobs.get(event.id);
      if (!job || job.phase !== 'active' || job.cancelled) return;
      const progress = event.totalBytes > 0 ? event.bytesWritten / event.totalBytes : 0;
      this.deps.downloads.updateDownloadProgress(job.track, progress, event.totalBytes);
    });
  }

  /**
   * Enqueues a download (or joins the one already queued/running for this
   * track). Resolves once the job is scheduled — a completed download and
   * a local MediaStore track are immediate no-ops. Local tracks are a
   * no-op: they are already on the device.
   */
  async startDownload(track: Track): Promise<void> {
    if (trackOrigin(track) === 'local') return;

    await this.deps.downloads.hydrate();
    if (this.deps.downloads.isDownloaded(track)) return;

    const key = trackIdentityKey(track);
    const existing = this.jobs.get(key);
    if (existing) {
      if (existing.cancelled) {
        if (existing.promise === null) {
          // Defensive: a cancelled job without a live attempt should have
          // left the map already — drop it so we cannot recurse forever.
          this.jobs.delete(key);
          return this.startDownload(track);
        }
        // An active attempt is still winding down from a cancel. Chain the
        // retry BEHIND its settle instead of joining it — otherwise a
        // cancel → immediate-retry tap would silently die with the old job
        // (and both would fight over the same native id). The settled job
        // leaves `jobs` inside its finally, which runs before this `.then`
        // observes the promise, so the recursion always reaches the fresh-
        // enqueue path on the next turn.
        return existing.promise.then(() => this.startDownload(track));
      }
      // Already queued, backing off, or downloading: single-flight join —
      // one job, one file, one network transfer per identity, ever (§9).
      return existing.promise ?? Promise.resolve();
    }

    const job: DownloadJob = {
      track,
      key,
      phase: 'queued',
      attempts: 0,
      cancelled: false,
      promise: null,
      retryTimer: null,
    };
    this.jobs.set(key, job);
    this.queue.push(key);
    this.deps.downloads.queueDownload(track);
    this.pump();
    return Promise.resolve();
  }

  /**
   * Cancels a download in ANY transient state — race-safe and idempotent:
   *  queued      → removed from the queue (nothing to stop natively),
   *  retrying    → backoff timer cleared, job dropped,
   *  downloading → native cancel; the attempt settles, deletes its .part
   *                natively and releases its slot,
   *  failed      → transient state dismissed (nothing is running),
   *  completed   → no-op: cancel only ever touches transient state, so a
   *                stored download can never be lost through cancel.
   */
  cancelDownload(track: Track): void {
    const key = trackIdentityKey(track);
    const job = this.jobs.get(key);
    if (job) this.cancelJob(job);
    // Immediate UI feedback; the settling attempt clears again (idempotent)
    // and late progress events are ignored for a cancelled job. With no
    // live job this doubles as "dismiss this failed attempt".
    this.deps.downloads.clearDownloadActivity(track);
  }

  /**
   * Remove flow: cancel any active job → delete the local file (a
   * missing file counts as success) → remove the store entry → UI
   * updates via the store's own notification.
   */
  async removeDownload(track: Track): Promise<void> {
    this.cancelDownload(track);

    const entry = this.deps.downloads.getEntry(track);
    if (entry) {
      try {
        await this.deps.files.deleteFile(entry.localFilePath);
      } catch (error) {
        // The entry is removed regardless; reconciliation owns stragglers.
        console.warn('[DOWNLOADS] file delete failed; removing entry anyway.', error);
      }
    }
    await this.deps.downloads.removeDownload(track);
  }

  /**
   * Bulk delete (Settings → Clear downloads, Library → Delete all):
   * cancels EVERY live job (queued dropped, active natively cancelled)
   * and removes every completed entry — file first, then entry — through
   * the same per-track path. Only the download subsystem's own files are
   * touched: MediaStore music, playlists, likes, history and settings are
   * separate systems and are never read or written here (§30).
   */
  async clearAll(): Promise<{ removed: number; failed: number }> {
    await this.deps.downloads.hydrate();

    for (const job of [...this.jobs.values()]) {
      this.cancelDownload(job.track);
    }

    let removed = 0;
    let failed = 0;
    for (const entry of [...this.deps.downloads.getSnapshot()]) {
      try {
        await this.removeDownload(entry);
        removed += 1;
      } catch (error) {
        failed += 1;
        console.warn('[DOWNLOADS] clearAll: entry removal failed.', error);
      }
    }
    return { removed, failed };
  }

  /** Whether a download for this track is actively transferring right now. */
  isDownloading(track: Track): boolean {
    const job = this.jobs.get(trackIdentityKey(track));
    return job !== undefined && job.phase === 'active';
  }

  // ── Scheduler ─────────────────────────────────────────────────────────

  /** Starts queued jobs while slots are free. Never runs concurrently
   *  with itself (called from synchronous contexts only). */
  private pump(): void {
    while (this.activeCount < MAX_ACTIVE_DOWNLOADS && this.queue.length > 0) {
      const key = this.queue.shift() as string;
      const job = this.jobs.get(key);
      if (!job || job.cancelled || job.phase !== 'queued') continue;
      this.runJob(job);
    }
  }

  /** Occupies one slot and runs one attempt; the finally below is the
   *  ONLY place a slot is released, so the counter cannot drift. */
  private runJob(job: DownloadJob): void {
    job.phase = 'active';
    this.activeCount += 1;
    job.promise = this.executeAttempt(job)
      .catch((error) => {
        // executeAttempt handles its own failures; this is last-resort
        // isolation so one job can never crash the scheduler (§33).
        console.warn('[DOWNLOADS] unexpected attempt error.', error);
        job.phase = 'active'; // terminal — the finally retires the job
        if (job.cancelled) {
          this.deps.downloads.clearDownloadActivity(job.track);
        } else {
          this.deps.downloads.failDownload(job.track, userFacingMessage(
            error instanceof Error ? error.message : 'Download failed.',
          ));
        }
      })
      .finally(() => {
        this.activeCount -= 1;
        job.promise = null;
        // Terminal outcomes leave the map; a 'retrying' job stays (its
        // timer will requeue it later).
        if (job.phase === 'active') this.jobs.delete(job.key);
        this.pump();
      });
  }

  /**
   * ONE attempt: resolve → native download → complete, with the retry
   * decision at the end. Never throws (the outer catch above is the belt).
   */
  private async executeAttempt(job: DownloadJob): Promise<void> {
    const { downloads, resolver, files } = this.deps;
    job.attempts += 1;
    downloads.beginDownload(job.track);

    try {
      if (!files.isAvailable()) {
        throw new Error('File downloads are not available in this build of Aero.');
      }
      if (job.cancelled) throw new DownloadCancelledError();

      // Resolve through the ONE resolver — exactly the stream playback
      // would use. The download seam found nothing (we are not downloaded
      // yet), so this is the normal online/NewPipe path; its headers (the
      // bound User-Agent) are replayed verbatim when fetching the bytes.
      const stream = await resolver.resolve(job.track);
      if (job.cancelled) throw new DownloadCancelledError();

      const fileName = downloadFileName(job.key, extensionFor(stream.mimeType));
      const result = await files.download({
        id: job.key,
        url: stream.uri,
        fileName,
        headers: stream.headers,
      });

      if (job.cancelled) {
        // Completed in the gap after cancellation: nothing may linger.
        await files.deleteFile(result.filePath);
        throw new DownloadCancelledError();
      }

      await downloads.completeDownload(job.track, {
        localFilePath: result.filePath,
        fileSizeBytes: result.sizeBytes,
        mimeType: stream.mimeType,
      });

      // Cancel landed DURING the entry write: undo it, so cancel → clear
      // can never be raced by a completion into resurrecting an entry.
      if (job.cancelled) {
        await files.deleteFile(result.filePath);
        await downloads.removeDownload(job.track);
      }
    } catch (error) {
      if (job.cancelled || isCancellation(error)) {
        downloads.clearDownloadActivity(job.track);
        return; // phase stays 'active' → finally retires the job
      }

      const message = error instanceof Error ? error.message : 'Download failed.';
      if (job.attempts < MAX_ATTEMPTS && isTransientFailure(error)) {
        const delayMs = RETRY_BASE_DELAY_MS * 2 ** (job.attempts - 1);
        // Backing off is NOT downloading: drop the slot (the finally
        // below releases it), show the honest "Waiting…" state, and let
        // every unrelated download keep running while this one waits.
        job.phase = 'retrying';
        downloads.queueDownload(job.track);
        job.retryTimer = setTimeout(() => {
          job.retryTimer = null;
          if (job.cancelled) return;
          job.phase = 'queued';
          this.queue.push(job.key); // FIFO tail: never head-of-line blocks
          this.pump();
        }, delayMs);
        return; // phase 'retrying' → finally keeps the job
      }

      downloads.failDownload(job.track, userFacingMessage(message));
      // phase stays 'active' → finally retires the job; the user's Retry
      // creates a fresh job with attempts reset to zero.
    }
  }

  /** Cancels one live job in ANY phase; idempotent (§15). */
  private cancelJob(job: DownloadJob): void {
    if (job.retryTimer !== null) {
      clearTimeout(job.retryTimer);
      job.retryTimer = null;
    }
    if (job.phase === 'queued') {
      const index = this.queue.indexOf(job.key);
      if (index >= 0) this.queue.splice(index, 1);
      job.cancelled = true;
      this.jobs.delete(job.key);
      return;
    }
    if (job.phase === 'retrying') {
      job.cancelled = true;
      this.jobs.delete(job.key);
      return;
    }
    // 'active': flag + native cancel. The job STAYS in the map until its
    // attempt settles, which is what lets a cancel → immediate-Retry tap
    // chain behind that settle instead of racing the same native id.
    if (!job.cancelled) {
      job.cancelled = true;
      this.deps.files.cancel(job.key);
    }
  }
}
