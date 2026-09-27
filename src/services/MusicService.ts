import { isTrack, trackOrigin, type Track } from '../core/types/track';
import type { MusicProvider } from '../providers/music/types';
import type { ResolvedStream, StreamResolver } from '../providers/stream/types';
import type { PlaybackEngine, PlaybackRequest } from '../playback/types';

/**
 * Upper bound on how long a play may wait for loudness metadata that is
 * still in flight when stream resolution has finished. Loudness only
 * feeds a bounded normalization effect, so after this budget the track
 * simply plays WITHOUT normalization — audio is never delayed (or failed)
 * for it, and no value is ever guessed to fill the gap.
 */
const LOUDNESS_LOOKUP_TIMEOUT_MS = 4000;

/**
 * Real loudness metadata already carried by a track, if any. Finite
 * values only — an absent/invalid field is "no loudness", never coerced
 * into a number.
 */
function existingLoudnessDb(track: Track): number | null {
  return typeof track.loudnessDb === 'number' && Number.isFinite(track.loudnessDb)
    ? track.loudnessDb
    : null;
}

export interface MusicServiceDependencies {
  /** Registered discovery providers (local, online, ...). At least one. */
  readonly musicProviders: readonly MusicProvider[];
  /**
   * Resolves any Track into a playable stream. Optional until the
   * first StreamProvider implementation exists; resolveStream() throws
   * a clear error when absent rather than accepting a fake resolver.
   */
  readonly streamResolver?: StreamResolver | null;
  /**
   * Engine used by the playTrack() orchestration. Optional until the
   * playback step registers one.
   */
  readonly playbackEngine?: PlaybackEngine | null;
}

/**
 * Optional, additive controls for search(). Nothing here changes the merged
 * result — it only lets a caller observe a provider as soon as *that* provider
 * settles, instead of waiting for the slowest one.
 */
export interface SearchOptions {
  /**
   * Invoked once per provider, the moment that provider's own search()
   * settles — before the remaining providers do.
   *
   * search() merges every registered provider behind a single
   * Promise.allSettled, so without this a fast provider's results are held
   * until the slowest provider finishes. The device provider performs a
   * permission round-trip (which can open a permission prompt) followed by a
   * full MediaStore scan, so that wait is unbounded from the caller's point of
   * view and has nothing to do with the online results.
   *
   * Failures are deliberately NOT reported here: they continue to arrive
   * through the `errors` map that search() returns, exactly as before. The
   * callback must not throw.
   */
  readonly onProviderResults?: (providerId: string, tracks: Track[]) => void;
}

/**
 * Orchestration layer between features/UI and the provider layer.
 *
 * The UI must obtain tracks and streams only through this service —
 * never by instantiating a concrete OnlineMusicProvider or
 * LocalMusicProvider. Registration is plain constructor injection; no
 * DI framework is warranted at this scale.
 *
 * No providers or resolver are registered yet (all implementations are
 * pending decisions), so the constructor requires them explicitly and
 * search fails loudly if called with none — no fake defaults.
 */
export class MusicService {
  private readonly providers: ReadonlyMap<string, MusicProvider>;
  private readonly streamResolver: StreamResolver | null;
  private readonly playbackEngine: PlaybackEngine | null;

  constructor(dependencies: MusicServiceDependencies) {
    this.providers = new Map(dependencies.musicProviders.map((provider) => [provider.id, provider]));
    this.streamResolver = dependencies.streamResolver ?? null;
    this.playbackEngine = dependencies.playbackEngine ?? null;
  }

