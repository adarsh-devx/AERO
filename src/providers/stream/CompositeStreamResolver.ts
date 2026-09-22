import type { Track } from '../../core/types/track';
import { trackIdentityKey } from '../../core/types/track';
import type { ResolvedStream, StreamProvider, StreamResolver } from './types';

/** How long a resolved URL is trusted before we re-resolve it (NØTE parity). */
const STREAM_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Google stream URLs carry their own expiry in an `expire=` epoch-seconds
 * query parameter. Honouring it avoids handing the player a URL that 403s
 * mid-track. Re-resolve a minute early rather than racing the expiry.
 * Local/content URIs carry no such parameter and just get the default TTL.
 */
function expiryFor(uri: string): number {
  const fallback = Date.now() + STREAM_TTL_MS;
  const match = /[?&]expire=(\d+)/.exec(uri);
  if (!match) return fallback;

  const epochSeconds = Number(match[1]);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return fallback;

  const expiresAt = epochSeconds * 1000 - 60_000;
  return expiresAt > Date.now() ? Math.min(expiresAt, fallback) : fallback;
}

type CacheEntry = {
  stream: ResolvedStream;
  expiresAt: number;
};

/**
 * CompositeStreamResolver: routes track stream resolution to the
 * appropriate StreamProvider (local vs online) based on track metadata.
 *
 * On top of the routing it implements the verified NØTE
 * StreamResolverChain behavior:
 * - an in-memory resolved-stream cache keyed by track identity
 *   (origin:id); resolved stream URLs are short-lived and NEVER
 *   persisted;
 * - in-flight de-duplication: concurrent resolves of the same track
 *   share one underlying resolution request (e.g. prefetch + play);
 * - `expire=`-aware cache lifetime.
 */
export class CompositeStreamResolver implements StreamResolver {
  private readonly providers: ReadonlyMap<string, StreamProvider>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<ResolvedStream>>();

  constructor(providers: readonly StreamProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  /** Cached, unexpired stream for the track, if any. */
  peek(track: Track): ResolvedStream | undefined {
    const key = trackIdentityKey(track);
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.stream;
    if (hit) this.cache.delete(key);
    return undefined;
  }

  /** Drops the cached stream and any in-flight resolution for the track. */
  invalidate(track: Track): void {
    const key = trackIdentityKey(track);
    this.cache.delete(key);
    this.inflight.delete(key);
  }

  async resolve(track: Track): Promise<ResolvedStream> {
    const cached = this.peek(track);
    if (cached) {
      console.log('[STREAM_RESOLVER] cache hit:', track.id, track.title);
      return cached;
    }

    const key = trackIdentityKey(track);
    const existing = this.inflight.get(key);
    if (existing) {
      console.log('[STREAM_RESOLVER] in-flight join:', track.id, track.title);
      return existing;
    }

    console.log('[STREAM_RESOLVER] fresh resolve:', track.id, track.title);
    const promise = this.resolveUncached(track).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async resolveUncached(track: Track): Promise<ResolvedStream> {
    const origin = track.origin ?? (/^\d+$/.test(track.id) ? 'local' : 'online');
    const provider = this.providers.get(origin);

    if (!provider) {
      throw new Error(
        `No StreamProvider registered for track origin "${origin}" (track "${track.title}" / ${track.id}).`,
      );
    }

    const stream = await provider.resolve(track);
    this.cache.set(trackIdentityKey(track), {
      stream,
      expiresAt: expiryFor(stream.uri),
    });
    return stream;
  }
}

