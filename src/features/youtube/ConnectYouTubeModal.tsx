import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';

import { homeColors } from '../home/theme';
import { TactilePressable } from '../common/TactilePressable';
import { GOOGLE_CLIENT_ID } from '../../config/googleConfig';
import { youtubeAuthStore } from './YouTubeAuthStore';
import { youtubeAccountService } from './YouTubeAccountService';

WebBrowser.maybeCompleteAuthSession();

interface ConnectYouTubeModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSuccess?: () => void;
}

export function ConnectYouTubeModal({
  visible,
  onClose,
  onSuccess,
}: ConnectYouTubeModalProps) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting…');
  const [playlistUrlInput, setPlaylistUrlInput] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);

  const handleGoogleConnect = async () => {
    const cleanClientId = (GOOGLE_CLIENT_ID || '').trim();
    if (!cleanClientId) {
      Alert.alert(
        'Client ID Required',
        'Please add your Google Client ID in `.env` (EXPO_PUBLIC_GOOGLE_CLIENT_ID) or in `src/config/googleConfig.ts` to enable Google Sign-In.',
      );
      return;
    }

    setLoading(true);
    setStatusMessage('Opening Google Account Picker…');

    try {
      // Google Android Reverse Client ID Scheme format:
      // com.googleusercontent.apps.<prefix>:/oauth2redirect
      const clientIdPrefix = cleanClientId.replace('.apps.googleusercontent.com', '');
      const redirectUri = `com.googleusercontent.apps.${clientIdPrefix}:/oauth2redirect`;

      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(cleanClientId)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent('openid profile email https://www.googleapis.com/auth/youtube.readonly')}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&access_type=offline` +
        `&prompt=select_account%20consent` +
        `&nonce=${Date.now()}`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === 'success' && result.url) {
        setStatusMessage('Syncing your profile…');

        const searchParams = new URLSearchParams(
          result.url.includes('?') ? result.url.split('?')[1] : result.url.split('#')[1] || '',
        );
        const code = searchParams.get('code');
        let accessToken = searchParams.get('access_token');
        let refreshToken: string | null = null;
        let expiresIn: number = 3600;

        // If authorization code was returned, exchange it for access_token
        if (code && !accessToken) {
          try {
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: cleanClientId,
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
              }).toString(),
            });
            const tokenData = await tokenRes.json();
            accessToken = tokenData.access_token;
            refreshToken = tokenData.refresh_token || null;
            expiresIn = tokenData.expires_in || 3600;
          } catch (tokenErr) {
            console.warn('[ConnectYouTube] Token exchange error:', tokenErr);
          }
        }

        if (accessToken) {
          try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const userInfo = await userInfoRes.json();

            await youtubeAuthStore.setOAuthSession(accessToken, {
              name: userInfo.name || 'YouTube User',
              email: userInfo.email,
              avatarUrl: userInfo.picture,
            }, refreshToken, expiresIn);

            Alert.alert('Connected! 🎉', `Welcome, ${userInfo.name || 'User'}!`);
            onSuccess?.();
            onClose();
            return;
          } catch (e) {
            console.warn('[ConnectYouTube] Failed to fetch userinfo:', e);
          }
        }
      }
    } catch (error: any) {
      console.warn('[ConnectYouTube] Google Auth error:', error);
      Alert.alert('Sign-in cancelled', 'Could not complete Google sign-in.');
    } finally {
      setLoading(false);
    }
  };

  const handleImportByUrl = async () => {
    const trimmed = playlistUrlInput.trim();
    if (!trimmed) return;

    const listMatch = trimmed.match(/[?&]list=([^&]+)/);
    if (!listMatch) {
      Alert.alert(
        'Invalid URL',
        'Please enter a valid YouTube or YouTube Music playlist link.',
      );
      return;
    }

    const playlistId = listMatch[1];
    setImportingUrl(true);

    try {
      const result = await youtubeAccountService.importPlaylistToAero({
        id: playlistId,
        title: 'Imported YouTube Playlist',
      });

      if (result.success) {
        Alert.alert(
          'Playlist Imported! 🎉',
          `Successfully imported ${result.trackCount} tracks to your Aero Library.`,
        );
        setPlaylistUrlInput('');
        onClose();
      } else {
        Alert.alert(
          "Couldn't import",
          'No playable tracks were found in this playlist.',
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to import playlist from link.');
    } finally {
      setImportingUrl(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { paddingTop: insets.top + 20 }]}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="logo-youtube" size={24} color="#ff0000" />
              <Text style={styles.headerTitle}>Connect with YouTube</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={homeColors.text} />
            </Pressable>
          </View>

          {/* Body */}
          <View style={styles.body}>
            <Text style={styles.description}>
              Sign in with your Google account to sync your playlists, liked
              music, and personalized mixes in Aero.
            </Text>

            {/* 1. Continue with Google Button (Image 2 Style) */}
            <TactilePressable
              activeScale={0.96}
              style={styles.googleButton}
              onPress={handleGoogleConnect}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              {loading ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={20} color="#4285F4" />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </>
              )}
            </TactilePressable>

            {loading && <Text style={styles.statusText}>{statusMessage}</Text>}

            {/* Divider */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR IMPORT LINK</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* 2. Direct Playlist URL Import (Zero-Login) */}
            <View style={styles.urlImportBox}>
              <TextInput
                style={styles.urlInput}
                placeholder="Paste YouTube playlist link here…"
                placeholderTextColor="#8e8e93"
                value={playlistUrlInput}
                onChangeText={setPlaylistUrlInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TactilePressable
                activeScale={0.94}
                style={[
                  styles.importLinkButton,
                  !playlistUrlInput.trim() && styles.importLinkButtonDisabled,
                ]}
                disabled={!playlistUrlInput.trim() || importingUrl}
                onPress={handleImportByUrl}
                accessibilityRole="button"
                accessibilityLabel="Import playlist link"
              >
                {importingUrl ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <Text style={styles.importLinkButtonText}>Import</Text>
                )}
              </TactilePressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    backgroundColor: '#16161e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  body: {
    padding: 20,
    gap: 16,
  },
  description: {
    fontSize: 13,
    color: homeColors.textMuted,
    lineHeight: 18,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f1f1f',
  },
  statusText: {
    fontSize: 12,
    color: '#4cc9f0',
    textAlign: 'center',
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  dividerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8e8e93',
    letterSpacing: 0.8,
  },
  urlImportBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    paddingLeft: 12,
  },
  urlInput: {
    flex: 1,
    height: 44,
    fontSize: 13,
    color: '#ffffff',
  },
  importLinkButton: {
    backgroundColor: '#4cc9f0',
    paddingHorizontal: 16,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  importLinkButtonDisabled: {
    opacity: 0.5,
  },
  importLinkButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },
});
