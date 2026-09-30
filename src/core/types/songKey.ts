import type { Track } from './track';

/**
 * Canonical RECOMMENDATION/DISPLAY-level song key — the ONE
 * implementation shared by Home section dedup, Recently Played display
 * dedup, autoplay and the automatic Up Next batch. Nothing in this module
 * may be re-implemented inside a screen or service.
 *
 * IMPORTANT: this is NOT playback identity. `trackIdentityKey()`
 * (origin:id) remains the true storage/playback identity and is never
 * affected by anything here — local:X and online:X stay distinct wherever
 * the system needs real records (queues, history, likes, downloads).
 *
 * This key answers a different question: "is this the SAME SONG as the
 * user would see it?" — so "Blinding Lights (Official Video)",
 * "Blinding Lights - Official Audio", "Blinding Lights [Lyrics]" and
 * "Blinding Lights — The Weeknd Topic" all collapse to ONE song.
 *
 * Version policy (explicit recommendation policy, applied uniformly):
 * - presentation-only suffixes (Official Video / Official Audio / Music
 *   Video / Lyrics / Lyric Video / Visualizer / HD / 4K / Audio / Video…)
 *   are ALWAYS stripped — they are the same recording;
 * - alternate-recording suffixes (Remix / Live / Acoustic / Instrumental
 *   / Karaoke / Slowed / Sped Up / Cover…) are collapsed into the same
 *   song key ONLY because the recommendation policy explicitly treats
 *   them as alternate uploads of one base song — see
 *   alternateVersionCount(), which prefers the canonical (marker-free)
 *   upload whenever both appear. They are never stripped from display
 *   text: the user still sees the record's real title.
 * Only TRAILING markers are stripped, so real titles like "Video Games"
 * or "Shut Up" are never mangled, and a lone one-word title ("Video") is
 * never emptied.
 */

/** Presentation/alternate-version phrase suffixes — see module doc. */
const VERSION_SUFFIX_PHRASES: readonly string[] = [
  'official music video',
  'official video song',
  'official video',
  'official audio',
  'lyric video',
  'lyrics video',
  'music video',
  'video song',
  'audio song',
  'watch video',
  'full video song',
  'full audio song',
  'full video',
  'full audio',
  'full song',
  'sped up',
  'slowed down',
  'slowed reverb',
  'slowed and reverb',
  'with lyrics',
  '8d audio',
];

const VERSION_SUFFIX_WORDS = new Set([
  // Presentation variants of the SAME recording.
  'official',
  'audio',
  'video',
  'lyrics',
  'lyric',
  'visualizer',
  'visualiser',
  'hd',
  '4k',
  '1080p',
  'hq',
  'mv',
  'song',
  'songs',
  'track',
  'watch',
  'status',
  'ringtone',
  'bgm',
  'ost',
  'ver',
  'version',
  // Alternate-recording suffixes: folded into the same song key so one
  // song = one candidate; the canonical upload then wins on count (see
  // alternateVersionCount) — never a hardcoded channel allowlist.
  'live',
  'remix',
  'remixed',
  'acoustic',
  'cover',
  'slowed',
  'nightcore',
  'instrumental',
  'karaoke',
  'extended',
  'reverb',
  'demo',
  'unplugged',
  'mashup',
  'edit',
  'lofi',
  'lo-fi',
]);

