import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('legacy Firebase SDK import is not an App Check network permission', () => {
  it('keeps the guest import inert but initializes App Check before the first protected Firestore client', async () => {
    vi.stubEnv('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'synthetic-guest-isolation-key');
    vi.resetModules();
    const appCheck = await import('firebase/app-check');
    const firestore = await import('firebase/firestore');
    vi.mocked(appCheck.initializeAppCheck).mockClear();
    vi.mocked(firestore.initializeFirestore).mockClear();

    const legacy = await import('../../src/lib/firebase');
    // Legacy modules remain bundled for now, but an import cannot inject
    // reCAPTCHA or create a second remote identity during Kinde guest mode.
    expect(appCheck.initializeAppCheck).not.toHaveBeenCalled();
    expect(firestore.initializeFirestore).not.toHaveBeenCalled();

    vi.mocked(firestore.initializeFirestore).mockImplementationOnce(() => {
      expect(appCheck.initializeAppCheck).toHaveBeenCalledOnce();
      return {} as ReturnType<typeof firestore.initializeFirestore>;
    });

    legacy.getDb();
    expect(appCheck.initializeAppCheck).toHaveBeenCalledOnce();
    expect(firestore.initializeFirestore).toHaveBeenCalledOnce();

    // Repeated protected-client reads never register a second provider.
    legacy.getDb();
    expect(appCheck.initializeAppCheck).toHaveBeenCalledOnce();
    expect(firestore.initializeFirestore).toHaveBeenCalledOnce();
  });

  it('requires a real App Check token on explicit legacy cloud readiness; no guest import supplies one', async () => {
    vi.stubEnv('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'synthetic-guest-isolation-key');
    vi.resetModules();
    const appCheck = await import('firebase/app-check');
    vi.mocked(appCheck.initializeAppCheck).mockClear();
    vi.mocked(appCheck.getToken).mockClear().mockResolvedValue({ token: 'synthetic-check-token' });

    const legacy = await import('../../src/lib/firebase');
    expect(appCheck.initializeAppCheck).not.toHaveBeenCalled();
    expect(appCheck.getToken).not.toHaveBeenCalled();
    const result = await legacy.ensureAppCheck();
    expect(result.success).toBe(true);
    expect(appCheck.initializeAppCheck).toHaveBeenCalledOnce();
    expect(appCheck.getToken).toHaveBeenCalledOnce();
  });
});
