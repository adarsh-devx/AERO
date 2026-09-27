import type { PlayerController } from './PlayerController';
import type { PlaybackStatus } from './types';
import { getTrackArtworkUri } from '../core/types/track';
import {
  mediaControls,
  type MediaPlaybackMirrorState,
} from '../native/mediaControls';

/**
 * MediaControlsBridge: the ONE integration point between Android's media
 * surfaces (notification, lock screen, Bluetooth transport) and the
 * existing player architecture.
 *
 * Two directions, both thin:
 *
 *  - OUT (mirror): every PlayerController snapshot is mirrored into the
 *    native MediaSession/notification — current track, artwork, state,
 *    position and next/previous availability. Pushes are deduplicated in
 *    JS: metadata only when it actually changed, position when it moved
 *    by >= 2s (the system interpolates playback position in between).
 *    No timers are created — the bridge rides the controller's existing
 *    subscription, and the controller's engine already publishes ~2x/s
 *    while audio runs, not at all while idle.
 *
 *  - IN (commands): external commands are routed to the SAME
 *    PlayerController methods the UI uses — togglePlayPause, next,
 *    previous, seek, stop — so queue, shuffle, repeat, auto-next and the
 *    loading/error guards all apply unchanged. No queue logic exists
 *    here or in Kotlin.
 *
 * Degradation: without the native module (Expo Go, iOS) every call is a
 * no-op; playback itself never depends on this bridge.
 */

/** Position only re-pushes after moving this far; the system UI interpolates less. */
const POSITION_PUSH_THRESHOLD_MS = 2000;
const SEEK_STEP_MS = 10_000;

let disposers: Array<() => void> | null = null;
let lastMetaKey = '';
let lastPositionMs = 0;
let hasPushedOnce = false;

/**
 * Maps the snapshot status onto the mirror state.
 *
 * - 'stopped' (a track finished naturally; auto-advance immediately
 *   follows) mirrors as 'paused' so the notification never blinks off
 *   between tracks — and at the true end of the queue it correctly rests
 *   on a non-playing state.
 * - 'error' mirrors as 'paused': the track stays visible, the play
 *   action keeps its existing retry semantics.
 */
function mirrorStateOf(status: PlaybackStatus): MediaPlaybackMirrorState {
  switch (status) {
    case 'playing':
      return 'playing';
    case 'loading':
      return 'loading';
    default:
      return 'paused';
  }
}

function seekBy(controller: PlayerController, deltaMs: number): void {
  // controller.seek() itself refuses while loading/errored/no-track —
  // the existing state rules apply to external commands unchanged.
  const positionMs = controller.getSnapshot().positionMs;
  if (positionMs === null) return;
  void controller.seek(Math.max(0, positionMs + deltaMs));
}

function sync(controller: PlayerController): void {
  const snapshot = controller.getSnapshot();
  const track = snapshot.currentTrack;

  if (track === null) {
    // Explicit stop / idle: retire the notification (once).
    if (!hasPushedOnce || lastMetaKey === 'stopped') return;
    lastMetaKey = 'stopped';
    lastPositionMs = 0;
    hasPushedOnce = true;
    mediaControls.push({
      state: 'stopped',
      positionMs: 0,
      title: null,
      artist: null,
      album: null,
      artworkUri: null,
      durationMs: 0,
      hasPrevious: false,
      hasNext: false,
    });
    return;
  }

  const next = {
    state: mirrorStateOf(snapshot.status),
    positionMs: Math.round(snapshot.positionMs ?? 0),
    title: track.title ?? null,
    artist: track.artist ?? null,
    album: track.album ?? null,
    // Local MediaStore → content://, online → http (ytimg/artworkUri),
    // downloads keep their original artwork URI; undefined → null and the
    // native side renders the notification without artwork.
    artworkUri: getTrackArtworkUri(track) ?? null,
    durationMs: Math.round(snapshot.durationMs ?? track.durationMs ?? 0),
    hasPrevious: snapshot.hasPrevious,
    hasNext: snapshot.hasNext,
  };

  const metaKey = JSON.stringify([
    next.state,
    next.title,
    next.artist,
    next.album,
    next.artworkUri,
    next.durationMs,
    next.hasPrevious,
    next.hasNext,
  ]);
  const movedMs = Math.abs(next.positionMs - lastPositionMs);
  if (metaKey === lastMetaKey && movedMs < POSITION_PUSH_THRESHOLD_MS) return;

  lastMetaKey = metaKey;
  lastPositionMs = next.positionMs;
  hasPushedOnce = true;
  mediaControls.push(next);
}

/**
 * Starts the bridge exactly once. Safe to call again (hot reload): the
 * second call is a no-op, so no duplicated native listeners or store
 * subscriptions can exist.
 */
export function startMediaControlsBridge(controller: PlayerController): void {
  if (disposers !== null) return;

  const onCommand = mediaControls.subscribeCommands((event) => {
    const snapshot = controller.getSnapshot();
    switch (event.command) {
      case 'toggle':
        void controller.togglePlayPause();
        break;
      case 'play':
        // Explicit play/pause only act in the state that makes them true;
        // toggle covers loading (no-op) and error (retry) by itself.
        if (snapshot.status !== 'playing') void controller.togglePlayPause();
        break;
      case 'pause':
        if (snapshot.status === 'playing') void controller.togglePlayPause();
        break;
      case 'next':
        void controller.next();
        break;
      case 'previous':
        void controller.previous();
        break;
      case 'seekTo':
        if (typeof event.positionMs === 'number') {
          void controller.seek(event.positionMs);
        }
        break;
      case 'seekForward':
        seekBy(controller, SEEK_STEP_MS);
        break;
      case 'seekBackward':
        seekBy(controller, -SEEK_STEP_MS);
        break;
      case 'stop':
        void controller.stop();
        break;
    }
  });

  // Wired unplugged / Bluetooth audio output removed: pause only when
  // actually playing — never fight an unrelated state change.
  const onAudioNoisy = mediaControls.subscribeAudioNoisy(() => {
    if (controller.getSnapshot().status === 'playing') {
      void controller.togglePlayPause();
    }
  });

  const onSnapshot = controller.subscribe(() => sync(controller));
  sync(controller);

  disposers = [onCommand, onAudioNoisy, onSnapshot];
}
