import type { Track } from '../../../core/types/track';
import { normalizeArtistKey, trackMatchesArtist } from '../../library/grouping';
import type { SharedInstagramLink } from '../parseSharedLink';
import type { SongClue, SongIdentificationResult } from './types';

/**
 * InstagramSongIdentifier — turns ONE shared Instagram Reel URL into a
 * song identification against Aero's existing music providers.
 *
 *   Reel URL → public-page metadata probe (best effort) → SongClue
 *   → ONE MusicService.search → conservative title/artist matching
 *   → SongIdentificationResult (matched / ambiguous / not-found /
 *   unavailable)
 *
 * WHAT THIS IS NOT (§6/§24/§29 — hard boundaries):
 * - Instagram exposes NO official "song behind this Reel" API. This
 *   service never calls private/GraphQL endpoints, never handles cookies
 *   or sessions, never logs in, never bypasses rate limits, signed URLs
 *   or any access control, and never touches Reel media — no download,
 *   no audio extraction, no third-party downloader.
 * - The probe is ONE GET of the canonical PUBLIC Reel URL (no custom
 *   User-Agent games), reading only standard HTML metadata: Open Graph
 *   tags and, secondarily, a music-note caption attribution. A login
 *   wall, redirect or empty page simply yields NO metadata — the service
 *   reports 'unavailable' rather than working around it.
 * - Matching never invents evidence: no popularity guessing, no picking
 *   "the first YouTube result", no searching the word "Instagram", no
 *   Reel-id-derived guesses, no confidence percentages. Failure is
 *   preferable to wrong playback.
 * - The identification layer knows NOTHING about NewPipe, stream
 *   extraction, Media3, expo-audio or playback internals: it ends at
 *   Track selection; the caller plays through the existing pipeline.
 *
 * Privacy: nothing here is persisted — no Reel URLs, no ids, no raw
 * metadata, no media (in-memory TTL cache for the third-party probe and
 * in-flight dedup for searches only). Results never enter search history,
 * playback history or any personalization signal. Settings/personalization
 * are deliberately not read: sharing a Reel is explicit user intent.
 */

/** Result shape of the consumed search surface (structurally MusicService.search). */
export interface SongSearchOutcome {
  readonly tracks: readonly Track[];
  readonly errors: ReadonlyMap<string, Error>;
}

export interface InstagramSongIdentifierDependencies {
  /** Existing MusicService.search — one bounded query per identification. */
  readonly search: (query: string) => Promise<SongSearchOutcome>;
}

// ── Bounds (all documented, none arbitrary) ────────────────────────────
/** Hard timeout for the single public-page GET (same as other network deps). */
const PROBE_TIMEOUT_MS = 10_000;
/** Public-page probe cache: sparing Instagram's edge (a repeated share of
 *  the same Reel re-reads nothing) without remembering anything across
 *  the process lifetime — in-memory only, never persisted. */
const PROBE_CACHE_TTL_MS = 5 * 60_000;
/** HTML read cap: metadata tags sit at the top of the document; anything
 *  beyond this is boilerplate we never parse. */
const MAX_HTML_CHARS = 600_000;
/** At most this many plausible candidates reach the picker (§10 UI bound). */
const MAX_CANDIDATES = 6;
/** Search query length cap — a clue is a title, never a paragraph. */
const MAX_QUERY_LENGTH = 160;

export class InstagramSongIdentifier {
  private readonly deps: InstagramSongIdentifierDependencies;
  private readonly probeCache = new Map<string, { at: number; clue: SongClue | null }>();
  private readonly probeInflight = new Map<string, Promise<SongClue | null>>();
  private readonly searchInflight = new Map<string, Promise<SongSearchOutcome>>();

  constructor(deps: InstagramSongIdentifierDependencies) {
    this.deps = deps;
  }

