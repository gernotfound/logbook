import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Firebase environment hardening', () => {
    describe('R2 Adversarial: Firebase Configuration Fail-Fast & Secret Audit', () => {
        const originalEnv = { ...import.meta.env };
        const requiredEnvKeys = [
            'VITE_FIREBASE_API_KEY',
            'VITE_FIREBASE_AUTH_DOMAIN',
            'VITE_FIREBASE_PROJECT_ID',
            'VITE_FIREBASE_APP_ID'
        ] as const;

        beforeEach(() => {
            vi.resetModules();
            for (const key of requiredEnvKeys) {
                import.meta.env[key] = `valid_${key}_value_12345`;
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

        it('STATIC AUDIT: src/lib/firebase.ts has zero hardcoded fallback credentials or default mock strings', () => {
            const firebaseFilePath = path.resolve(__dirname, '../../../src/lib/firebase.ts');
            const fileContent = fs.readFileSync(firebaseFilePath, 'utf-8');

            // Must NOT contain fallback operators for env vars like || "AIza..." or ?? "..."
            expect(fileContent).not.toMatch(/VITE_FIREBASE_\w+\s*\|\|\s*["']/);
            expect(fileContent).not.toMatch(/VITE_FIREBASE_\w+\s*\?\?\s*["']/);
            expect(fileContent).not.toMatch(/import\.meta\.env\[.+\]\s*\|\|\s*["']/);
            expect(fileContent).not.toMatch(/import\.meta\.env\[.+\]\s*\?\?\s*["']/);

            // Must NOT contain any Google API key or project ID pattern in plain string
            expect(fileContent).not.toMatch(/AIza[0-9A-Za-z-_]{35}/);
            expect(fileContent).not.toMatch(/logbook-test/);
            expect(fileContent).not.toMatch(/logbook-demo/);
            expect(fileContent).not.toMatch(/logbook-prod/);
            expect(fileContent).not.toContain('.firebaseapp.com');
            expect(fileContent).not.toContain('.firebasestorage.app');

            // Must verify all 4 required variables are listed in requiredEnvVars
            for (const key of requiredEnvKeys) {
                expect(fileContent).toContain(`'${key}'`);
            }
        });

        // Exhaustive test: Every single env var tested individually for undefined, empty, whitespace, tabs/newlines
        for (const envKey of requiredEnvKeys) {
            it(`RUNTIME FAIL-FAST: throws when ${envKey} is undefined/missing`, async () => {
                delete (import.meta.env as any)[envKey];
                await expect(async () => {
                    await import('../../../src/lib/firebase');
                }).rejects.toThrowError(
                    new RegExp(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: .*${envKey}`)
                );
            });

            it(`RUNTIME FAIL-FAST: throws when ${envKey} is an empty string ("")`, async () => {
                import.meta.env[envKey] = '';
                await expect(async () => {
                    await import('../../../src/lib/firebase');
                }).rejects.toThrowError(
                    new RegExp(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: .*${envKey}`)
                );
            });

            it(`RUNTIME FAIL-FAST: throws when ${envKey} is only spaces ("   ")`, async () => {
                import.meta.env[envKey] = '   ';
                await expect(async () => {
                    await import('../../../src/lib/firebase');
                }).rejects.toThrowError(
                    new RegExp(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: .*${envKey}`)
                );
            });

            it(`RUNTIME FAIL-FAST: throws when ${envKey} contains tabs and newlines ("\\t\\n\\r")`, async () => {
                import.meta.env[envKey] = '\t\n\r';
                await expect(async () => {
                    await import('../../../src/lib/firebase');
                }).rejects.toThrowError(
                    new RegExp(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: .*${envKey}`)
                );
            });
        }

        it('RUNTIME COMBINATORIAL: throws listing all 4 variables when all are undefined', async () => {
            for (const key of requiredEnvKeys) {
                delete (import.meta.env as any)[key];
            }
            await expect(async () => {
                await import('../../../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID/
            );
        });

        it('RUNTIME COMBINATORIAL: throws listing all 4 variables when all are empty strings', async () => {
            for (const key of requiredEnvKeys) {
                import.meta.env[key] = '';
            }
            await expect(async () => {
                await import('../../../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID/
            );
        });

        it('RUNTIME COMBINATORIAL: throws listing multiple arbitrary missing variables (subset: API_KEY, AUTH_DOMAIN)', async () => {
            delete (import.meta.env as any).VITE_FIREBASE_API_KEY;
            delete (import.meta.env as any).VITE_FIREBASE_AUTH_DOMAIN;

            await expect(async () => {
                await import('../../../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN/
            );
        });

        it('RUNTIME SUCCESS: loads and exports auth, db, provider when all 4 environment variables are properly defined', async () => {
            for (const key of requiredEnvKeys) {
                import.meta.env[key] = `valid_${key}_value_12345`;
            }
            const firebaseModule = await import('../../../src/lib/firebase');
            expect(firebaseModule.auth).toBeDefined();
            expect(firebaseModule.getDb).toBeDefined();
            expect(firebaseModule.provider).toBeDefined();
            expect(firebaseModule.signInWithPopup).toBeDefined();
            expect(firebaseModule.signOut).toBeDefined();
        });
    });
});
