import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNavigator } from './src/navigation';
import { warmUpPlaybackStack } from './src/playback/ExperimentalTrackPreloader';

// Pay the fixed cold-start costs of the play path before the user's first tap:
// the single native AudioPlayer is otherwise constructed lazily inside the
// first engine.load(), and NewPipe.init + the extractor's service registry are
// otherwise the first statements of the first resolution. Both would then sit
// on the critical path of whichever track the user opens first — including
// from Home, which never runs the Search prewarm.
//
// Runs at module scope so it starts in parallel with navigation setup. It is
// idempotent, issues no network request, resolves no stream, starts no
// playback, and swallows every failure; ExpoAudioPlaybackEngine already does
// native audio setup (setAudioModeAsync) at import time for the same reason.
warmUpPlaybackStack();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}

