/**
 * Where a track originates. Kept as plain data (not a class, not a
 * provider reference) so a Track can cross feature boundaries without
 * dragging provider implementations with it.
 *
 * The playback pipeline must stay neutral to this value: online and
 * local tracks converge on the same StreamProvider → ResolvedStream →
 * PlaybackEngine path.
 */
export type TrackOrigin = 'local' | 'online';

/**
 * Provider-independent domain type for a playable music track.
 *
 * Minimal by design: only fields the product currently requires.
 * Optional fields cover both online and local tracks without forcing
 * either source to populate values it does not have. No
 * provider-specific fields (video IDs, provider URLs, etc.) belong
 * here — those stay inside provider implementations.
 */
export interface Track {
  /** Stable unique identifier within the source provider. */
  id: string;
  title: string;
  artist: string;

  /** Which kind of source this track came from, when known. */
  origin?: TrackOrigin;
  /** Album name, when the source provides one. */
  album?: string;
  /**
   * Stable identity of the album within the source provider, when the
   * source provides one (e.g. MediaStore ALBUM_ID). Optional exactly like
   * `id`: online sources without a stable album id simply leave it unset,
   * and album grouping falls back to a normalised title + artist key.
   */
  albumId?: string;
  /** Artwork URI, when the source provides one. */
  artworkUri?: string;
  /** Duration in milliseconds, when the source provides one. */
  durationMs?: number;

  /**
   * Real loudness metadata for loudness NORMALIZATION, in dB — populated
   * ONLY when the source genuinely supplies it (InnerTube player response
   * `playerConfig.audioConfig.loudnessDb`). Verified against real
   * responses: it is the loudness DEVIATION from YouTube's -14 LUFS
   * loudness target (`loudnessDb = perceptualLoudnessDb + 14`), so a
   * POSITIVE value means "louder than target" (attenuate) and a NEGATIVE
   * value means "quieter than target" (bounded make-up gain).
   *
   * Consumed solely by `computeNormalizationGainMB` to derive the bounded
   * normalization gain (-1500..+300 mB). Never inferred, never fabricated:
   * sources without this metadata (local files, search results, Piped
   * fallbacks) leave it unset, and unset means "no normalization for this
   * track" — never a default boost.
   */
  loudnessDb?: number;

  // ── Enriched music metadata ────────────────────────────────────────
  // Every field below is OPTIONAL and populated ONLY when the source
  // genuinely supplies it (file tags via MediaStore, provider responses).
  // Unknown stays unknown — no placeholders, no inference from titles,
  // no dates guessed from upload times. All of it is display metadata:
  // playback identity (trackIdentityKey) never reads these fields, so
  // enriching a track can never duplicate history, playlists or queues.

  /**
   * Release date exactly as the source states it: 'YYYY-MM-DD' (full),
   * 'YYYY-MM', or 'YYYY' when only a year is known. Normalised by
   * `normalizeReleaseDate` at the provider boundary; never a guessed
   * upload date or current year.
   */
  releaseDate?: string;
  /** Position within its disc, when the source's tags carry one. */
  trackNumber?: number;
  /** Disc number, when the source's tags explicitly encode one. */
  discNumber?: number;
  /**
   * Real credits supplied by the source (e.g. a composer tag). Never
   * inferred from artist/title text; absent entirely when the source
   * has none — no empty credit sections are rendered for it.
   */
  credits?: readonly TrackCredit[];
}

/** A credited role a source explicitly states for this track. */
export interface TrackCredit {
  readonly role: 'composer' | 'songwriter' | 'producer' | 'performer';
  /** Display name of the credited party, as the source provides it. */
  readonly name: string;
}

/**
 * Normalises a source-stated release date into Track.releaseDate.
 * Accepts a year (1000–9999) or a 'YYYY' / 'YYYY-MM' / 'YYYY-MM-DD'
 * string with plausible month/day ranges. Anything else — empty text,
 * upload timestamps, free-form strings — yields undefined: an unknown
 * release date is never dressed up as a real one.
 */
export function normalizeReleaseDate(value: string | number | null | undefined): string | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1000 && value <= 9999 ? String(value) : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (!match) return undefined;
  const month = match[2];
  const day = match[3];
  if (month !== undefined && (Number(month) < 1 || Number(month) > 12)) return undefined;
  if (day !== undefined && (Number(day) < 1 || Number(day) > 31)) return undefined;
  return text;
}

/**
 * Light display-string cleanup at the provider boundary: Unicode NFC
 * (so composed/decomposed spellings agree), trimmed, empty → undefined.
 * Deliberately NON-destructive — punctuation and internal text are kept
 * verbatim, so "AC/DC" stays "AC/DC".
 */
export function normalizeMetadataText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.normalize('NFC').trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Effective origin of a track for provider routing. An explicit origin
 * always wins; when a source left it unset the id shape decides
 * (MediaStore ids are numeric). One definition, used by stream
 * resolution, downloads and UI capability checks alike.
 */
export function trackOrigin(track: Track): TrackOrigin {
  if (track.origin) return track.origin;
  return /^\d+$/.test(track.id) ? 'local' : 'online';
}

/**
 * Stable identity of a track for de-duplication across features
 * (playback history, liked songs). Ids are only unique within a
 * provider, so the origin is part of the key (a local MediaStore id
 * and an online video id could otherwise collide).
 */
export function trackIdentityKey(track: Track): string {
  return `${track.origin ?? 'unknown'}:${track.id}`;
}

/** Structural check for Track entries read back from storage. */
export function isTrack(value: unknown): value is Track {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<'id' | 'title' | 'artist', unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.artist === 'string'
  );
}

/**
 * Universal resolver for track artwork URI.
 * If track has artworkUri, returns it.
 * If track has origin 'online' or has an 11-char YouTube ID, derives the high-res YouTube thumbnail URL.
 */
export function getTrackArtworkUri(track?: Track | null): string | undefined {
  if (!track) return undefined;
  if (track.artworkUri && typeof track.artworkUri === 'string' && track.artworkUri.trim().length > 0) {
    return track.artworkUri.trim();
  }
  // Check if track is online or has YouTube video ID format
  const rawId = track.id ? track.id.replace(/^(online:|local:|yt:)/, '') : '';
  if (track.origin === 'online' || (rawId.length === 11 && !rawId.includes('/'))) {
    return `https://i.ytimg.com/vi/${rawId}/hqdefault.jpg`;
  }
  return undefined;
}


