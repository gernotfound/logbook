import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Retired usage analytics boundary', () => {
  it('does not ship Google or Vercel Analytics initialization', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    const firebase = readFileSync('src/lib/firebase.ts', 'utf8');
    const settings = readFileSync('src/components/SettingsView.tsx', 'utf8');
    const privacyTab = readFileSync('src/components/Settings/PrivacySettingsTab.tsx', 'utf8');
    const workflow = readFileSync('.github/workflows/firebase-hosting-production.yml', 'utf8');
    const env = readFileSync('.env.example', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');

    expect(existsSync('src/lib/googleAnalytics.ts')).toBe(false);
    expect(existsSync('src/lib/analyticsConsent.ts')).toBe(false);
    expect(main).not.toContain('initOptionalGoogleAnalytics');
    expect(firebase).not.toContain('measurementId');
    expect(main).not.toContain('firebase/analytics');
    expect(firebase).not.toContain('firebase/analytics');
    expect(settings).not.toContain('analyticsConsent');
    expect(privacyTab).not.toContain('analytics-toggle');
    expect(workflow).not.toContain('VITE_FIREBASE_MEASUREMENT_ID');
    expect(env).not.toContain('VITE_FIREBASE_MEASUREMENT_ID');
    expect(app).not.toContain('@vercel/analytics');
    expect(app).not.toContain('@vercel/speed-insights');
  });

  it('restricts the Hosting CSP from contacting retired Analytics endpoints', () => {
    const config = JSON.parse(readFileSync('firebase.json', 'utf8'));
    const headers = config.hosting.headers.find((item: {source: string}) => item.source === '/**').headers;
    const csp = headers.find((header: {key: string}) => header.key === 'Content-Security-Policy').value as string;
    expect(csp).not.toContain('googletagmanager.com');
    expect(csp).not.toContain('google-analytics.com');
    // Keep Firebase Auth and App Check operational.
    expect(csp).toContain('identitytoolkit.googleapis.com');
    expect(csp).toContain('firebaseappcheck.googleapis.com');
  });
});
