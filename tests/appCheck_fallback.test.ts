import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureAppCheckProvider,
  initAppCheck,
  isAppCheckFallbackOffline,
  isAppCheckActive,
  getAppCheckStatus,
  getAppCheckToken,
  resetAppCheckStateForTesting,
  setAppCheckFallbackOffline
} from '../src/lib/appCheck';
import * as appCheckSdk from 'firebase/app-check';

describe('AppCheck Initialization & Fallback Behavior', () => {
  const dummyApp: any = { name: '[DEFAULT]', options: {} };

  beforeEach(() => {
    vi.clearAllMocks();
    resetAppCheckStateForTesting();
  });

  it('returns disabled fallback when site key is missing', async () => {
    const result = await initAppCheck(dummyApp, { siteKey: '' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(true);
    expect(result.appCheck).toBeNull();
    expect(result.isFallbackOffline).toBe(true);
    expect(result.phase).toBe('disabled');
    expect(result.providerInitialized).toBe(false);
    expect(result.tokenAvailable).toBe(false);
    expect(isAppCheckFallbackOffline()).toBe(true);
    expect(isAppCheckActive()).toBe(false);
    expect(result.reason).toBe('Site key not configured');
  });

  it('returns disabled fallback when site key is only whitespace', async () => {
    const result = await initAppCheck(dummyApp, { siteKey: '   ' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(true);
    expect(result.appCheck).toBeNull();
    expect(result.isFallbackOffline).toBe(true);
    expect(result.phase).toBe('disabled');
  });

  it('initializes the provider synchronously before token acquisition', () => {
    const mockAppCheckInstance = { app: dummyApp };
    vi.spyOn(appCheckSdk, 'initializeAppCheck').mockReturnValue(mockAppCheckInstance as any);

    const result = ensureAppCheckProvider(dummyApp, { siteKey: 'enterprise-site-key' });

    expect(result.phase).toBe('provider-ready');
    expect(result.providerInitialized).toBe(true);
    expect(result.tokenAvailable).toBe(false);
    expect(result.success).toBe(false);
    expect(appCheckSdk.initializeAppCheck).toHaveBeenCalledOnce();
    expect(isAppCheckActive()).toBe(false);
  });

  it('initializes successfully only after a token is available', async () => {
    const mockAppCheckInstance = { app: dummyApp };
    vi.spyOn(appCheckSdk, 'initializeAppCheck').mockReturnValue(mockAppCheckInstance as any);
    vi.spyOn(appCheckSdk, 'getToken').mockResolvedValue({
      token: 'valid-test-app-check-token',
      expireTimeMillis: Date.now() + 3600000
    });

    const result = await initAppCheck(dummyApp, { siteKey: 'enterprise-site-key' });

    expect(result.success).toBe(true);
    expect(result.disabled).toBe(false);
    expect(result.appCheck).toBe(mockAppCheckInstance);
    expect(result.isFallbackOffline).toBe(false);
    expect(result.phase).toBe('token-ready');
    expect(result.providerInitialized).toBe(true);
    expect(result.tokenAvailable).toBe(true);
    expect(isAppCheckActive()).toBe(true);
    expect(isAppCheckFallbackOffline()).toBe(false);

    const status = getAppCheckStatus();
    expect(status.initialized).toBe(true);
    expect(status.providerInitialized).toBe(true);
    expect(status.hasToken).toBe(true);
    expect(status.tokenAvailable).toBe(true);
    expect(status.tokenError).toBeNull();
    expect(status.phase).toBe('token-ready');
    expect(status.provider).toBe('ReCaptchaEnterpriseProvider');

    const token = await getAppCheckToken();
    expect(token).toBe('valid-test-app-check-token');
  });

  it('does not report App Check healthy when the provider exists but initial token acquisition fails', async () => {
    const mockAppCheckInstance = { app: dummyApp };
    vi.spyOn(appCheckSdk, 'initializeAppCheck').mockReturnValue(mockAppCheckInstance as any);
    vi.spyOn(appCheckSdk, 'getToken').mockRejectedValue(new Error('token unavailable'));

    const result = await initAppCheck(dummyApp, { siteKey: 'enterprise-site-key' });

    expect(result.success).toBe(false);
    expect(result.providerInitialized).toBe(true);
    expect(result.tokenAvailable).toBe(false);
    expect(result.phase).toBe('token-error');
    expect(result.isFallbackOffline).toBe(true);
    expect(result.tokenError).toContain('token unavailable');
    expect(isAppCheckActive()).toBe(false);

    const status = getAppCheckStatus();
    expect(status.providerInitialized).toBe(true);
    expect(status.tokenAvailable).toBe(false);
    expect(status.tokenError).toContain('token unavailable');
    expect(status.phase).toBe('token-error');
  });

  it('retries token acquisition without reinitializing the provider after a transient failure', async () => {
    const mockAppCheckInstance = { app: dummyApp };
    vi.spyOn(appCheckSdk, 'initializeAppCheck').mockReturnValue(mockAppCheckInstance as any);
    vi.spyOn(appCheckSdk, 'getToken')
      .mockRejectedValueOnce(new Error('temporary token failure'))
      .mockResolvedValueOnce({ token: 'recovered-token', expireTimeMillis: Date.now() + 3600000 });

    const first = await initAppCheck(dummyApp, { siteKey: 'enterprise-site-key' });
    const second = await initAppCheck(dummyApp, { siteKey: 'enterprise-site-key' });

    expect(first.phase).toBe('token-error');
    expect(second.phase).toBe('token-ready');
    expect(second.success).toBe(true);
    expect(second.tokenAvailable).toBe(true);
    expect(appCheckSdk.initializeAppCheck).toHaveBeenCalledOnce();
    expect(appCheckSdk.getToken).toHaveBeenCalledTimes(2);
    expect(isAppCheckActive()).toBe(true);
  });

  it('activates fallback offline mode when site key is provided but environment is unsupported', async () => {
    const originalCrypto = window.crypto;
    Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
    try {
      const result = await initAppCheck(dummyApp, { siteKey: 'enterprise-site-key' });

      expect(result.success).toBe(false);
      expect(result.disabled).toBe(false);
      expect(result.appCheck).toBeNull();
      expect(result.isFallbackOffline).toBe(true);
      expect(result.phase).toBe('unsupported');
      expect(isAppCheckFallbackOffline()).toBe(true);
      expect(isAppCheckActive()).toBe(false);
    } finally {
      Object.defineProperty(window, 'crypto', { value: originalCrypto, configurable: true });
    }
  });

  it('handles SDK initialization throw gracefully by enabling fallback offline mode', async () => {
    vi.spyOn(appCheckSdk, 'initializeAppCheck').mockImplementation(() => {
      throw new Error('Firebase AppCheck initialization failed');
    });

    const result = await initAppCheck(dummyApp, { siteKey: 'enterprise-site-key' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(false);
    expect(result.isFallbackOffline).toBe(true);
    expect(result.phase).toBe('error');
    expect(isAppCheckFallbackOffline()).toBe(true);
    expect(result.reason).toContain('Firebase AppCheck initialization failed');
  });

  it('allows manual toggle of fallback offline mode via setAppCheckFallbackOffline', () => {
    expect(isAppCheckFallbackOffline()).toBe(false);
    setAppCheckFallbackOffline(true);
    expect(isAppCheckFallbackOffline()).toBe(true);
    setAppCheckFallbackOffline(false);
    expect(isAppCheckFallbackOffline()).toBe(false);
  });

  it('getAppCheckToken returns null when App Check is not initialized', async () => {
    const tokenWithoutInit = await getAppCheckToken();
    expect(tokenWithoutInit).toBeNull();
  });
});