  /**
   * Identifies the song behind one Reel. Never throws: every failure
   * degrades to an honest 'unavailable'/'not-found' result so the caller
   * can show a calm message (Home/playback/search are never affected).
   */
  async identify(
    link: SharedInstagramLink,
    sharedTextClue: string | null,
  ): Promise<SongIdentificationResult> {
    // ── 1) Public Reel metadata (preferred source, best effort) ────────
    let metadataClue: SongClue | null = null;
    let probeFailed = false;
    try {
      metadataClue = await this.probePublicMetadata(link);
    } catch (error) {
      probeFailed = true;
      console.warn('[IDENTIFY] public Reel metadata probe failed:', error);
    }

    // ── 2) Text the user shared alongside the URL — search clue only ───
    const sharedClue = buildSharedTextClue(sharedTextClue);

    const clue = metadataClue ?? sharedClue;
    if (clue === null) {
      return {
        status: 'unavailable',
        reason: probeFailed ? 'network' : 'no-public-metadata',
      };
    }

    // ── 3) ONE bounded provider search through the existing MusicService
    let outcome: SongSearchOutcome;
    try {
      outcome = await this.searchCandidates(buildSearchQuery(clue));
    } catch (error) {
      console.warn('[IDENTIFY] candidate search failed:', error);
      return { status: 'unavailable', reason: 'network' };
    }
    // Every provider errored and none returned anything: the user should
    // hear "couldn't reach", not "no such song".
    if (outcome.tracks.length === 0 && outcome.errors.size > 0) {
      return { status: 'unavailable', reason: 'network' };
    }

    // ── 4) Conservative matching (deterministic, no scores) ────────────
    return matchClue(clue, outcome.tracks);
  }

  /**
   * One GET of the canonical PUBLIC Reel URL + standard HTML metadata
   * extraction, with TTL cache and in-flight dedup keyed by Reel id.
   * Successes (including the honest "no metadata" answer) are cached;
   * failures are never cached, so a later share may retry.
   */
  private probePublicMetadata(link: SharedInstagramLink): Promise<SongClue | null> {
    const key = link.reelId;

    const hit = this.probeCache.get(key);
    if (hit !== undefined && Date.now() - hit.at < PROBE_CACHE_TTL_MS) {
      return Promise.resolve(hit.clue);
    }

    const pending = this.probeInflight.get(key);
    if (pending !== undefined) return pending;

    const request = this.fetchPublicPageClue(link.originalUrl).then(
      (clue) => {
        this.probeInflight.delete(key);
        this.probeCache.set(key, { at: Date.now(), clue });
        return clue;
      },
      (error) => {
        this.probeInflight.delete(key);
        throw error;
      },
    );
    this.probeInflight.set(key, request);
    return request;
  }

  /** The single bounded public-page read. Throws on any transport/HTTP failure. */
  private async fetchPublicPageClue(url: string): Promise<SongClue | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      // No cookie/auth handling and no circumvention: a login wall or
      // redirect simply fails or carries no song metadata below.
      if (!response.ok) {
        throw new Error(`Public Reel page returned HTTP ${response.status}.`);
      }
      const html = (await response.text()).slice(0, MAX_HTML_CHARS);
      return extractPublicSongClue(html);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** In-flight dedup for the ONE provider search per identification. */
  private searchCandidates(query: string): Promise<SongSearchOutcome> {
    const key = query.toLowerCase();
    const pending = this.searchInflight.get(key);
    if (pending !== undefined) return pending;
    const request = this.deps.search(query).finally(() => {
      this.searchInflight.delete(key);
    });
    this.searchInflight.set(key, request);
    return request;
  }
}

// ── Public-page metadata extraction (standard HTML metadata ONLY) ──────

/**
 * Reads a song clue from standard, publicly emitted HTML metadata:
 *  1. Open Graph music tags (og:music:song:title / …:musician) — the
 *     protocol's own music shape, used whenever a page carries them;
 *  2. otherwise a music-note (🎵/🎶) attribution segment inside the
 *     page's public description/title — the common caption convention.
 * Everything else on the page (scripts, embedded JSON, DOM) is ignored
 * deliberately: this is metadata parsing, not scraping of internals.
 */
