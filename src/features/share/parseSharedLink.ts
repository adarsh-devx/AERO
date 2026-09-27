/**
 * Shared-link parsing — the trust boundary for text arriving from Android
 * intents: share-sheet text (ACTION_SEND EXTRA_TEXT) and opened URLs
 * (ACTION_VIEW deep-link data). Both sources feed this ONE parser — there
 * are no per-path URL rules.
 *
 * Shared text is UNTRUSTED input. This parser:
 *  - only accepts http(s) URL tokens on an explicit host allowlist
 *    (YouTube and Instagram hosts, hostname compared case-insensitively);
 *  - YouTube: extracts ONLY the video id, validating it against the strict
 *    [A-Za-z0-9_-]{11} shape YouTube ids use;
 *  - Instagram: recognises ONLY the two public Reel path forms
 *    (/reel/<id>/ and /reels/<id>/). Profile, explore, direct, settings
 *    and every other Instagram path is rejected — this is never a generic
 *    instagram.com handler — and the shortcode must match a conservative
 *    real-id shape ([A-Za-z0-9_-], 4–64 chars); no id is ever invented;
 *  - drops fragments and ignores every other query parameter;
 *  - never decodes, never executes, never stores — the result is a small
 *    transient value object, and the original text is never persisted.
 *
 * Deliberately implemented WITHOUT the URL class: parsing is pure string
 * operations, so behavior cannot vary with the JavaScript runtime, and no
 * WebView / browser / scraper is involved anywhere. The parser only
 * RECOGNISES a Reel URL — it performs no network request itself.
 *
 * The parser is provider-boundary input, not a provider: it recognises
 * link forms only, and everything downstream goes through MusicService
 * like any other discovery call (YouTube: id → getTrack; Instagram:
 * InstagramSongIdentifier → search → Track). Instagram Reel media itself
 * is never fetched, extracted or played anywhere in this flow.
 */

/** Transient description of one shared YouTube link. NEVER persisted or logged. */
export interface SharedYouTubeLink {
  readonly provider: 'youtube';
  /** Validated 11-character video id — the canonical identity. */
  readonly videoId: string;
  /** The (cleaned) URL the link came from — kept for this request only. */
  readonly originalUrl: string;
}

/**
 * Transient description of one shared Instagram Reel link. NEVER
 * persisted or logged. The id is validated identity only; the URL is what
 * the identification layer may read public metadata from (one bounded
 * GET, no media, no auth — see InstagramSongIdentifier).
 */
export interface SharedInstagramLink {
  readonly provider: 'instagram';
  /** Validated Reel shortcode — identity/cache key, never an invented id. */
  readonly reelId: string;
  /** The (cleaned) URL the link came from — kept for this request only. */
  readonly originalUrl: string;
}

/**
 * Every link form Aero accepts from an Android intent, discriminated on
 * `provider`. YouTube behavior is unchanged from the single-provider
 * shape it had before (same field names, same validation).
 */
export type SharedMediaLink = SharedYouTubeLink | SharedInstagramLink;

/** YouTube hosts a shared link may come from (already lower-cased). */
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/** Instagram hosts a shared Reel link may come from (already lower-cased). */
const INSTAGRAM_HOSTS: ReadonlySet<string> = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);

/** The only accepted video-id shape (exactly 11 URL-safe characters). */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** The only accepted Reel shortcode shape (URL-safe, bounded length). */
const REEL_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

/** Any http(s) URL token inside the shared text. */
const URL_TOKEN_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** Trailing punctuation people and apps put around a pasted URL. */
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?'\")\]}]+$/;

/** Path-based id forms that carry the same identity as watch?v=. */
const PATH_ID_PATTERN = /^\/(shorts|live|embed)\/([^/?]+)\/?$/;

/** The ONLY Instagram path forms accepted: /reel/<id> and /reels/<id>. */
const REEL_PATH_PATTERN = /^\/(reels?)\/([^/?]+)\/?$/;

/** Reads one query parameter without decoding anything else. */
function firstQueryParam(query: string, name: string): string | null {
  for (const pair of query.split('&')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    if (pair.slice(0, separator) === name) {
      return pair.slice(separator + 1);
    }
  }
  return null;
}

