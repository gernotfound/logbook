import { describe, expect, it } from 'vitest';
import { assertLoopbackE2eUrl, createIsolatedE2eEnvironment } from '../scripts/e2e-environment.mjs';

describe('E2E runner isolation', () => {
  it('replaces inherited Production Firebase and API addresses and removes deployment secrets', () => {
    const inherited = {
      PATH: '/usr/bin',
      CI: 'true',
      VITE_FIREBASE_PROJECT_ID: 'production-project',
      VITE_ACCOUNT_DELETION_API_ORIGIN: 'https://production.example',
      VITE_SENTRY_DSN: 'https://sentry.example/1',
      VITE_EXTRA_FUTURE_ENDPOINT: 'https://production.example',
      SENTRY_AUTH_TOKEN: 'secret',
      SENTRY_ORG: 'production',
      FIREBASE_HOSTING_DEPLOY: 'production',
      FIREBASE_ADMIN_PRIVATE_KEY: 'private',
      GOOGLE_APPLICATION_CREDENTIALS: '/secrets/service-account.json',
      CRON_SECRET: 'secret',
      LOGBOOK_TEST_URL: 'https://thelogbook.web.app',
    };
    const safe = createIsolatedE2eEnvironment(inherited);
    expect(safe.PATH).toBe('/usr/bin');
    expect(safe.CI).toBe('true');
    expect(safe.VITE_FIREBASE_PROJECT_ID).toBe('demo-logbook-audit');
    expect(safe.VITE_ACCOUNT_DELETION_API_ORIGIN).toBe('http://127.0.0.1:9');
    expect(safe.VITE_SENTRY_DSN).toBeUndefined();
    expect(safe.VITE_EXTRA_FUTURE_ENDPOINT).toBeUndefined();
    expect(safe.SENTRY_AUTH_TOKEN).toBeUndefined();
    expect(safe.FIREBASE_HOSTING_DEPLOY).toBeUndefined();
    expect(safe.FIREBASE_ADMIN_PRIVATE_KEY).toBeUndefined();
    expect(safe.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(safe.CRON_SECRET).toBeUndefined();
    expect(safe.LOGBOOK_TEST_URL).toBeUndefined();
    expect(inherited.VITE_FIREBASE_PROJECT_ID).toBe('production-project');
  });

  it('rejects Production, arbitrary paths, alternate hosts and URLs with credentials', () => {
    expect(assertLoopbackE2eUrl('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    for (const unsafe of [
      'https://thelogbook.web.app', 'https://logbook-gnf.vercel.app',
      'http://production.example:4173', 'http://localhost:4173',
      'http://127.0.0.1:4173/api', 'http://127.0.0.1:4173/?target=production',
      'http://user:password@127.0.0.1:4173', 'http://127.0.0.1',
    ]) expect(() => assertLoopbackE2eUrl(unsafe)).toThrow();
  });
});