function extractPublicSongClue(html: string): SongClue | null {
  const ogSongTitle = metaContent(html, 'og:music:song:title');
  if (ogSongTitle !== null) {
    const musician = metaContent(html, 'og:music:song:musician');
    const parsed = validateClue(splitAttribution(ogSongTitle, musician ?? undefined));
    if (parsed !== null) return parsed;
  }

  const description =
    metaContent(html, 'og:description') ??
    metaContent(html, 'description') ??
    metaContent(html, 'og:title') ??
    documentTitle(html);
  if (description !== null) {
    const note = MUSIC_NOTE_PATTERN.exec(description);
    if (note !== null) {
      const parsed = validateClue(splitAttribution(stripTrailingTags(note[1])));
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

/** 🎵/🎶-prefixed segment of a public description (the caption convention). */
const MUSIC_NOTE_PATTERN = /(?:🎵|🎶)\s*([^🎵🎶\r\n]{2,160})/u;

/** Finds `content` of the <meta> tag whose property/name equals `key`. */
function metaContent(html: string, key: string): string | null {
  const wanted = key.toLowerCase();
  const tagPattern = /<meta\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(html)) !== null) {
    const attrs = parseAttributes(tagMatch[0]);
    const actual = attrs.get('property') ?? attrs.get('name');
    if (actual !== undefined && actual.toLowerCase() === wanted) {
      const content = attrs.get('content');
      if (content !== undefined && content.trim().length > 0) {
        return unescapeHtml(content).trim();
      }
    }
  }
  return null;
}

/** The document's <title>…</title> text — last-resort public metadata. */
function documentTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]{1,500})<\/title>/i.exec(html);
  if (match === null) return null;
  const text = unescapeHtml(match[1]).trim();
  return text.length > 0 ? text : null;
}

