import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import type { Track } from '../../core/types/track';
import { getShareIntentModule } from '../../../modules/share-intent';
import { navigationRef } from '../../navigation/navigationRef';
import {
  instagramSongIdentifier,
  musicService,
  playerController,
} from '../../services/composition';
import { extractSharedClue, parseSharedLink, type SharedInstagramLink } from './parseSharedLink';

export interface SharedLinkHandlerState {
  /** True while a shared link is being identified — drives the small banner. */
  readonly processing: boolean;
  /** Banner text for the current identification ("Finding track…", Reel variant). */
  readonly message: string;
  /**
   * Non-null while an ambiguous identification waits for the user's
   * choice ("Which song is this?" sheet). Nothing plays until they pick.
   */
  readonly candidates: readonly Track[] | null;
  /** The user's explicit candidate choice — plays through the normal path. */
  readonly selectCandidate: (track: Track) => void;
  /** Cancel the open picker: closes it and changes nothing else. */
  readonly dismissCandidates: () => void;
}

/** Queue-first (published synchronously), then Now Playing — the EXACT same
 *  behavior as tapping a Search result. Never called before a Track exists. */
function playAndOpen(track: Track): void {
  void playerController.playFromQueue([track], 0);
  if (navigationRef.isReady()) {
    navigationRef.navigate('NowPlaying');
  }
}

/** Manual-identification escape hatch: the existing Search flow. */
function openSearch(): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Search');
  }
}

/**
 * Receives incoming Android link payloads — share-sheet text (ACTION_SEND)
 * AND opened URLs (ACTION_VIEW deep links) — and turns them into one Track
 * through the EXISTING pipeline. Both intent kinds converge on the same
 * processSharedText below: one parser (parseSharedLink), one
 * request-generation path, one playback path. No second URL-resolution
 * system, no queue mutation on failure, no persistence of anything
 * incoming.
 *
 * Two link families share this single path:
 *  - YouTube: parse → MusicService.getTrack(id) → Track (unchanged,
 *    byte-for-byte same guards/messages as before);
 *  - Instagram Reel: parse → InstagramSongIdentifier (public metadata →
 *    one MusicService.search → conservative matching) → matched track
 *    plays through the same path; an ambiguous result waits for the user
 *    in the candidate picker; failure shows an honest message with an
 *    optional shortcut into the existing Search flow. Reel media itself
 *    is never fetched or played — only the SONG is identified.
 *
 * Protection against duplicates and races:
 *  - native delivery is exactly-once (payload consumed on read: EXTRA_TEXT
 *    removed for shares, intent data cleared for opened links);
 *  - identical text already being processed is ignored (in-flight guard);
 *  - a monotonically increasing request id makes the LATEST shared link win
 *    — a slow resolution (YouTube or Reel) that finishes after a newer
 *    link arrived is discarded before it can navigate, play or open a
 *    picker, and opening ANY new link clears a picker left by a previous
 *    ambiguous result (§14);
 *  - the current-track selection is captured before resolving: if the user
 *    (or auto-advance) selected anything while identifying, the stale
 *    result must not hijack playback or navigation. The ONLY deliberate
 *    exception is an explicit tap inside an open picker — that is direct
 *    user intent for the latest request.
 *
 * Current playback is never touched until a Track has been identified
 * successfully, so a failed share leaves whatever was playing exactly as
 * it was (§12/§13).
 */
