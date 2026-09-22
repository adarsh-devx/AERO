/**
 * Feature constants for persistent local collections.
 */

/** Maximum number of tracks retained; oldest entries fall off the end. */
export const PLAYBACK_HISTORY_LIMIT = 50;

/** Storage key under which the history JSON array is persisted. */
export const PLAYBACK_HISTORY_STORAGE_KEY = 'aero.playbackHistory.v1';
