import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'node:os';
import { loadEnv } from 'vite';
import { assertIsolatedVitestEnvironment, SYNTHETIC_FIREBASE_TEST_ENV } from '../../scripts/vitest-env-isolation';

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

    describe('Synthetic test environment boundary', () => {
        it('tracks only the exact non-Production Firebase test placeholders', () => {
            const source = fs.readFileSync(path.resolve(__dirname, '../../.env.test'), 'utf8');
            const entries = source.split(/\r?\n/).filter(Boolean).map(line => {
                const match = /^([A-Z][A-Z0-9_]*)=([^\r\n]+)$/.exec(line);
                expect(match, 'unexpected .env.test entry').not.toBeNull();
                return [match![1], match![2]] as const;
            });
            expect(entries).toHaveLength(Object.keys(SYNTHETIC_FIREBASE_TEST_ENV).length);
            expect(Object.fromEntries(entries)).toEqual(SYNTHETIC_FIREBASE_TEST_ENV);
            expect(new Set(entries.map(([key]) => key)).size).toBe(entries.length);
        });

        it('rejects actual Vite env-file precedence and inherited process overrides', () => {
            const folder = fs.mkdtempSync(path.join(tmpdir(), 'logbook-env-test-'));
            const key = 'VITE_FIREBASE_PROJECT_ID';
            // Vitest mirrors import.meta.env mutations into process.env. Other
            // tests in this suite deliberately install fake Firebase values;
            // remove only those VITE_* overrides while testing actual loadEnv.
            const inherited = Object.entries(process.env).filter(([name]) => name.startsWith('VITE_'));
            for (const [name] of inherited) delete process.env[name];
            try {
                fs.writeFileSync(
                    path.join(folder, '.env.test'),
                    Object.entries(SYNTHETIC_FIREBASE_TEST_ENV).map(([name, value]) => name + '=' + value).join('\n') + '\n',
                );
                expect(() => assertIsolatedVitestEnvironment(loadEnv('test', folder, 'VITE_'))).not.toThrow();

                // A nontracked local file outranks the tracked synthetic fixture.
                fs.writeFileSync(path.join(folder, '.env.test.local'), key + '=demo-unapproved-project\n');
                expect(() => assertIsolatedVitestEnvironment(loadEnv('test', folder, 'VITE_')))
                    .toThrow(key);
                fs.rmSync(path.join(folder, '.env.test.local'));

                // An exported shell variable outranks even the .env.test fixture.
                process.env[key] = 'demo-unapproved-project';
                expect(() => assertIsolatedVitestEnvironment(loadEnv('test', folder, 'VITE_')))
                    .toThrow(key);
            } finally {
                for (const name of Object.keys(process.env)) {
                    if (name.startsWith('VITE_')) delete process.env[name];
                }
                for (const [name, value] of inherited) {
                    if (value !== undefined) process.env[name] = value;
                }
                fs.rmSync(folder, { recursive: true, force: true });
            }
        });

        it('fails closed for shell/.env.test.local overrides and unexpected VITE endpoints', () => {
            const safe = { ...SYNTHETIC_FIREBASE_TEST_ENV };
            expect(() => assertIsolatedVitestEnvironment(safe)).not.toThrow();
            expect(() => assertIsolatedVitestEnvironment({
                ...safe, VITE_ACCOUNT_DELETION_API_ORIGIN: 'http://127.0.0.1:9',
            })).not.toThrow();

            for (const key of Object.keys(safe)) {
                expect(() => assertIsolatedVitestEnvironment({
                    ...safe, [key]: 'https://unapproved.example.invalid',
                })).toThrow(key);
            }
            expect(() => assertIsolatedVitestEnvironment({
                ...safe, VITE_ACCOUNT_DELETION_API_ORIGIN: 'https://unapproved-backend.example.invalid',
            })).toThrow('backend trusted');
            expect(() => assertIsolatedVitestEnvironment({
                ...safe, VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'unreviewed-site-key',
            })).toThrow('non prevista');
            expect(() => assertIsolatedVitestEnvironment({
                ...safe, VITE_FUTURE_ENDPOINT: 'https://production.example',
            })).toThrow('non prevista');
        });
    });

    describe('Static Code & Secret Audit', () => {
        it('does not contain any hardcoded fallback strings or mock secrets in src/lib/firebase.ts', () => {
            const firebaseFilePath = path.resolve(__dirname, '../../src/lib/firebase.ts');
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
            const firebaseFilePath = path.resolve(__dirname, '../../src/lib/firebase.ts');
            const fileContent = fs.readFileSync(firebaseFilePath, 'utf-8');

            for (const key of requiredEnvKeys) {
                expect(fileContent).toContain(`'${key}'`);
                expect(fileContent).toContain(`import.meta.env.${key}`);
            }
        });

        it('uses only the canonical reCAPTCHA Enterprise environment variable', () => {
            const appCheckSource = fs.readFileSync(path.resolve(__dirname, '../../src/lib/appCheck.ts'), 'utf-8');
            const envExample = fs.readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf-8');

            expect(appCheckSource).toContain('import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY');
            expect(appCheckSource).not.toContain('VITE_RECAPTCHA_V3_SITE_KEY');
            expect(appCheckSource).not.toContain('VITE_RECAPTCHA_SITE_KEY');
            expect(envExample).toContain('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=');
            expect(envExample).not.toContain('VITE_RECAPTCHA_V3_SITE_KEY');
            expect(envExample).not.toContain('VITE_RECAPTCHA_SITE_KEY');
        });

        it('keeps retired Analytics out of the Firebase core module', () => {
            const firebaseSource = fs.readFileSync(path.resolve(__dirname, '../../src/lib/firebase.ts'), 'utf-8');
            const appSource = fs.readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf-8');
            const firebaseHosting = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firebase.json'), 'utf-8')) as {
                hosting: { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
            };
            const globalHeaders = firebaseHosting.hosting.headers.find(entry => entry.source === '/**');
            const csp = globalHeaders?.headers.find(entry => entry.key.toLowerCase() === 'content-security-policy')?.value;

            expect(firebaseSource).not.toContain('firebase/analytics');
            expect(firebaseSource).not.toContain('measurementId');
            expect(firebaseSource).not.toContain('VITE_FIREBASE_MEASUREMENT_ID');
            expect(firebaseSource).toContain('memoryLocalCache');
            expect(firebaseSource).not.toContain('persistentLocalCache');
            expect(firebaseSource).not.toContain('persistentMultipleTabManager');
            expect(appSource).not.toContain('firebase/analytics');
            // Firebase Hosting serves the frontend: Vercel config does not control its browser CSP.
            expect(csp).toBeDefined();
            expect(csp).toContain("connect-src 'self'");
            // Vite emits analytics workers as same-origin assets; no blob worker
            // execution is required by the shipped app or its service worker.
            expect(csp).toContain("worker-src 'self';");
            expect(csp).not.toContain("worker-src 'self' blob:");
            for (const disallowed of [
                'google-analytics.com', 'googletagmanager.com', 'firebaseio.com',
                'fonts.googleapis.com', 'fonts.gstatic.com', '*.googleapis.com',
            ]) {
                expect(csp).not.toContain(disallowed);
            }
            const connectSources = csp?.split(';').map(item => item.trim())
                .find(item => item.startsWith('connect-src '))?.split(/\s+/);
            expect(connectSources).not.toContain('*');
        });
    });

    describe('Fail-Fast Validation at Runtime', () => {
        it('throws descriptive error if a single required environment variable is missing', async () => {
            delete (import.meta.env as any).VITE_FIREBASE_API_KEY;

            await expect(async () => {
                await import('../../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY/
            );
        });

        it('throws descriptive error if a required environment variable is empty or whitespace string', async () => {
            import.meta.env.VITE_FIREBASE_PROJECT_ID = '   ';

            await expect(async () => {
                await import('../../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_PROJECT_ID/
            );
        });

        it('throws descriptive error listing multiple missing environment variables', async () => {
            delete (import.meta.env as any).VITE_FIREBASE_AUTH_DOMAIN;
            import.meta.env.VITE_FIREBASE_APP_ID = '';

            await expect(async () => {
                await import('../../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_APP_ID/
            );
        });

        it('throws descriptive error listing all 4 variables when none are defined', async () => {
            for (const key of requiredEnvKeys) {
                delete (import.meta.env as any)[key];
            }

            await expect(async () => {
                await import('../../src/lib/firebase');
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
            const firebaseModule = await import('../../src/lib/firebase');
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