export function useSharedLinkHandler(): SharedLinkHandlerState {
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('Finding track…');
  const [candidates, setCandidates] = useState<readonly Track[] | null>(null);
  const requestIdRef = useRef(0);
  const inFlightTextRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const shareModule = getShareIntentModule();
    // Not linked (e.g. Expo Go): the feature is simply unavailable — no
    // crash, no retry loop, no fake state.
    if (shareModule === null) return undefined;

    /** YouTube: exact id lookup — unchanged flow, unchanged guards. */
    const resolveYouTubeLink = async (
      requestId: number,
      selectionBefore: Track | null,
      videoId: string,
    ): Promise<void> => {
      const track = await musicService.getTrack(videoId);

      // A newer shared link superseded this one (latest request wins).
      if (requestId !== requestIdRef.current) return;
      // The player moved on while we were resolving — do not hijack it.
      if (playerController.getSnapshot().currentTrack !== selectionBefore) return;

      if (track === null) {
        Alert.alert(
          "Couldn't find this track.",
          'The shared link did not match a playable track.',
        );
        return;
      }

      // Same behavior as tapping a Search result: queue first (published
      // synchronously, status 'loading'), then open Now Playing.
      playAndOpen(track);
    };

    /** Instagram Reel: identify the SONG, then act on the honest result. */
    const identifyInstagramReel = async (
      requestId: number,
      selectionBefore: Track | null,
      rawText: string,
      link: SharedInstagramLink,
    ): Promise<void> => {
      const result = await instagramSongIdentifier.identify(link, extractSharedClue(rawText));

      // Same stale guards as the YouTube path: a newer link wins, and a
      // manual selection made while identifying may never be hijacked —
      // a Reel result arrives too late to override the user (§13/§14).
      if (requestId !== requestIdRef.current) return;
      if (playerController.getSnapshot().currentTrack !== selectionBefore) return;

      if (result.status === 'matched') {
        // Exact, unambiguous title/artist match → the SAME playback path
        // as a Search result tap. No confidence score is shown or stored.
        playAndOpen(result.track);
        return;
      }

      if (result.status === 'ambiguous') {
        // Several plausible candidates: the user chooses; nothing plays
        // until they do (never silently pick a song for them).
        if (mountedRef.current) setCandidates(result.candidates);
        return;
      }

      if (result.status === 'not-found') {
        Alert.alert(
          "Couldn't find this song.",
          "Aero's music providers didn't find a match for this Reel's song. You can search for it instead.",
          [
            { text: 'Search song', onPress: openSearch },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }

      // 'unavailable': the platform didn't expose the information — say so
      // honestly instead of guessing (§29).
      Alert.alert(
        "Couldn't identify the song.",
        result.reason === 'network'
          ? "Aero couldn't read this Reel's public page right now. Try again, or search for the song."
          : "Instagram doesn't expose enough song information for this Reel. You can search for the song instead.",
        [
          { text: 'Search song', onPress: openSearch },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    };

    const processSharedText = async (raw: string): Promise<void> => {
      const link = parseSharedLink(raw);
      if (link === null) {
        Alert.alert(
          "This link isn't supported.",
          'Share a YouTube, YouTube Music or Instagram Reel link to open it in Aero.',
        );
        return;
      }

      // Duplicate delivery of the SAME text while it is still resolving.
      if (inFlightTextRef.current === raw) return;

      const requestId = ++requestIdRef.current;
      // Capture the user's selection: a manual play during resolution means
      // this shared result is stale and may neither play nor navigate.
      const selectionBefore = playerController.getSnapshot().currentTrack;
      inFlightTextRef.current = raw;
      if (mountedRef.current) {
        // Any new link supersedes a previously opened picker: it belongs
        // to an older request and must not linger (§14).
        setCandidates(null);
        setProcessing(true);
        setMessage(
          link.provider === 'instagram' ? "Finding this Reel's song…" : 'Finding track…',
        );
      }

      try {
        if (link.provider === 'instagram') {
          await identifyInstagramReel(requestId, selectionBefore, raw, link);
        } else {
          await resolveYouTubeLink(requestId, selectionBefore, link.videoId);
        }
      } catch {
        // Generic message only — no internal/HTTP/NewPipe details.
        if (requestId !== requestIdRef.current) return;
        Alert.alert(
          "Couldn't load this link.",
          'Aero could not load the shared link right now. Please try again.',
        );
      } finally {
        // Only the latest request owns the shared UI state.
        if (requestId === requestIdRef.current) {
          inFlightTextRef.current = null;
          if (mountedRef.current) setProcessing(false);
        }
      }
    };

    // Register the listener BEFORE the initial read: an intent arriving
    // during startup is parked natively as pending text and recovered by
    // getInitialSharedText(), so no delivery window is missed.
    const subscription = shareModule.addListener('onSharedText', (event) => {
      if (typeof event?.text === 'string') void processSharedText(event.text);
    });

    void (async () => {
      try {
        const initial = await shareModule.getInitialSharedText();
        if (typeof initial === 'string' && initial.length > 0) {
          void processSharedText(initial);
        }
      } catch {
        // Native read unavailable: nothing to process.
      }
    })();

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1; // invalidate any in-flight resolution
      subscription.remove();
    };
  }, []);

  const selectCandidate = (track: Track): void => {
    // Explicit user choice from the OPEN picker: the picker only exists
    // while its request is the latest one (any new link closes it), so
    // this is direct user intent — same queue-first path as a Search tap.
    setCandidates(null);
    playAndOpen(track);
  };

  const dismissCandidates = (): void => {
    // Cancel (§12H): close the sheet; playback, queue and shared-link
    // state are left exactly as they were.
    setCandidates(null);
  };

  return { processing, message, candidates, selectCandidate, dismissCandidates };
}
