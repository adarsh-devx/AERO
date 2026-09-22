import type { Track } from '../core/types/track';
import type { MusicProvider } from '../providers/music/types';
import type { ResolvedStream, StreamResolver } from '../providers/stream/types';
import type { PlaybackEngine } from '../playback/types';

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
        tracks.push(...outcome.value);
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
   */
  async playTrack(track: Track): Promise<void> {
    if (!this.playbackEngine) {
      throw new Error('MusicService has no playback engine registered.');
    }
    console.log('[QUEUE] MusicService.playTrack', track.id, track.title);
    const stream = await this.resolveStream(track);
    // stream.uri is deliberately never logged: it is a signed googlevideo URL,
    // and building that string for a log is cost on the critical path.
    console.log('[QUEUE] stream resolved', stream.trackId);
    await this.playbackEngine.load(stream, track);
    console.log('[QUEUE] engine.load done');
    await this.playbackEngine.play();
    console.log('[QUEUE] engine.play done');
  }

  /** Stop current playback (see PlaybackEngine.stop). */
  async stopPlayback(): Promise<void> {
    if (!this.playbackEngine) {
      throw new Error('MusicService has no playback engine registered.');
    }
    await this.playbackEngine.stop();
  }

  /** Best-effort check that a resolve could even be attempted. */
  canResolve(track: Track): boolean {
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
