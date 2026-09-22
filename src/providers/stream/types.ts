import type { Track } from '../../core/types/track';

/**
 * Stream-resolution layer: turns a provider-agnostic Track into
 * whatever the PlaybackEngine can load. DEFINED ONLY — no
 * implementation exists and no resolution strategy is chosen.
 *
 * ResolvedStream is deliberately neutral: it does not know whether the
 * bytes will come from the network or the local filesystem. The engine
 * must never need to care.
 */
export interface ResolvedStream {
  /** The track this stream was resolved for. */
  readonly trackId: string;
  /**
   * Playable URI/descriptor for the playback engine. Concrete format
   * (http(s) URL, file path, content URI) is decided by the
   * StreamProvider implementation, not by callers.
   */
  readonly uri: string;
  /** MIME type when known (e.g. 'audio/mpeg'). Optional. */
  readonly mimeType?: string;
  /**
   * HTTP headers the playback engine must replay when fetching `uri`, when
   * the source requires them (e.g. a stream URL bound to the User-Agent that
   * resolved it). Source-neutral: local streams simply omit it. Optional.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Resolves streams for tracks from one source family. Implementations
 * belong in `local/` and `online/`.
 */
export interface StreamProvider {
  /** Stable identifier matching the music provider family. */
  readonly id: string;

  /**
   * Resolve a track into a playable stream. Must be non-blocking;
   * errors reject (never resolve with fake/placeholder streams).
   */
  resolve(track: Track): Promise<ResolvedStream>;
}

/**
 * Selects and delegates to the right StreamProvider for a track.
 * This is the single seam where source-aware routing is allowed; both
 * online and local tracks emerge as the same ResolvedStream.
 *
 * peek/invalidate are optional so simple implementations (and tests)
 * only need resolve(); the composite used in production implements
 * the NØTE-parity resolved-stream cache on top of them.
 */
export interface StreamResolver {
  resolve(track: Track): Promise<ResolvedStream>;
  /** Cached, unexpired stream for the track, if any. */
  peek?(track: Track): ResolvedStream | undefined;
  /** Drops the cached stream and any in-flight resolution for the track. */
  invalidate?(track: Track): void;
}
