import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initAppCheck,
  isAppCheckSupported,
  isAppCheckActive,
  isAppCheckFallbackOffline,
  setAppCheckFallbackOffline,
  getAppCheckStatus,
  resetAppCheckStateForTesting,
  APP_CHECK_STRINGS,
} from '../src/security/appCheck.js';

// Mock firebase/app-check
vi.mock('firebase/app-check', () => {
  return {
    initializeAppCheck: vi.fn((app, options) => ({
      app,
      options,
      _isAppCheckInstance: true,
    })),
    ReCaptchaV3Provider: vi.fn(function (this: any, siteKey: string) {
      this.siteKey = siteKey;
    }),
    getToken: vi.fn(async () => ({
      token: 'mock-app-check-jwt-token',
      expireTimeMillis: Date.now() + 3600 * 1000,
    })),
    isSupported: vi.fn(async () => true),
  };
});

describe('Firebase App Check Security Module Suite', () => {
  const mockFirebaseApp = { name: '[DEFAULT]', options: {} } as any;

  beforeEach(() => {
    resetAppCheckStateForTesting();
    vi.clearAllMocks();
  });

  describe('Provider & Site Key Configuration', () => {
    it('initializes ReCaptchaV3Provider with provided site key', async () => {
      const result = await initAppCheck(mockFirebaseApp, {
        siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
        isTokenAutoRefreshEnabled: true,
      });

      expect(result.success).toBe(true);
      expect(result.isFallbackOffline).toBe(false);
      expect(result.appCheck).not.toBeNull();
      expect(isAppCheckActive()).toBe(true);
      expect(isAppCheckFallbackOffline()).toBe(false);
    });

    it('falls back to offline mode when site key is missing or empty', async () => {
      const result = await initAppCheck(mockFirebaseApp, {
        siteKey: '',
      });

      expect(result.success).toBe(false);
      expect(result.isFallbackOffline).toBe(true);
      expect(result.appCheck).toBeNull();
      expect(isAppCheckFallbackOffline()).toBe(true);
      expect(result.reason).toContain('non configurata');
    });
  });

  describe('Supported Browser Flow', () => {
    it('successfully acquires initial token and populates telemetry status', async () => {
      await initAppCheck(mockFirebaseApp, {
        siteKey: 'valid-recaptcha-v3-site-key',
      });

      const status = getAppCheckStatus();
      expect(status.initialized).toBe(true);
      expect(status.provider).toBe('ReCaptchaV3Provider');
      expect(status.fallbackOffline).toBe(false);
      expect(status.hasToken).toBe(true);
      expect(status.tokenExpireTimestamp).toBeGreaterThan(Date.now());
    });
  });

  describe('Unsupported Browser Flow (Graceful Offline Degradation)', () => {
    it('falls back safely without crashing when isSupported() is false', async () => {
      const { isSupported } = await import('firebase/app-check');
      vi.mocked(isSupported).mockResolvedValueOnce(false);

      const result = await initAppCheck(mockFirebaseApp, {
        siteKey: 'valid-recaptcha-v3-site-key',
      });

      expect(result.success).toBe(false);
      expect(result.isFallbackOffline).toBe(true);
      expect(result.appCheck).toBeNull();
      expect(isAppCheckActive()).toBe(false);
      expect(isAppCheckFallbackOffline()).toBe(true);
      expect(result.reason).toBe(APP_CHECK_STRINGS.unsupportedMessage);
    });

    it('provides user notification string in Italian Sentence case', () => {
      expect(APP_CHECK_STRINGS.unsupportedTitle).toBe('Verifica di sicurezza non supportata');
      expect(APP_CHECK_STRINGS.unsupportedMessage).toMatch(
        /^Il browser o la modalità di navigazione attuale/
      );
      // Ensure only first letter is capitalized
      const title = APP_CHECK_STRINGS.unsupportedTitle;
      expect(title[0]).toBe(title[0].toUpperCase());
      expect(title.slice(1)).not.toBe(title.slice(1).toUpperCase());
    });
  });

  describe('Manual Fallback & Telemetry Controls', () => {
    it('allows toggling fallback offline mode manually', () => {
      expect(isAppCheckFallbackOffline()).toBe(false);
      setAppCheckFallbackOffline(true);
      expect(isAppCheckFallbackOffline()).toBe(true);
      setAppCheckFallbackOffline(false);
      expect(isAppCheckFallbackOffline()).toBe(false);
    });

    it('resets internal state cleanly for tests', async () => {
      await initAppCheck(mockFirebaseApp, { siteKey: 'key' });
      expect(isAppCheckActive()).toBe(true);

      resetAppCheckStateForTesting();
      expect(isAppCheckActive()).toBe(false);
      expect(getAppCheckStatus().initialized).toBe(false);
    });
  });
});
