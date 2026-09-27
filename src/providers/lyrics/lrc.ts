import type { LyricsLine } from '../../core/types/lyrics';

/**
 * Parses LRC-style timestamped text into structured lines.
 *
 * Supported per line (the formats real providers emit):
 *   [00:12.30] text   (centiseconds)
 *   [00:12.300] text  (milliseconds)
 *   [00:12] text      (whole seconds)
 *   [00:12.30][01:40.00] text  (repeated tags → one line per timestamp)
 *
 * Non-timestamp tags ([ar:…], [ti:…], [length:…]) are ignored, lines
 * without a valid timestamp are dropped, results are sorted by time,
 * and each line's endMs is derived from the next line's start.
 *
 * Returns [] when nothing timestamped could be parsed — callers then
 * fall back to plain lyrics or report "no lyrics". Timing stays pure
 * data: the audio engine is never consulted here.
 */
export function parseLrc(source: string): LyricsLine[] {
  const tagPattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const lines: LyricsLine[] = [];

  for (const raw of source.split(/\r?\n/)) {
    tagPattern.lastIndex = 0;
    const starts: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(raw)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (seconds >= 60) continue;
      const fraction = match[3];
      // ".3" → 300ms, ".30" → 300ms, ".300" → 300ms (pad, don't scale).
      const millis = fraction ? Number(fraction.padEnd(3, '0')) : 0;
      starts.push(minutes * 60_000 + seconds * 1_000 + millis);
    }
    if (starts.length === 0) continue;

    const text = raw.replace(tagPattern, '').trim();
    if (text.length === 0) continue;
    for (const startMs of starts) {
      lines.push({ text, startMs });
    }
  }

  lines.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  for (let i = 0; i < lines.length - 1; i += 1) {
    lines[i].endMs = lines[i + 1].startMs;
  }
  return lines;
}
