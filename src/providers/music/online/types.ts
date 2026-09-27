import type { MusicProvider } from '../types';

/**
 * Contract for an ONLINE (remote catalogue) music provider.
 *
 * Implemented by `YouTubeMusicProvider` (InnerTube discovery: search +
 * suggestions). The rest of the application never imports that class — it goes
 * through MusicService — so a different catalogue can be dropped in here later
 * without touching the UI or the playback pipeline.
 *
 * This boundary is discovery ONLY: an OnlineMusicProvider produces Tracks, never
 * audio. Stream resolution stays behind the stream layer
 * (`providers/stream/*`, native NewPipe extractor).
 */
export interface OnlineMusicProvider extends MusicProvider {
  readonly id: 'online';
}