function stripVersionSuffix(folded: string): string {
  let words = folded.split(' ').filter(Boolean);
  let changed = true;
  while (changed && words.length > 1) {
    changed = false;
    const tail = words.join(' ');
    for (const phrase of VERSION_SUFFIX_PHRASES) {
      if (
        tail === phrase ||
        (tail.length > phrase.length + 1 &&
          tail.endsWith(phrase) &&
          tail[tail.length - phrase.length - 1] === ' ')
      ) {
        words = words.slice(0, words.length - phrase.split(' ').length);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    if (VERSION_SUFFIX_WORDS.has(words[words.length - 1])) {
      words.pop();
      changed = true;
    }
  }
  return words.join(' ');
}

/**
 * Normalizes common phonetic/romanization spelling variants in music metadata
 * (e.g. "Udaariyan" -> "udarian", "Udaarian" -> "udarian", "Kesariya" -> "kesaria", "Deewani" -> "diwani")
 */
export function normalizePhoneticVariants(text: string): string {
  if (!text) return '';
  return text
    // Normalize repeated dots/symbols: "song......." -> "song"
    .replace(/[._\-–—~]+/g, ' ')
    // Normalize doubled vowels: "aa" -> "a", "ee" -> "i", "oo" -> "u", "ii" -> "i"
    .replace(/aa+/g, 'a')
    .replace(/ee+/g, 'i')
    .replace(/oo+/g, 'u')
    .replace(/ii+/g, 'i')
    // Normalize suffixes: "iyan", "iyaan", "iya" -> "ian" (e.g. "udaariyan" / "udaarian" -> "udarian")
    .replace(/iya+n?\b/g, 'ian')
    .replace(/ya+n?\b/g, 'an')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts canonical title by stripping YouTube descriptors, multi-segment
 * pipe/dash tags (movie names, actor credits, channel names), brackets, and suffixes.
 */
export function extractCanonicalTitle(rawTitle: string, rawArtist?: string): string {
  if (!rawTitle) return '';
  let text = rawTitle.normalize('NFKC');

  // 1. Remove bracketed content: (Lyrics), [Slowed + Reverb], (From "Movie"), (feat. Artist), etc.
  text = text.replace(/\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}/g, ' ');

  // 2. Remove surrounding/embedded quotes around song title: "Kaise Hua" -> Kaise Hua
  text = text.replace(/["'“”‘’«»]/g, ' ');

  // 3. Remove leading YouTube descriptors: "LYRICAL: Kaise Hua", "Full Song: Kaise Hua", etc.
  text = text.replace(
    /^\s*(?:lyrical(?:\s+video)?|lyrics?|full\s+(?:song|video|audio|track)|official\s+(?:music\s+)?(?:video|audio)|video\s+song|audio\s+song|audio|video|teaser|trailer|promo|hd|4k|original|latest|new\s+song|exclusive)\s*[:\-–—|]\s*/i,
    '',
  );

  // 4. Split by primary delimiters (pipe |, forward-slash /, bullet •, em-dash —, en-dash –)
  const segments = text
    .split(/\s*[\/|•–—]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  let mainSegment = segments[0] || text;

  // If the segment still has a colon (e.g. "Kabir Singh : Kaise Hua" or "LYRICAL : Kaise Hua"):
  if (mainSegment.includes(':')) {
    const parts = mainSegment.split(':').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const right = parts.slice(1).join(' ').trim();
      if (right.length > 0) {
        mainSegment = right;
      }
    }
  }

  // If the segment has " - " (e.g. "Song Title - Movie Name" or "Artist - Song Title"):
  if (mainSegment.includes(' - ')) {
    const parts = mainSegment.split(' - ').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts[0].length > 0) {
      mainSegment = parts[0];
    }
  }

  // 5. Clean punctuation, symbols, extra whitespace
  let cleaned = mainSegment
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 6. Strip artist name from title if embedded (e.g. "Udaarian Satinder Sartaaj" with artist "Satinder Sartaaj")
  if (rawArtist) {
    const cleanArtist = rawArtist.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').trim();
    if (cleanArtist.length > 2 && cleaned.includes(cleanArtist)) {
      cleaned = cleaned.replace(cleanArtist, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // 7. Strip version suffixes (e.g. "lyrics", "official video", "slowed reverb", "remix")
  const stripped = stripVersionSuffix(cleaned);
  const baseTitle = stripped.length > 0 ? stripped : cleaned;

  // 8. Apply phonetic / vowel normalization
  return normalizePhoneticVariants(baseTitle);
}

/**
 * Case/whitespace/punctuation-insensitive fold for recommendation-level
 * identity comparisons (song keys, artist diversity caps, section
 * merging). Metadata equality with decoration removed, nothing looser.
 */
export function fold(text: string, rawArtist?: string): string {
  return extractCanonicalTitle(text, rawArtist);
}

/**
 * Primary-artist key for recommendation-level comparisons:
 * trims featured artist formats ("A feat. B", "A ft. B", "A with B" -> "A").
 */
export function artistKey(artistName: string): string {
  const folded = fold(artistName);
  const primary = folded.split(/\s+(?:feat|ft|featuring|with)\s+/)[0];
  return (primary ?? folded).trim();
}

/**
 * The canonical song key: same folded title = same song. Used for Home
 * section dedup, cross-section feed dedup, Recently Played display dedup,
 * search dedup, and automatic-queue recommendation dedup.
 */
export function songKey(track: Track): string {
  return fold(track.title, track.artist);
}

/**
 * How many alternate-recording markers a raw title carries (live, remix,
 * slowed, cover, acoustic…). Used when two uploads share one song key:
 * the upload with FEWER markers wins, so the canonical/normal song is
 * preferred whenever metadata allows — no channel allowlists, no invented
 * quality scores.
 */
export function alternateVersionCount(title: string): number {
  const pattern =
    /\b(?:live|remix(?:ed)?|acoustic|cover|slowed|sped up|nightcore|instrumental|karaoke|extended|reverb|demo|unplugged|mashup)\b/g;
  const normalized = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ');
  return normalized.match(pattern)?.length ?? 0;
}

/**
 * Display dedup for CHRONOLOGICAL lists (Recently Played): keeps the
 * FIRST occurrence of each canonical song in the given order and drops
 * later ones — with a newest-first input (the playback-history snapshot)
 * that is exactly "show the newest record of each song once, in
 * chronological order". Pure display: the underlying history records are
 * never rewritten, deleted or reordered. O(N) with a Set.
 */
export function dedupeNewestFirst(tracks: readonly Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const track of tracks) {
    const key = songKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
  }
  return out;
}

/**
 * Display selection for ONE Home feed section, in feed order:
 * - CROSS-SECTION dedup: any canonical song already claimed by an
 *   EARLIER section (`shownSongKeys`) is excluded outright — the same
 *   song never appears in Quick picks AND Because You Played AND
 *   Trending. The set is MUTATED: this section's keys are added, so the
 *   caller threads one set through the whole feed in render order.
 * - WITHIN-SECTION song dedup: one entry per canonical song.
 * - ARTIST DIVERSITY: hard cap `maxPerArtist` (default 3 ≈ the 2–3 rule),
 *   and never the same artist on two consecutive cards — adjacency-blocked
 *   candidates get one bounded retry pass once the last pick changes.
 * Input order is preserved (stable): recommendations keep their
 * ranking/provider order; history-like lists keep their order. No
 * randomization, no invented signals. O(N) passes over Set/Map only.
 */
export function selectDistinctForDisplay(
  tracks: readonly Track[],
  shownSongKeys: Set<string>,
  options?: { readonly maxPerArtist?: number },
): Track[] {
  const maxPerArtist = options?.maxPerArtist ?? 3;
  const artistCounts = new Map<string, number>();
  const taken: Track[] = [];
  let deferred: Track[] = [];

  const tryTake = (track: Track): 'take' | 'defer' | 'skip' => {
    const key = songKey(track);
    if (shownSongKeys.has(key)) return 'skip';
    const artist = artistKey(track.artist);
    if ((artistCounts.get(artist) ?? 0) >= maxPerArtist) return 'skip';
    const lastArtist =
      taken.length > 0 ? artistKey(taken[taken.length - 1].artist) : null;
    if (artist === lastArtist) return 'defer';
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    taken.push(track);
    shownSongKeys.add(key);
    return 'take';
  };

  for (const track of tracks) {
    if (tryTake(track) === 'defer') deferred.push(track);
  }
  // One bounded retry loop for adjacency-blocked candidates: it only
  // continues while a track is actually taken (deferred shrinks each
  // round), so it can never spin.
  let progress = true;
  while (progress && deferred.length > 0) {
    progress = false;
    const remaining: Track[] = [];
    for (const track of deferred) {
      if (tryTake(track) === 'take') progress = true;
      else remaining.push(track);
    }
    deferred = remaining;
  }
  return taken;
}
