import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
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

  it('returns clean success/disabled without fallback offline mode when site key is missing', async () => {
    const result = await initAppCheck(dummyApp, { siteKey: '' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(true);
    expect(result.appCheck).toBeNull();
    expect(result.isFallbackOffline).toBe(true);
    expect(isAppCheckFallbackOffline()).toBe(true);
    expect(isAppCheckActive()).toBe(false);

    expect(result.reason).toBe('Site key not configured');
  });

  it('returns clean success/disabled when site key is only whitespace', async () => {
    const result = await initAppCheck(dummyApp, { siteKey: '   ' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(true);
    expect(result.appCheck).toBeNull();
    expect(result.isFallbackOffline).toBe(true);
    expect(isAppCheckFallbackOffline()).toBe(true);
    expect(isAppCheckActive()).toBe(false);
  });

  it('initializes successfully when site key is configured and supported', async () => {
    const mockAppCheckInstance = { app: dummyApp };
    vi.spyOn(appCheckSdk, 'initializeAppCheck').mockReturnValue(mockAppCheckInstance as any);
    vi.spyOn(appCheckSdk, 'getToken').mockResolvedValue({
      token: 'valid-test-app-check-token',
      expireTimeMillis: Date.now() + 3600000
    });

    const result = await initAppCheck(dummyApp, { siteKey: '6LeIx0aaAAAAAA_valid_key' });

    expect(result.success).toBe(true);
    expect(result.disabled).toBe(false);
    expect(result.appCheck).toBe(mockAppCheckInstance);
    expect(result.isFallbackOffline).toBe(false);
    expect(isAppCheckActive()).toBe(true);
    expect(isAppCheckFallbackOffline()).toBe(false);

    const status = getAppCheckStatus();
    expect(status.initialized).toBe(true);
    expect(status.hasToken).toBe(true);
    expect(status.provider).toBe('ReCaptchaEnterpriseProvider');

    const token = await getAppCheckToken();
    expect(token).toBe('valid-test-app-check-token');
  });

  it('activates fallback offline mode when site key is provided but environment is unsupported', async () => {
    const originalCrypto = window.crypto;
    Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });

    const result = await initAppCheck(dummyApp, { siteKey: '6LeIx0aaAAAAAA_valid_key' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(false);
    expect(result.appCheck).toBeNull();
    expect(result.isFallbackOffline).toBe(true);
    expect(isAppCheckFallbackOffline()).toBe(true);
    expect(isAppCheckActive()).toBe(false);

    Object.defineProperty(window, 'crypto', { value: originalCrypto, configurable: true });
  });

  it('handles SDK initialization throw gracefully by enabling fallback offline mode', async () => {
    vi.spyOn(appCheckSdk, 'initializeAppCheck').mockImplementation(() => {
      throw new Error('Firebase AppCheck initialization failed');
    });

    const result = await initAppCheck(dummyApp, { siteKey: '6LeIx0aaAAAAAA_valid_key' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(false);
    expect(result.isFallbackOffline).toBe(true);
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

  it('getAppCheckToken returns null when appCheck is not initialized or in fallback offline mode', async () => {
    const tokenWithoutInit = await getAppCheckToken();
    expect(tokenWithoutInit).toBeNull();

    setAppCheckFallbackOffline(true);
    const tokenInFallback = await getAppCheckToken();
    expect(tokenInFallback).toBeNull();
  });
});
