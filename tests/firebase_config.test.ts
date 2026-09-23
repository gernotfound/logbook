import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('R2: Firebase Config Security & Fail-Fast Suite', () => {
    const originalEnv = { ...import.meta.env };
    const requiredEnvKeys = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_DATABASE_URL',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_STORAGE_BUCKET',
        'VITE_FIREBASE_MESSAGING_SENDER_ID',
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

        it('declares all 7 required VITE_FIREBASE_* environment variables', () => {
            const firebaseFilePath = path.resolve(__dirname, '../src/lib/firebase.ts');
            const fileContent = fs.readFileSync(firebaseFilePath, 'utf-8');

            for (const key of requiredEnvKeys) {
                expect(fileContent).toContain(`'${key}'`);
                expect(fileContent).toContain(`import.meta.env.${key}`);
            }
        });

        it('does not initialize or allowlist Google/Firebase Analytics', () => {
            const firebaseSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/firebase.ts'), 'utf-8');
            const appSource = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf-8');
            const vercelConfig = fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf-8');

            expect(firebaseSource).not.toContain('firebase/analytics');
            expect(firebaseSource).not.toContain('measurementId');
            expect(firebaseSource).not.toContain('VITE_FIREBASE_MEASUREMENT_ID');
            expect(appSource).not.toContain('firebase/analytics');
            expect(vercelConfig).not.toContain('google-analytics.com');
            expect(vercelConfig).not.toContain('googletagmanager.com');
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
            delete (import.meta.env as any).VITE_FIREBASE_STORAGE_BUCKET;
            import.meta.env.VITE_FIREBASE_APP_ID = '';

            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_APP_ID/
            );
        });

        it('throws descriptive error listing all 7 variables when none are defined', async () => {
            for (const key of requiredEnvKeys) {
                delete (import.meta.env as any)[key];
            }

            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID/
            );
        });

        it('initializes successfully and exports auth, db, provider when all variables are valid', async () => {
            for (const key of requiredEnvKeys) {
                import.meta.env[key] = `valid_${key}`;
            }

            const firebaseModule = await import('../src/lib/firebase');
            expect(firebaseModule.auth).toBeDefined();
            expect(firebaseModule.getDb).toBeDefined();
            expect(firebaseModule.provider).toBeDefined();
            expect(firebaseModule.signInWithPopup).toBeDefined();
            expect(firebaseModule.signOut).toBeDefined();
        });
    });
});
