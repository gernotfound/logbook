import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('R2: Firebase Config Security & Fail-Fast Suite', () => {
    const originalEnv = { ...import.meta.env };
    const requiredEnvKeys = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_APP_ID'
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

        it('declares all 4 required VITE_FIREBASE_* environment variables', () => {
            const firebaseFilePath = path.resolve(__dirname, '../src/lib/firebase.ts');
            const fileContent = fs.readFileSync(firebaseFilePath, 'utf-8');

            for (const key of requiredEnvKeys) {
                expect(fileContent).toContain(`'${key}'`);
                expect(fileContent).toContain(`import.meta.env.${key}`);
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

        it('keeps retired Analytics out of the Firebase core module', () => {
            const firebaseSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/firebase.ts'), 'utf-8');
            const appSource = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf-8');
            const vercelConfig = fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf-8');

            expect(firebaseSource).not.toContain('firebase/analytics');
            expect(firebaseSource).not.toContain('measurementId');
            expect(firebaseSource).not.toContain('VITE_FIREBASE_MEASUREMENT_ID');
            expect(firebaseSource).toContain('memoryLocalCache');
            expect(firebaseSource).not.toContain('persistentLocalCache');
            expect(firebaseSource).not.toContain('persistentMultipleTabManager');
            expect(appSource).not.toContain('firebase/analytics');
            expect(vercelConfig).not.toContain('google-analytics.com');
            expect(vercelConfig).not.toContain('googletagmanager.com');
            expect(vercelConfig).not.toContain('fonts.googleapis.com');
            expect(vercelConfig).not.toContain('fonts.gstatic.com');
            expect(vercelConfig).not.toContain('firebaseio.com');
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

        it('throws descriptive error listing all 4 variables when none are defined', async () => {
            for (const key of requiredEnvKeys) {
                delete (import.meta.env as any)[key];
            }

            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID/
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
