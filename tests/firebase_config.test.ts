import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('R2: Firebase Config Security & Fail-Fast Suite', () => {
    const originalEnv = { ...import.meta.env };
    const requiredEnvKeys = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_APP_ID',
        'VITE_FIREBASE_MEASUREMENT_ID'
    ] as const;

    beforeEach(() => {
        vi.resetModules();
        // Restore all required env vars to valid dummy values
        for (const key of requiredEnvKeys) {
            import.meta.env[key] = `mock_val_${key}`;
        }
    });

    afterEach(() => {
        vi.resetModules();
        for (const key of requiredEnvKeys) {
            if (originalEnv[key] !== undefined) {
                import.meta.env[key] = originalEnv[key];
            } else {
                delete (import.meta.env as any)[key];
            }
        }
    });

    describe('Static Code & Secret Audit', () => {
        it('does not contain any hardcoded fallback strings or mock secrets in src/lib/firebase.ts', () => {
            const firebaseFilePath = path.resolve(__dirname, '../src/lib/firebase.ts');
            const fileContent = fs.readFileSync(firebaseFilePath, 'utf-8');

            // Must NOT contain fallback operators for env vars like || "AIza..." or ?? "..."
            expect(fileContent).not.toMatch(/VITE_FIREBASE_\w+\s*\|\|\s*["']/);
            expect(fileContent).not.toMatch(/VITE_FIREBASE_\w+\s*\?\?\s*["']/);

            // Must NOT contain Google API key patterns or hardcoded mock project IDs
            expect(fileContent).not.toMatch(/AIza[0-9A-Za-z-_]{35}/);
            expect(fileContent).not.toMatch(/logbook-test/);
            expect(fileContent).not.toMatch(/logbook-demo/);
            expect(fileContent).not.toMatch(/logbook-prod/);
        });

        it('declares the five Firebase options used by LogBook', () => {
            const firebaseFilePath = path.resolve(__dirname, '../src/lib/firebase.ts');
            const fileContent = fs.readFileSync(firebaseFilePath, 'utf-8');

            for (const key of requiredEnvKeys) {
                expect(fileContent).toContain(`'${key}'`);
                expect(fileContent).toContain(`import.meta.env.${key}`);
            }
        });

        it('does not require options for unused Firebase products', () => {
            const firebaseSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/firebase.ts'), 'utf-8');
            for (const key of [
                'VITE_FIREBASE_DATABASE_URL',
                'VITE_FIREBASE_STORAGE_BUCKET',
                'VITE_FIREBASE_MESSAGING_SENDER_ID',
            ]) {
                expect(firebaseSource).not.toContain(key);
            }
        });

        it('uses only the canonical reCAPTCHA Enterprise environment variable', () => {
            const appCheckSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/appCheck.ts'), 'utf-8');
            const envExample = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf-8');

            expect(appCheckSource).toContain('import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY');
            expect(appCheckSource).not.toContain('VITE_RECAPTCHA_V3_SITE_KEY');
            expect(appCheckSource).not.toContain('VITE_RECAPTCHA_SITE_KEY');
            expect(envExample).toContain('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=');
            expect(envExample).not.toContain('VITE_RECAPTCHA_V3_SITE_KEY');
            expect(envExample).not.toContain('VITE_RECAPTCHA_SITE_KEY');
        });

        it('uses consent-gated Firebase Analytics without advertising signals or persistent Firestore cache', () => {
            const firebaseSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/firebase.ts'), 'utf-8');
            const analyticsSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/firebaseAnalytics.ts'), 'utf-8');
            const consentSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/analyticsConsent.ts'), 'utf-8');
            const appSource = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf-8');
            const hostingConfig = fs.readFileSync(path.resolve(__dirname, '../firebase.json'), 'utf-8');

            expect(firebaseSource).toContain('VITE_FIREBASE_MEASUREMENT_ID');
            expect(firebaseSource).toContain('measurementId');
            expect(firebaseSource).toContain('memoryLocalCache');
            expect(firebaseSource).not.toContain('persistentLocalCache');
            expect(firebaseSource).not.toContain('persistentMultipleTabManager');

            expect(analyticsSource).toContain("import('firebase/analytics')");
            expect(analyticsSource).toContain('setConsent');
            expect(analyticsSource).toContain('setAnalyticsCollectionEnabled');
            expect(analyticsSource).toContain('allow_google_signals: false');
            expect(analyticsSource).toContain('allow_ad_personalization_signals: false');
            expect(analyticsSource).toContain("functionality_storage: 'denied'");
            expect(analyticsSource).toContain("personalization_storage: 'denied'");
            expect(analyticsSource).toContain("security_storage: 'denied'");
            expect(analyticsSource).toContain('page_location: \`${window.location.origin}${window.location.pathname}\`');
            expect(analyticsSource).not.toMatch(/\blogEvent\s*\(/);
            expect(analyticsSource).not.toMatch(/setUserId|setUserProperties/);
            expect(consentSource).toContain('logbook_google_analytics_consent_v1');
            expect(consentSource).toContain('logbook_analytics_consent');
            expect(appSource).toContain('applyFirebaseAnalyticsConsent');
            expect(appSource).not.toMatch(/@vercel\/(analytics|speed-insights)/);

            expect(hostingConfig).toContain('www.googletagmanager.com');
            expect(hostingConfig).toContain('*.google-analytics.com');
            expect(hostingConfig).toContain('*.googleusercontent.com');
            expect(hostingConfig).not.toContain("img-src 'self' data: blob: https://*;");
            expect(hostingConfig).not.toContain('g.doubleclick.net');
            expect(hostingConfig).not.toContain('googlesyndication.com');
            expect(hostingConfig).not.toContain('fonts.googleapis.com');
            expect(hostingConfig).not.toContain('fonts.gstatic.com');
            expect(hostingConfig).not.toContain('firebaseio.com');
        });
    });

    describe('Fail-Fast Validation at Runtime', () => {
        it('throws descriptive error if a single required environment variable is missing', async () => {
            delete (import.meta.env as any).VITE_FIREBASE_API_KEY;

            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY/
            );
        });

        it('throws descriptive error if a required environment variable is empty or whitespace string', async () => {
            import.meta.env.VITE_FIREBASE_PROJECT_ID = '   ';

            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_PROJECT_ID/
            );
        });

        it('throws descriptive error listing multiple missing environment variables', async () => {
            delete (import.meta.env as any).VITE_FIREBASE_AUTH_DOMAIN;
            import.meta.env.VITE_FIREBASE_APP_ID = '';

            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_APP_ID/
            );
        });

        it('throws descriptive error listing all required variables when none are defined', async () => {
            for (const key of requiredEnvKeys) {
                delete (import.meta.env as any)[key];
            }

            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_MEASUREMENT_ID/
            );
        });

        it('initializes successfully and exports auth, db, provider when all variables are valid', async () => {
            for (const key of requiredEnvKeys) {
                import.meta.env[key] = `valid_${key}`;
            }

            const firestore = await import('firebase/firestore');
            const firebaseAuth = await import('firebase/auth');
            const firebaseModule = await import('../src/lib/firebase');
            const db = firebaseModule.getDb();

            expect(firebaseModule.auth).toBeDefined();
            expect(db).toBeDefined();
            expect(firebaseModule.provider).toBeDefined();
            expect(firebaseModule.signInWithPopup).toBeDefined();
            expect(firebaseModule.signOut).toBeDefined();
            expect(vi.mocked(firebaseAuth.initializeAuth)).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    persistence: firebaseAuth.browserLocalPersistence,
                    popupRedirectResolver: firebaseAuth.browserPopupRedirectResolver,
                })
            );
            expect(vi.mocked(firestore.memoryLocalCache)).toHaveBeenCalled();
            expect(vi.mocked(firestore.initializeFirestore)).toHaveBeenCalledWith(
                expect.anything(),
                { localCache: expect.anything() }
            );
        });
    });
});