/** Minimal attribute parser for one meta tag (quoted values only). */
function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([A-Za-z_:][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    attributes.set(match[1].toLowerCase(), match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** Single-pass decode of the handful of entities real meta text uses. */
function unescapeHtml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/gi, (_whole, entity: string) => {
    switch (entity.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'nbsp':
        return ' ';
      case '#39':
      case '#x27':
        return "'";
      default:
        return _whole;
    }
  });
}

/** Drops trailing #hashtags / @handles from an extracted segment. */
function stripTrailingTags(text: string): string {
  return text.replace(/(?:\s+(?:#|@)\S+)+$/, '').replace(/\s+/g, ' ').trim();
}

/** Trim / collapse / strip edge separators from one attributed segment. */
function cleanSegment(text: string, maxLength: number): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'“”‘’·|,;:.!?\-–—]+/, '')
    .replace(/[\s"'“”‘’·|,;:.!?\-–—]+$/, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Splits an attributed string into title + optional artist using ONLY
 * explicit shapes: a known artist (from an OG tag), else a " - "/" – "
 * separator ("Blinding Lights - The Weeknd"). No separator → title only;
 * an artist is never guessed from word positions.
 */
function splitAttribution(
  text: string,
  knownArtist?: string,
): { title: string; artist?: string } {
  let title = text;
  let artist = knownArtist !== undefined && knownArtist.trim().length > 0
    ? knownArtist
    : undefined;
  if (artist === undefined) {
    const match = /^(.{2,120}?)\s+[-–—]\s+(.{1,80})$/.exec(text);
    if (match !== null) {
      title = match[1];
      artist = match[2];
    }
  }
  const cleanTitle = cleanSegment(title, 120);
  const cleanArtist = artist !== undefined ? cleanSegment(artist, 80) : undefined;
  return {
    title: cleanTitle,
    artist: cleanArtist !== undefined && cleanArtist.length > 0 ? cleanArtist : undefined,
  };
}

/** A clue must look like something searchable — never punctuation-only. */
function validateClue(parts: { title: string; artist?: string }): SongClue | null {
  const title = parts.title.trim();
  if (title.length < 2 || !/[\p{L}\p{N}]/u.test(title)) return null;
  const artist = parts.artist?.trim();
  if (artist !== undefined && artist.length > 0 && !/[\p{L}\p{N}]/u.test(artist)) {
    return { title, source: 'instagram-metadata' };
  }
  return {
    title,
    artist: artist !== undefined && artist.length > 0 ? artist : undefined,
    source: 'instagram-metadata',
  };
}

// ── Shared-text clue (user-provided, never claimed as Instagram data) ──

function buildSharedTextClue(raw: string | null): SongClue | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text.length < 3 || text.length > 100) return null;
  if (!/[\p{L}]/u.test(text)) return null;
  const parts = splitAttribution(text);
  const validated = validateClue(parts);
  if (validated === null) return null;
  return { title: validated.title, artist: validated.artist, source: 'shared-text' };
}

// ── Query building + matching (deterministic, no scores anywhere) ──────

function buildSearchQuery(clue: SongClue): string {
  const title = clue.title.trim();
  const artist = clue.artist?.trim() ?? '';
  const query = artist.length > 0 ? `${title} ${artist}` : title;
  return query.replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

/**
 * Title normalisation for MATCHING only: NFKC, case-folded, bracketed
 * decorations ("(Official Video)", "[Live]") removed, punctuation
 * collapsed. Deliberately local (same family as the recommendation
 * service's fold): matching is metadata equality with decoration
 * stripped — no fuzzy/edit-distance scoring exists anywhere.
 */
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collaboration markers inside ONE artist field ("A feat. B") — the same
 *  shapes library/grouping handles on the track side, applied to the clue
 *  so a credited collaboration never reads as a different artist. */
const FEAT_SPLIT = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;

/** Artist equality through the app's ONE artist normalisation (§9):
 *  exact or primary-segment match — "Queen" never reaches "Queen Latifah". */
function artistMatches(track: Track, clueArtist: string): boolean {
  if (trackMatchesArtist(track, clueArtist)) return true;
  const clueKey = normalizeArtistKey(clueArtist);
  const primary = clueKey.split(FEAT_SPLIT)[0].trim();
  return primary.length > 0 && primary !== clueKey && trackMatchesArtist(track, primary);
}

/** Token-sequence containment between normalized titles (near-exact). */
function titleNear(clueKey: string, candidateKey: string): boolean {
  if (clueKey.length === 0 || candidateKey.length === 0) return false;
  const shorter = clueKey.length <= candidateKey.length ? clueKey : candidateKey;
  const longer = clueKey.length <= candidateKey.length ? candidateKey : clueKey;
  // A fragment shorter than this is not title evidence (§25).
  if (shorter.length < 4) return false;
  if (longer.startsWith(`${shorter} `)) return true;
  if (longer.endsWith(` ${shorter}`)) return true;
  return longer.includes(` ${shorter} `);
}

/**
 * Conservative matching of ONE clue against provider results:
 *  - candidates are first de-duplicated at metadata level (local:123 and
 *    online:abc of the same song collapse to one row, provider order
 *    preserved) — playback identities are not involved here;
 *  - STRONG = exact normalized title (bracket decorations stripped), and
 *    — when the clue carries an artist — an exact/primary artist match.
 *    Exact title with a DIFFERENT artist is never strong;
 *  - WEAK = near-exact title only (clue without an artist), or exact
 *    title with a mismatched artist;
 *  - auto-play requires EXACTLY ONE strong candidate — anything else is
 *    an ambiguous picker (never silent wrong playback), and zero related
 *    candidates is an honest not-found.
 * No popularity, no provider-order-as-ranking claims, no scores: ties in
 * provider order are preserved, first strong candidate wins by stability.
 */
function matchClue(clue: SongClue, tracks: readonly Track[]): SongIdentificationResult {
  const clueTitleKey = normalizeForMatch(clue.title);
  if (clueTitleKey.length === 0) {
    return { status: 'unavailable', reason: 'no-public-metadata' };
  }
  const hasArtist = clue.artist !== undefined && clue.artist.length > 0;

  const deduped: Track[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    if (track.title.trim().length === 0 || track.artist.trim().length === 0) continue;
    const key = `${normalizeForMatch(track.title)}|${normalizeArtistKey(track.artist)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(track);
  }

  const strong: Track[] = [];
  const weak: Track[] = [];
  for (const track of deduped) {
    const titleKey = normalizeForMatch(track.title);
    if (titleKey === clueTitleKey) {
      if (!hasArtist || artistMatches(track, clue.artist as string)) {
        strong.push(track);
      } else {
        // Exact title, different artist: plausible, so it may be offered —
        // but never auto-played.
        weak.push(track);
      }
      continue;
    }
    if (!hasArtist && titleNear(clueTitleKey, titleKey)) {
      weak.push(track);
    }
  }

  if (strong.length === 1) {
    return { status: 'matched', clue, track: strong[0] };
  }
  if (strong.length > 1) {
    return { status: 'ambiguous', clue, candidates: strong.slice(0, MAX_CANDIDATES) };
  }
  if (weak.length > 0) {
    return { status: 'ambiguous', clue, candidates: weak.slice(0, MAX_CANDIDATES) };
  }
  return { status: 'not-found', clue };
}
