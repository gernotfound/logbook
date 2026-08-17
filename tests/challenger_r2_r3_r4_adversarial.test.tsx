import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { useLocalStorage } from '../src/hooks/useLocalStorage';
import type { UserData } from '../src/types';

describe('EMPIRICAL CHALLENGER: Adversarial Stress & Robustness Suite (R2, R3, R4)', () => {

    /* =========================================================================
     * PART 1: R2 - FIREBASE CONFIG ADVERSARIAL & SECURITY VERIFICATION
     * ========================================================================= */
    describe('R2 Adversarial: Firebase Configuration Fail-Fast & Secret Audit', () => {
        const originalEnv = { ...import.meta.env };
        const requiredEnvKeys = [
            'VITE_FIREBASE_API_KEY',
            'VITE_FIREBASE_AUTH_DOMAIN',
            'VITE_FIREBASE_DATABASE_URL',
            'VITE_FIREBASE_PROJECT_ID',
            'VITE_FIREBASE_STORAGE_BUCKET',
            'VITE_FIREBASE_MESSAGING_SENDER_ID',
            'VITE_FIREBASE_APP_ID',
            'VITE_FIREBASE_MEASUREMENT_ID'
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
            const firebaseFilePath = path.resolve(__dirname, '../src/lib/firebase.ts');
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
            expect(fileContent).not.toMatch(/\.firebaseapp\.com/);
            expect(fileContent).not.toMatch(/\.firebasestorage\.app/);

            // Must verify all 8 required variables are listed in requiredEnvVars
            for (const key of requiredEnvKeys) {
                expect(fileContent).toContain(`'${key}'`);
            }
        });

        // Exhaustive test: Every single env var tested individually for undefined, empty, whitespace, tabs/newlines
        for (const envKey of requiredEnvKeys) {
            it(`RUNTIME FAIL-FAST: throws when ${envKey} is undefined/missing`, async () => {
                delete (import.meta.env as any)[envKey];
                await expect(async () => {
                    await import('../src/lib/firebase');
                }).rejects.toThrowError(
                    new RegExp(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: .*${envKey}`)
                );
            });

            it(`RUNTIME FAIL-FAST: throws when ${envKey} is an empty string ("")`, async () => {
                import.meta.env[envKey] = '';
                await expect(async () => {
                    await import('../src/lib/firebase');
                }).rejects.toThrowError(
                    new RegExp(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: .*${envKey}`)
                );
            });

            it(`RUNTIME FAIL-FAST: throws when ${envKey} is only spaces ("   ")`, async () => {
                import.meta.env[envKey] = '   ';
                await expect(async () => {
                    await import('../src/lib/firebase');
                }).rejects.toThrowError(
                    new RegExp(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: .*${envKey}`)
                );
            });

            it(`RUNTIME FAIL-FAST: throws when ${envKey} contains tabs and newlines ("\\t\\n\\r")`, async () => {
                import.meta.env[envKey] = '\t\n\r';
                await expect(async () => {
                    await import('../src/lib/firebase');
                }).rejects.toThrowError(
                    new RegExp(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: .*${envKey}`)
                );
            });
        }

        it('RUNTIME COMBINATORIAL: throws listing all 8 variables when all are undefined', async () => {
            for (const key of requiredEnvKeys) {
                delete (import.meta.env as any)[key];
            }
            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_MEASUREMENT_ID/
            );
        });

        it('RUNTIME COMBINATORIAL: throws listing all 8 variables when all are empty strings', async () => {
            for (const key of requiredEnvKeys) {
                import.meta.env[key] = '';
            }
            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_MEASUREMENT_ID/
            );
        });

        it('RUNTIME COMBINATORIAL: throws listing multiple arbitrary missing variables (subset: API_KEY, STORAGE_BUCKET, MEASUREMENT_ID)', async () => {
            delete (import.meta.env as any).VITE_FIREBASE_API_KEY;
            delete (import.meta.env as any).VITE_FIREBASE_STORAGE_BUCKET;
            import.meta.env.VITE_FIREBASE_MEASUREMENT_ID = '   ';

            await expect(async () => {
                await import('../src/lib/firebase');
            }).rejects.toThrowError(
                /Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: VITE_FIREBASE_API_KEY, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MEASUREMENT_ID/
            );
        });

        it('RUNTIME SUCCESS: loads and exports auth, db, provider when all 8 environment variables are properly defined', async () => {
            for (const key of requiredEnvKeys) {
                import.meta.env[key] = `valid_${key}_value_12345`;
            }
            const firebaseModule = await import('../src/lib/firebase');
            expect(firebaseModule.auth).toBeDefined();
            expect(firebaseModule.db).toBeDefined();
            expect(firebaseModule.provider).toBeDefined();
            expect(firebaseModule.signInWithPopup).toBeDefined();
            expect(firebaseModule.signOut).toBeDefined();
        });
    });

    /* =========================================================================
     * PART 2: R3 - ZUSTAND PROMISE PROPAGATION & CONCURRENCY STRESS
     * ========================================================================= */
    describe('R3 Adversarial: Zustand saveUserData Concurrency & Promise Rejection Stress', () => {
        const createMockUserData = (index: number): UserData => ({
            profile: { name: `Adversarial User ${index}`, height: `${170 + index}` },
            library: [{ id: `ex_${index}`, name: `Exercise ${index}`, setsCount: 3, sets: [] }],
            routines: [],
            history: [],
            nutrition: {},
            customFoods: [],
            trainingCycles: [],
            supplements: [],
            activeWorkout: null,
            nutritionPlanning: {} as any
        });

        let useAppStore: any;
        let DB: any;

        beforeEach(async () => {
            vi.useFakeTimers();
            const storeMod = await import('../src/store/useAppStore');
            const dbMod = await import('../src/lib/db');
            useAppStore = storeMod.useAppStore;
            DB = dbMod.DB;
            useAppStore.getState().resetStore();
            vi.clearAllMocks();
        });

        afterEach(() => {
            if (useAppStore) {
                useAppStore.getState().resetStore();
            }
            vi.useRealTimers();
        });

        it('BURST STRESS (50 Concurrent Calls - Success): debounces 50 rapid calls into exactly 1 DB write, resolves ALL 50 caller promises with freshest data', async () => {
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValue(undefined);
            const burstCount = 50;
            const promises: Promise<void>[] = [];

            for (let i = 1; i <= burstCount; i++) {
                promises.push(useAppStore.getState().saveUserData(createMockUserData(i)));
            }

            expect(useAppStore.getState().syncing).toBe(true);
            expect(useAppStore.getState().saveError).toBeNull();

            const settledPromise = Promise.allSettled(promises);

            // Advance debounce timer past 1000ms
            await vi.advanceTimersByTimeAsync(1100);

            // Await all 50 promises
            const results = await settledPromise;

            // All 50 promises MUST be fulfilled
            expect(results.length).toBe(burstCount);
            for (let i = 0; i < burstCount; i++) {
                expect(results[i].status).toBe('fulfilled');
            }

            // DB.saveUserData must have been called EXACTLY ONCE
            expect(saveSpy).toHaveBeenCalledTimes(1);
            // Must have received the 50th payload (freshest state)
            expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
                profile: expect.objectContaining({ name: 'Adversarial User 50', height: '220' })
            }));

            // Final store state must be clean
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().userData?.profile?.name).toBe('Adversarial User 50');
        });

        it('BURST STRESS (50 Concurrent Calls - Rejection): when debounced DB write fails, ALL 50 caller promises reject with the identical error', async () => {
            const simulatedError = new Error('Simulated QuotaExceeded or Network Failure');
            const saveSpy = vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(simulatedError);
            const burstCount = 50;
            const promises: Promise<void>[] = [];

            for (let i = 1; i <= burstCount; i++) {
                promises.push(useAppStore.getState().saveUserData(createMockUserData(i)));
            }

            expect(useAppStore.getState().syncing).toBe(true);

            const settledPromise = Promise.allSettled(promises);

            // Advance past debounce timer
            await vi.advanceTimersByTimeAsync(1100);

            // Settle all promises
            const results = await settledPromise;

            expect(results.length).toBe(burstCount);
            for (let i = 0; i < burstCount; i++) {
                expect(results[i].status).toBe('rejected');
                if (results[i].status === 'rejected') {
                    expect((results[i] as PromiseRejectedResult).reason).toBe(simulatedError);
                }
            }

            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('INTERLEAVED STRESS: alternates Fail -> Burst Success -> Burst Fail -> Null -> Success cleanly', async () => {
            // Stage 1: Single Failure
            vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(new Error('Stage 1 Error'));
            const p1 = useAppStore.getState().saveUserData(createMockUserData(1));
            const a1 = expect(p1).rejects.toThrow('Stage 1 Error');
            await vi.advanceTimersByTimeAsync(1100);
            await a1;
            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');
            expect(useAppStore.getState().syncing).toBe(false);

            // Stage 2: Burst of 5 Successes (recovers error state)
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce(undefined);
            const p2_burst = Array.from({ length: 5 }, (_, idx) => 
                useAppStore.getState().saveUserData(createMockUserData(10 + idx))
            );
            const r2_settled = Promise.allSettled(p2_burst);
            // Starting a new save clears saveError
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(true);
            await vi.advanceTimersByTimeAsync(1100);
            const r2 = await r2_settled;
            r2.forEach(res => expect(res.status).toBe('fulfilled'));
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().userData?.profile?.name).toBe('Adversarial User 14');

            // Stage 3: Burst of 10 Failures
            const stage3Err = new Error('Stage 3 Firestore Timeout');
            vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(stage3Err);
            const p3_burst = Array.from({ length: 10 }, (_, idx) => 
                useAppStore.getState().saveUserData(createMockUserData(20 + idx))
            );
            const r3_settled = Promise.allSettled(p3_burst);
            await vi.advanceTimersByTimeAsync(1100);
            const r3 = await r3_settled;
            r3.forEach(res => {
                expect(res.status).toBe('rejected');
                if (res.status === 'rejected') {
                    expect((res as PromiseRejectedResult).reason).toBe(stage3Err);
                }
            });
            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');
            expect(useAppStore.getState().syncing).toBe(false);

            // Stage 4: saveUserData(null) immediately clears everything
            const p4 = useAppStore.getState().saveUserData(null);
            await expect(p4).resolves.toBeUndefined();
            expect(useAppStore.getState().userData).toBeNull();
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);

            // Stage 5: Final Single Success
            vi.spyOn(DB, 'saveUserData').mockResolvedValueOnce(undefined);
            const p5 = useAppStore.getState().saveUserData(createMockUserData(100));
            await vi.advanceTimersByTimeAsync(1100);
            await expect(p5).resolves.toBeUndefined();
            expect(useAppStore.getState().userData?.profile?.name).toBe('Adversarial User 100');
            expect(useAppStore.getState().saveError).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);
        });

        it('ASYNC PROPAGATION: updateUserData properly propagates promise rejection to caller try/catch', async () => {
            const dbError = new Error('Permission denied on update');
            vi.spyOn(DB, 'saveUserData').mockRejectedValueOnce(dbError);
            useAppStore.setState({ userData: createMockUserData(1) });

            const updatePromise = useAppStore.getState().updateUserData((prev: UserData) => ({
                ...prev,
                profile: { ...prev.profile, name: 'Mutated under error' }
            }));
            const assertion = expect(updatePromise).rejects.toThrow('Permission denied on update');
            await vi.advanceTimersByTimeAsync(1100);
            await assertion;

            expect(useAppStore.getState().saveError).toBe('Errore sincronizzazione. Verifica la connessione.');
            expect(useAppStore.getState().syncing).toBe(false);
        });
    });

    /* =========================================================================
     * PART 3: R4 - USELOCALSTORAGE ADVERSARIAL CORRUPTION MATRIX
     * ========================================================================= */
    describe('R4 Adversarial: useLocalStorage Hostile & Corrupted Payloads', () => {
        beforeEach(() => {
            window.localStorage.clear();
            vi.clearAllMocks();
        });

        afterEach(() => {
            window.localStorage.clear();
            vi.restoreAllMocks();
        });

        const adversarialCorruptInputs: { label: string; payload: string }[] = [
            // 1. Unquoted plain strings
            { label: 'plain unquoted alphanumeric', payload: 'dashboard_tab' },
            { label: 'plain unquoted with symbols', payload: 'user:session:12345!@#' },
            { label: 'unquoted keyword undefined', payload: 'undefined' },
            { label: 'unquoted keyword NaN', payload: 'NaN' },
            { label: 'unquoted keyword Infinity', payload: 'Infinity' },
            { label: 'unquoted keyword -Infinity', payload: '-Infinity' },
            { label: 'unquoted Object toString', payload: '[object Object]' },

            // 2. Syntax errors and broken JSON structures
            { label: 'unclosed curly brace', payload: '{"active": true, "name": "workout"' },
            { label: 'unclosed square bracket', payload: '[1, 2, 3, {"incomplete": ' },
            { label: 'single-quoted JSON (invalid standard JSON)', payload: "{'theme': 'dark'}" },
            { label: 'trailing comma in object', payload: '{"key": "val",}' },
            { label: 'trailing comma in array', payload: '[1, 2, 3,]' },
            { label: 'sparse array representation', payload: '[1,,2]' },
            { label: 'unquoted key names', payload: '{name: "John", age: 30}' },
            { label: 'missing value in key-value', payload: '{"key": }' },
            { label: 'unclosed string literal', payload: '"hello world without closing quote' },

            // 3. HTML / Injection vectors
            { label: 'XSS script tag unquoted', payload: '<script>alert("hacked")</script>' },
            { label: 'SQL-like injection unquoted', payload: "1; DROP TABLE logs; --" },
            { label: 'Javascript expression unquoted', payload: 'function() { return 42; }()' },

            // 4. Corrupted unicode and binary control characters
            { label: 'unpaired high surrogate', payload: '\uD800' },
            { label: 'unpaired low surrogate', payload: '\uDFFF' },
            { label: 'binary control bytes (0x00-0x05)', payload: '\x00\x01\x02\x03\x04\x05' },
            { label: 'escape control characters', payload: '\x1B[31mRedText\x1B[0m' },

            // 5. Whitespace-only corrupt payloads
            { label: 'space-only string "   "', payload: '   ' },
            { label: 'newlines and tabs "\\n\\t\\r"', payload: '\n\t\r' }
        ];

        for (const { label, payload } of adversarialCorruptInputs) {
            it(`CORRUPTION MATRIX [String fallback]: rejects ${label} and returns initialValue`, () => {
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
                const testKey = `corrupt_test_${encodeURIComponent(label)}`;
                window.localStorage.setItem(testKey, payload);

                const initialVal = 'STRICT_SAFE_DEFAULT';
                const { result } = renderHook(() => useLocalStorage<string>(testKey, initialVal));

                // Must return initialValue, NEVER the corrupt raw string
                expect(result.current[0]).toBe(initialVal);
                expect(consoleErrorSpy).toHaveBeenCalledWith(
                    expect.stringContaining(`Errore di parsing del localStorage key "${testKey}":`),
                    expect.any(Error)
                );
            });

            it(`CORRUPTION MATRIX [Object fallback]: rejects ${label} and returns initial object`, () => {
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
                const testKey = `corrupt_obj_${encodeURIComponent(label)}`;
                window.localStorage.setItem(testKey, payload);

                const initialObj = { safe: true, count: 100, tags: ['a', 'b'] };
                const { result } = renderHook(() => useLocalStorage(testKey, initialObj));

                expect(result.current[0]).toEqual(initialObj);
                expect(consoleErrorSpy).toHaveBeenCalled();
            });

            it(`CORRUPTION MATRIX [Array fallback]: rejects ${label} and returns initial array`, () => {
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
                const testKey = `corrupt_arr_${encodeURIComponent(label)}`;
                window.localStorage.setItem(testKey, payload);

                const initialArr = ['item1', 'item2'];
                const { result } = renderHook(() => useLocalStorage<string[]>(testKey, initialArr));

                expect(result.current[0]).toEqual(initialArr);
                expect(consoleErrorSpy).toHaveBeenCalled();
            });

            it(`CORRUPTION MATRIX [Number fallback]: rejects ${label} and returns initial number`, () => {
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
                const testKey = `corrupt_num_${encodeURIComponent(label)}`;
                window.localStorage.setItem(testKey, payload);

                const initialNum = 42;
                const { result } = renderHook(() => useLocalStorage<number>(testKey, initialNum));

                expect(result.current[0]).toBe(initialNum);
                expect(consoleErrorSpy).toHaveBeenCalled();
            });
        }

        it('SELF-HEALING: updates to corrupt key cleanly overwrite corrupt raw payload with valid JSON string', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const testKey = 'healing_corrupted_key';
            // Start with corrupt payload
            window.localStorage.setItem(testKey, 'bad_unquoted_value');

            const { result } = renderHook(() => useLocalStorage<string>(testKey, 'initial_default'));
            expect(result.current[0]).toBe('initial_default');

            // Call setter with new valid value
            act(() => {
                result.current[1]('healed_valid_value');
            });

            expect(result.current[0]).toBe('healed_valid_value');
            // The item in localStorage MUST now be properly serialized JSON
            expect(window.localStorage.getItem(testKey)).toBe(JSON.stringify('healed_valid_value'));

            // Re-render hook from clean storage: should parse without error
            consoleErrorSpy.mockClear();
            const { result: reloadedResult } = renderHook(() => useLocalStorage<string>(testKey, 'fallback_tab'));
            expect(reloadedResult.current[0]).toBe('healed_valid_value');
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });
    });
});