/** Parses the YouTube half of one candidate URL token; null when off. */
function parseYouTubeCandidate(
  pathAndQuery: string,
  host: string,
  originalUrl: string,
): SharedYouTubeLink | null {
  let videoId: string | null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    // Short links: the id IS the first path segment; any extra segment
    // fails the id shape below rather than being silently trimmed.
    const path = pathAndQuery.split('?')[0];
    videoId = path.startsWith('/') ? path.slice(1) : path;
  } else {
    const queryIndex = pathAndQuery.indexOf('?');
    const path = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
    const query = queryIndex >= 0 ? pathAndQuery.slice(queryIndex + 1) : '';
    if (path === '/watch') {
      // Handles v= first (watch?v=X) and v= later (watch?list=...&v=X).
      videoId = firstQueryParam(query, 'v');
    } else {
      const pathMatch = PATH_ID_PATTERN.exec(path);
      videoId = pathMatch !== null ? pathMatch[2] : null;
    }
  }

  if (videoId === null || !VIDEO_ID_PATTERN.test(videoId)) return null;
  return { provider: 'youtube', videoId, originalUrl };
}

/** Parses the Instagram half of one candidate URL token; null when off. */
function parseInstagramCandidate(
  pathAndQuery: string,
  originalUrl: string,
): SharedInstagramLink | null {
  // Query strings carry tracking parameters, never identity — dropped.
  const queryIndex = pathAndQuery.indexOf('?');
  const path = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;

  // ONLY /reel/<id> and /reels/<id>: everything else on these hosts
  // (profile, explore, direct, settings …) is not an identification
  // request, and no path segment is ever treated as an invented id.
  const pathMatch = REEL_PATH_PATTERN.exec(path);
  if (pathMatch === null) return null;
  const reelId = pathMatch[2];
  if (!REEL_ID_PATTERN.test(reelId)) return null;
  return { provider: 'instagram', reelId, originalUrl };
}

/** Parses one candidate URL token; null when anything is off. */
function parseCandidate(raw: string): SharedMediaLink | null {
  const candidate = raw.replace(TRAILING_PUNCTUATION_PATTERN, '');

  const schemeMatch = /^https?:\/\//i.exec(candidate);
  if (schemeMatch === null) return null;
  const rest = candidate.slice(schemeMatch[0].length);

  // A fragment never reaches the server and carries no identity — drop it.
  const hashIndex = rest.indexOf('#');
  const withoutFragment = hashIndex >= 0 ? rest.slice(0, hashIndex) : rest;

  const authorityEnd = withoutFragment.search(/[/?]/);
  const host = (
    authorityEnd >= 0 ? withoutFragment.slice(0, authorityEnd) : withoutFragment
  ).toLowerCase();
  const pathAndQuery = authorityEnd >= 0 ? withoutFragment.slice(authorityEnd) : '';

  if (INSTAGRAM_HOSTS.has(host)) {
    return parseInstagramCandidate(pathAndQuery, candidate);
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  return parseYouTubeCandidate(pathAndQuery, host, candidate);
}

/**
 * Extracts a supported media link from shared text, or null when the text
 * contains no URL this app can handle. Every URL token in the text is
 * tried in order; the first one that parses to a supported link wins (the
 * title words other apps share alongside the link are ignored — see
 * extractSharedClue for using them as a search clue).
 */
export function parseSharedLink(text: string): SharedMediaLink | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const tokens = trimmed.match(URL_TOKEN_PATTERN) ?? [];
  for (const token of tokens) {
    const link = parseCandidate(token);
    if (link !== null) return link;
  }
  return null;
}

/**
 * Words the user shared ALONGSIDE the URL (a share-sheet caption such as
 * "… instagram.com/reel/ABC/ Blinding Lights"). Returns the shared text
 * with every URL token, hashtag and @handle removed, or null when nothing
 * title-shaped remains.
 *
 * This is a SEARCH CLUE only: it is never treated as verified metadata,
 * never claimed to have come from Instagram, never persisted, and never
 * recorded as search history. URL parsing above stays authoritative for
 * the URL itself — this function cannot turn text into a link.
 */
export function extractSharedClue(text: string): string | null {
  if (typeof text !== 'string') return null;
  const withoutUrls = text.replace(URL_TOKEN_PATTERN, ' ');
  const withoutTags = withoutUrls
    .replace(/(^|\s)[#@]\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Title-shaped only: short enough not to be a caption paragraph, with at
  // least one letter so emoji/punctuation residue never becomes a query.
  if (withoutTags.length < 3 || withoutTags.length > 100) return null;
  if (!/\p{L}/u.test(withoutTags)) return null;
  return withoutTags;
}
