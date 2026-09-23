import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

const { VoiceSearchModule } = NativeModules;

export interface VoiceSearchResult {
  success: boolean;
  query?: string;
  error?: string;
}

/**
 * Starts native Android speech recognition.
 * Prompts user for RECORD_AUDIO permission if not granted.
 */
export async function startVoiceSearch(): Promise<VoiceSearchResult> {
  if (Platform.OS !== 'android') {
    return { success: false, error: 'Voice search is only supported on Android' };
  }

  try {
    const hasPermission = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );

    if (!hasPermission) {
      const status = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'Aero needs access to your microphone for voice search.',
          buttonPositive: 'Allow',
          buttonNegative: 'Cancel',
        },
      );

      if (status !== PermissionsAndroid.RESULTS.GRANTED) {
        return { success: false, error: 'Microphone permission denied' };
      }
    }

    if (!VoiceSearchModule?.startSpeechRecognition) {
      return { success: false, error: 'Voice recognition module not available' };
    }

    const recognizedText: string = await VoiceSearchModule.startSpeechRecognition();
    if (recognizedText && recognizedText.trim().length > 0) {
      return { success: true, query: recognizedText.trim() };
    }

    return { success: false, error: 'No speech recognized' };
  } catch (err: any) {
    // User cancelled or back pressed
    if (err?.code === 'E_CANCELLED') {
      return { success: false, error: 'Cancelled' };
    }
    return { success: false, error: err?.message ?? 'Voice search failed' };
  }
}
