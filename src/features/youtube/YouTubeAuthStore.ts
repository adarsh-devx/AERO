import { nativeKeyValueStore } from '../../core/storage/nativeKeyValueStore';
import { sha1 } from './sha1';
import { GOOGLE_CLIENT_ID } from '../../config/googleConfig';

export interface YouTubeUserProfile {
  readonly name: string;
  readonly email?: string;
  readonly avatarUrl?: string;
  readonly channelId?: string;
  readonly handle?: string;
}

export interface YouTubeAuthSnapshot {
  readonly isConnected: boolean;
  readonly profile: YouTubeUserProfile | null;
  readonly cookieString: string | null;
  readonly sapisid: string | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly tokenExpiresAt: number | null;
  readonly connectedAt: number | null;
  readonly isSyncing: boolean;
}

const STORAGE_KEY = 'aero.youtube.auth';

const INITIAL_SNAPSHOT: YouTubeAuthSnapshot = {
  isConnected: false,
  profile: null,
  cookieString: null,
  sapisid: null,
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  connectedAt: null,
  isSyncing: false,
};

export class YouTubeAuthStore {
  private snapshot: YouTubeAuthSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private isHydrated = false;

  constructor() {
    void this.hydrate();
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await nativeKeyValueStore.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<YouTubeAuthSnapshot>;
        if (parsed.accessToken || (parsed.cookieString && parsed.sapisid)) {
          this.snapshot = {
            isConnected: true,
            profile: parsed.profile ?? null,
            cookieString: parsed.cookieString ?? null,
            sapisid: parsed.sapisid ?? null,
            accessToken: parsed.accessToken ?? null,
            refreshToken: (parsed as any).refreshToken ?? null,
            tokenExpiresAt: (parsed as any).tokenExpiresAt ?? null,
            connectedAt: parsed.connectedAt ?? Date.now(),
            isSyncing: false,
          };
          this.notify();
        }
      }
    } catch (e) {
      console.warn('[YouTubeAuthStore] Failed to hydrate:', e);
    } finally {
      this.isHydrated = true;
    }
  }

  private async persist(): Promise<void> {
    try {
      if (this.snapshot.isConnected && (this.snapshot.accessToken || this.snapshot.cookieString)) {
        await nativeKeyValueStore.setItem(
          STORAGE_KEY,
          JSON.stringify({
            profile: this.snapshot.profile,
            cookieString: this.snapshot.cookieString,
            sapisid: this.snapshot.sapisid,
            accessToken: this.snapshot.accessToken,
            refreshToken: this.snapshot.refreshToken,
            tokenExpiresAt: this.snapshot.tokenExpiresAt,
            connectedAt: this.snapshot.connectedAt,
          }),
        );
      } else {
        await nativeKeyValueStore.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('[YouTubeAuthStore] Failed to persist:', e);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getSnapshot = (): YouTubeAuthSnapshot => {
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setSyncing(isSyncing: boolean): void {
    this.snapshot = { ...this.snapshot, isSyncing };
    this.notify();
  }

  async setOAuthSession(
    accessToken: string,
    profile?: YouTubeUserProfile | null,
    refreshToken?: string | null,
    expiresInSeconds?: number,
  ): Promise<void> {
    this.snapshot = {
      isConnected: true,
      profile: profile ?? this.snapshot.profile,
      cookieString: null,
      sapisid: null,
      accessToken,
      refreshToken: refreshToken ?? this.snapshot.refreshToken,
      tokenExpiresAt: expiresInSeconds
        ? Date.now() + expiresInSeconds * 1000
        : Date.now() + 3600 * 1000, // default 1 hour
      connectedAt: Date.now(),
      isSyncing: false,
    };

    this.notify();
    await this.persist();
  }

  async setSession(
    cookieString: string,
    profile?: YouTubeUserProfile | null,
  ): Promise<void> {
    const sapisidMatch =
      cookieString.match(/SAPISID=([^;]+)/) ||
      cookieString.match(/__Secure-3PAPISID=([^;]+)/) ||
      cookieString.match(/__Secure-1PAPISID=([^;]+)/);

    const sapisid = sapisidMatch ? sapisidMatch[1].trim() : null;

    if (!sapisid) {
      throw new Error('SAPISID cookie not found in session');
    }

    this.snapshot = {
      isConnected: true,
      profile: profile ?? this.snapshot.profile,
      cookieString,
      sapisid,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      connectedAt: Date.now(),
      isSyncing: false,
    };

    this.notify();
    await this.persist();
  }


  async updateProfile(profile: YouTubeUserProfile): Promise<void> {
    if (!this.snapshot.isConnected) return;
    this.snapshot = {
      ...this.snapshot,
      profile,
    };
    this.notify();
    await this.persist();
  }

  /**
   * Checks if the access token is expired (or about to expire in 5 min)
   * and refreshes it using the stored refresh_token.
   */
  async ensureFreshAccessToken(): Promise<string | null> {
    if (!this.snapshot.isConnected || !this.snapshot.accessToken) {
      return this.snapshot.accessToken;
    }

    // If no expiry info or still valid for > 5 minutes, return current token
    if (
      this.snapshot.tokenExpiresAt &&
      Date.now() < this.snapshot.tokenExpiresAt - 5 * 60 * 1000
    ) {
      return this.snapshot.accessToken;
    }

    // Need to refresh
    if (!this.snapshot.refreshToken) {
      console.warn('[YouTubeAuthStore] Token expired but no refresh_token available');
      return this.snapshot.accessToken; // try with stale token, API will 401
    }

    const cleanClientId = (GOOGLE_CLIENT_ID || '').trim();
    if (!cleanClientId) {
      console.warn('[YouTubeAuthStore] No client ID for token refresh');
      return this.snapshot.accessToken;
    }

    try {
      console.log('[YouTubeAuthStore] Refreshing expired access token...');
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cleanClientId,
          grant_type: 'refresh_token',
          refresh_token: this.snapshot.refreshToken,
        }).toString(),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.access_token) {
          const newExpiry = data.expires_in
            ? Date.now() + data.expires_in * 1000
            : Date.now() + 3600 * 1000;

          this.snapshot = {
            ...this.snapshot,
            accessToken: data.access_token,
            tokenExpiresAt: newExpiry,
          };
          this.notify();
          await this.persist();
          console.log('[YouTubeAuthStore] Token refreshed successfully');
          return data.access_token;
        }
      } else {
        const errText = await res.text();
        console.warn('[YouTubeAuthStore] Token refresh failed:', res.status, errText);
      }
    } catch (err) {
      console.warn('[YouTubeAuthStore] Token refresh error:', err);
    }

    return this.snapshot.accessToken;
  }

  async disconnect(): Promise<void> {
    this.snapshot = INITIAL_SNAPSHOT;
    this.notify();
    await this.persist();
  }

  /**
   * Generates authorization headers for authenticated InnerTube calls
   */
  getAuthHeaders(): Record<string, string> {
    if (!this.snapshot.isConnected) {
      return {};
    }

    if (this.snapshot.accessToken) {
      return {
        Authorization: `Bearer ${this.snapshot.accessToken}`,
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': '1.20240101.01.00',
      };
    }

    if (this.snapshot.sapisid && this.snapshot.cookieString) {
      const timestamp = Math.floor(Date.now() / 1000);
      const origin = 'https://music.youtube.com';
      const hash = sha1(`${timestamp} ${this.snapshot.sapisid} ${origin}`);
      const sapisidHash = `${timestamp}_${hash}`;

      return {
        Authorization: `SAPISIDHASH ${sapisidHash}`,
        Cookie: this.snapshot.cookieString,
        'X-Origin': origin,
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': '1.20240101.01.00',
      };
    }

    return {};
  }
}

export const youtubeAuthStore = new YouTubeAuthStore();
