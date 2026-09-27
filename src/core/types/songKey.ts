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
  'official video',
  'official audio',
  'lyric video',
  'lyrics video',
  'music video',
  'sped up',
  'slowed down',
  'slowed reverb',
  'with lyrics',
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
]);

function stripVersionSuffix(folded: string): string {
  let words = folded.split(' ');
  let changed = true;
  while (changed && words.length > 1) {
    changed = false;
    const tail = words.join(' ');
    for (const phrase of VERSION_SUFFIX_PHRASES) {
      if (
        tail.length > phrase.length + 1 &&
        tail.endsWith(phrase) &&
        tail[tail.length - phrase.length - 1] === ' '
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
 * Case/whitespace/punctuation-insensitive fold for recommendation-level
 * identity comparisons (song keys, artist diversity caps, section
 * merging). Metadata equality with decoration removed, nothing looser:
 * NFKC covers NFC equivalence, bracketed suffixes are dropped, then
 * trailing version markers are stripped so alternate uploads of one song
 * fold together. Never used as playback identity.
 */
export function fold(text: string): string {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripVersionSuffix(normalized);
}

/**
 * Primary-artist key for recommendation-level comparisons (artist
 * diversity caps and the song key): fold() handles case, whitespace,
 * NFKC and bracketed credits ("Artist (feat. X)"), and this trims the
 * remaining in-line featured forms — "A feat. B", "A ft. B",
 * "A featuring B", "A with B" → "A" — so uploads crediting a guest
 * differently still read as one artist. Channel names never enter this:
 * Track carries provider METADATA only (no channel field).
 */
export function artistKey(artistName: string): string {
  const folded = fold(artistName);
  const primary = folded.split(/\s+(?:feat|ft|featuring|with)\s+/)[0];
  return (primary ?? folded).trim();
}

/**
 * The canonical song key: same folded title + PRIMARY artist. Used for
 * Home section dedup, cross-section feed dedup, Recently Played display
 * dedup and automatic-queue recommendation dedup — everywhere a "same
 * song" question is asked. Playback identity stays trackIdentityKey().
 */
export function songKey(track: Track): string {
  return `${fold(track.title)}|${artistKey(track.artist)}`;
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