  /**
   * Search across all registered providers and merge results.
   * A provider failure degrades to zero results from that provider and
   * is reported in `errors` keyed by provider id; it never aborts the
   * remaining providers.
   */
  async search(
    query: string,
    options?: SearchOptions,
  ): Promise<{ tracks: Track[]; errors: ReadonlyMap<string, Error> }> {
    if (this.providers.size === 0) {
      throw new Error('MusicService has no registered providers; nothing to search.');
    }

    const attempts = Array.from(this.providers.values(), (provider) => ({
      provider,
      searchPromise: provider.search(query),
    }));

    // Report each provider independently, so a fast provider is not held back
    // by the slowest one. Handlers are attached to the ORIGINAL promises, so
    // Promise.allSettled below stays authoritative for both the merged result
    // and the errors map; rejections are swallowed here on purpose.
    const onProviderResults = options?.onProviderResults;
    if (onProviderResults) {
      for (const { provider, searchPromise } of attempts) {
        searchPromise.then(
          (tracks) => onProviderResults(provider.id, tracks),
          () => undefined,
        );
      }
    }

    const settled = await Promise.allSettled(attempts.map((attempt) => attempt.searchPromise));

    const tracks: Track[] = [];
    const errors = new Map<string, Error>();
    settled.forEach((outcome, index) => {
      const { provider } = attempts[index];
      if (outcome.status === 'fulfilled') {
        // Merge-boundary validation: a structurally invalid entry (missing
        // id/title/artist) never reaches a results list, a history write or
        // playback. Reuses the SAME structural check the persisted stores
        // use — one definition, no per-provider duplicate filtering.
        tracks.push(...outcome.value.filter(isTrack));
      } else {
        errors.set(
          provider.id,
          outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason)),
        );
      }
    });

    return { tracks, errors };
  }

  /**
   * Search-bar suggestions merged from every provider that offers them.
   *
   * Providers without a suggestion source are skipped (the capability is
   * optional), and a provider failure only removes that provider's
   * suggestions — it never fails the call. Results are de-duplicated
   * case-insensitively in provider order, so the first provider to offer a
   * query string defines its position.
   *
   * Deliberately separate from search(): suggestions arrive on every pause in
   * typing and must stay cheap, while search() is a deliberate user action.
   */
  async suggestions(query: string): Promise<string[]> {
    const needle = query.trim();
    if (needle.length === 0) return [];

    const attempts: Promise<string[]>[] = [];
    for (const provider of this.providers.values()) {
      if (typeof provider.suggestions !== 'function') continue;
      attempts.push(provider.suggestions(needle));
    }
    if (attempts.length === 0) return [];

    const settled = await Promise.allSettled(attempts);
    const suggestions: string[] = [];
    const seen = new Set<string>();
    for (const outcome of settled) {
      if (outcome.status !== 'fulfilled') continue;
      for (const suggestion of outcome.value) {
        const key = suggestion.trim().toLowerCase();
        if (key.length === 0 || seen.has(key)) continue;
        seen.add(key);
        suggestions.push(suggestion);
      }
    }
    return suggestions;
  }

  /**
   * Resolves ONE provider catalogue id into a single Track (shared-link /
   * deep-link id lookup) — the id-space equivalent of search(), kept at
   * this layer so the UI never talks to a concrete provider.
   *
   * Only providers implementing the optional getTrack capability are asked,
   * in registration order; the first non-null identification wins. Answers:
   *
   *  - Track: identified (callers then use the normal playback flow);
   *  - null: a provider was reached and could NOT identify the id —
   *    "not found", never a guessed or unrelated item;
   *  - throws: no capable provider exists, or every capable answer was a
   *    provider/network failure — "could not load".
   */
  async getTrack(id: string): Promise<Track | null> {
    const needle = id.trim();
    if (needle.length === 0) return null;

    const capable = [...this.providers.values()].filter(
      (provider) => typeof provider.getTrack === 'function',
    );
    if (capable.length === 0) {
      throw new Error('MusicService has no provider that can resolve a track by id.');
    }

    let definitiveNotFound = false;
    let lastError: Error | null = null;
    for (const provider of capable) {
      try {
        const track = await provider.getTrack!(needle);
        if (track !== null) return track;
        // A capable provider answered definitively: the id is unknown.
        definitiveNotFound = true;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (!definitiveNotFound && lastError !== null) throw lastError;
    return null;
  }

  /**
   * Resolve a track into a playable stream via the stream resolver.
   * Source-neutral: the caller receives a ResolvedStream regardless of
   * whether the track is local or online.
   */
  async resolveStream(track: Track): Promise<ResolvedStream> {
    if (!this.streamResolver) {
      throw new Error('MusicService has no stream resolver registered.');
    }
    return this.streamResolver.resolve(track);
  }

  /**
   * Full playback orchestration for a single track:
      * Track → StreamResolver → ResolvedStream → PlaybackEngine.load+play.
   * The engine is source-blind; nothing here exposes where audio comes
   * from, and no provider ever touches the playback engine.
   *
   * `request` is the caller's cancellation token. Resolution cannot be aborted
   * (the native extractor has no cancellation), so the guard sits at the one
   * place where an obsolete request would do real damage: loading and starting
   * audio. A request that was superseded while its stream was resolving returns
   * WITHOUT touching the engine — the newer selection owns playback, and the
   * wasted resolution has already populated the resolver's cache.
   */
  async playTrack(track: Track, request?: PlaybackRequest): Promise<void> {
    if (!this.playbackEngine) {
      throw new Error('MusicService has no playback engine registered.');
    }
    const loudnessInflight = this.startLoudnessLookup(track);
    const stream = await this.resolveStream(track);
    // stream.uri is deliberately never logged: it is a signed googlevideo URL,
    // and building that string for a log is cost on the critical path.
    if (request?.isCancelled()) return;
    const loudnessDb = await this.resolveLoudnessDb(track, loudnessInflight);
    if (request?.isCancelled()) return;
    // Only a genuinely NEW loudness value produces a modified track; every
    // other case loads the original track untouched — an unset loudnessDb
    // stays unset, so the engine applies NO normalization for it.
    const loadTrack =
      loudnessDb !== null && loudnessDb !== track.loudnessDb ? { ...track, loudnessDb } : track;
    await this.playbackEngine.load(stream, loadTrack);
    if (request?.isCancelled()) return;
    // Session-restore resume: position lands strictly between load and play
    // (loaded engine → seek → play), best-effort — a failed seek must never
    // take playback down with it, starting from 0 is the honest fallback.
    if (typeof request?.startAtMs === 'number' && request.startAtMs > 0) {
      try {
        await this.playbackEngine.seek(request.startAtMs);
      } catch (error) {
        console.warn('[QUEUE] could not apply restored position; starting from 0.', error);
      }
    }
    await this.playbackEngine.play();
  }

  /**
   * In-flight REAL-loudness lookup for a play, or null when none applies:
   * local tracks get NO lookup at all (their ids are not provider video
   * ids, and local files carry no loudness metadata), and a track that
   * already carries loudnessDb needs none either. The returned promise
   * never rejects and is bounded by LOUDNESS_LOOKUP_TIMEOUT_MS.
   */
  private startLoudnessLookup(track: Track): Promise<number | null> | null {
    if (existingLoudnessDb(track) !== null) return null;
    if (trackOrigin(track) !== 'online') return null;
    const capable = [...this.providers.values()].find(
      (provider) => typeof provider.getTrackLoudnessDb === 'function',
    );
    if (!capable) return null;
    const lookup = capable.getTrackLoudnessDb!(track.id);
    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), LOUDNESS_LOOKUP_TIMEOUT_MS);
      lookup.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    });
  }

  /**
   * The loudness value for THIS load: the track's own real metadata wins;
   * otherwise the parallel lookup's answer, if it arrived in time.
   * Invalid/absent resolves to null — "no normalization", never a guess.
   */
  private async resolveLoudnessDb(
    track: Track,
    inflight: Promise<number | null> | null,
  ): Promise<number | null> {
    const own = existingLoudnessDb(track);
    if (own !== null) return own;
    if (inflight === null) return null;
    const value = await inflight;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** Stop current playback (see PlaybackEngine.stop). */
  async stopPlayback(): Promise<void> {
    if (!this.playbackEngine) {
      throw new Error('MusicService has no playback engine registered.');
    }
    await this.playbackEngine.stop();
  }

  /** Best-effort check that a resolve could even be attempted. */
  canResolve(_track: Track): boolean {
    return this.streamResolver !== null;
  }

  /** Cached, unexpired stream for the track, if one exists (prefetch seam). */
  peekStream(track: Track): ResolvedStream | undefined {
    return this.streamResolver?.peek?.(track);
  }

  /** Resolve ahead of time; populates the cache; never starts playback. */
  prefetchStream(track: Track): Promise<ResolvedStream> {
    if (!this.streamResolver) {
      return Promise.reject(new Error('MusicService has no stream resolver registered.'));
    }
    // NØTE parity: a prefetch is an optimisation, never a user-visible event.
    return this.streamResolver.resolve(track);
  }

  /** Force the next resolve for this track to go back to the resolver. */
  invalidateStream(track: Track): void {
    this.streamResolver?.invalidate?.(track);
  }
}
