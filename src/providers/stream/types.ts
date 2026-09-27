import type { Track } from '../../core/types/track';

/** Source category of the active audio stream. */
export type StreamSourceType = 'online' | 'local' | 'download';

/** Real stream audio metadata extracted during resolution without fabrication. */
export interface StreamMetadata {
  /** Source classification: online network stream, local device file/MediaStore, or downloaded offline track. */
  readonly sourceType: StreamSourceType;
  /** Audio container/format (e.g. 'WEBM', 'M4A', 'MP3', 'AAC') when known natively. */
  readonly format?: string;
  /** Actual audio MIME type (e.g. 'audio/webm', 'audio/mp4') when known. */
  readonly mimeType?: string;
  /** Audio average/nominal bitrate in bits-per-second (e.g. 128000 or 160000) when known natively. */
  readonly bitrate?: number;
  /** Total file or stream size in bytes, when reported by storage/content-length. */
  readonly sizeBytes?: number;
  /** Sanitized hostname or provider authority (never leaking tokens, signatures, or query params). */
  readonly sanitizedHost?: string;
  /** Delivery protocol description (e.g. 'Progressive HTTP', 'Android MediaStore Content URI', 'Local File'). */
  readonly deliveryMethod?: string;
}

/**
 * Stream-resolution layer: turns a provider-agnostic Track into
 * whatever the PlaybackEngine can load.
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
  /**
   * Real, non-fabricated metadata describing this specific stream instance.
   * Captured at resolution time and propagated to the active playback snapshot.
   */
  readonly metadata?: StreamMetadata;
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

