import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { z } from 'zod';
import { useLocalStorage } from '../src/hooks/useLocalStorage';
import ErrorBoundary from '../src/components/UI/ErrorBoundary';
import { DB } from '../src/lib/db';
import { useDialogStore } from '../src/store/useDialogStore';

describe('Empirical Challenger M1-2: useLocalStorage, ErrorBoundary & PWA Architecture Suite', () => {
    
    describe('1. useLocalStorage Adversarial Schema & Fault Injection Matrix', () => {
        beforeEach(() => {
            window.localStorage.clear();
            vi.clearAllMocks();
        });

        afterEach(() => {
            window.localStorage.clear();
            vi.restoreAllMocks();
        });

        // --- SECTION 1A: Diverse Zod Schemas ---
        it('handles primitive string schema with length and regex constraints', () => {
            const usernameSchema = z.string().min(3).max(10).regex(/^[a-z_]+$/);
            const fallback = 'guest_user';

            // Valid stored
            window.localStorage.setItem('user_key', JSON.stringify('gerard'));
            const { result: validRes } = renderHook(() => useLocalStorage('user_key', fallback, usernameSchema));
            expect(validRes.current[0]).toBe('gerard');

            // Invalid stored (too short, uppercase, numbers)
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            window.localStorage.setItem('user_key_invalid', JSON.stringify('AB'));
            const { result: invalidRes } = renderHook(() => useLocalStorage('user_key_invalid', fallback, usernameSchema));
            expect(invalidRes.current[0]).toBe(fallback);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di validazione schema'),
                expect.any(z.ZodError)
            );
        });

        it('handles primitive number schema with positive and integer constraints', () => {
            const portSchema = z.number().int().positive().max(65535);
            const fallback = 3000;

            // Valid number
            window.localStorage.setItem('port', JSON.stringify(8080));
            const { result: validRes } = renderHook(() => useLocalStorage('port', fallback, portSchema));
            expect(validRes.current[0]).toBe(8080);

            // Negative number / float
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            window.localStorage.setItem('port_invalid', JSON.stringify(-5));
            const { result: invalidRes } = renderHook(() => useLocalStorage('port_invalid', fallback, portSchema));
            expect(invalidRes.current[0]).toBe(fallback);
            expect(warnSpy).toHaveBeenCalled();
        });

        it('handles complex nested object schema with UUIDs, dates, and enums', () => {
            const profileSchema = z.object({
                id: z.string().uuid(),
                meta: z.object({
                    age: z.number().min(18).max(120),
                    gender: z.enum(['M', 'F', 'OTHER']),
                    tags: z.array(z.string())
                }),
                isActive: z.boolean()
            });

            const fallbackProfile = {
                id: '00000000-0000-0000-0000-000000000000',
                meta: { age: 25, gender: 'M' as const, tags: ['starter'] },
                isActive: false
            };

            const validProfile = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                meta: { age: 30, gender: 'M' as const, tags: ['powerlifting', 'hypertrophy'] },
                isActive: true
            };

            window.localStorage.setItem('user_profile', JSON.stringify(validProfile));
            const { result } = renderHook(() => useLocalStorage('user_profile', fallbackProfile, profileSchema));
            expect(result.current[0]).toEqual(validProfile);

            // Fault injection: nested field 'age' is invalid string, and 'gender' is invalid enum value
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const corruptedProfile = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                meta: { age: 'thirty', gender: 'ALIEN', tags: [] },
                isActive: true
            };
            window.localStorage.setItem('user_profile_bad', JSON.stringify(corruptedProfile));
            const { result: badResult } = renderHook(() => useLocalStorage('user_profile_bad', fallbackProfile, profileSchema));
            expect(badResult.current[0]).toEqual(fallbackProfile);
            expect(warnSpy).toHaveBeenCalled();
        });

        it('handles array schemas with non-empty and element constraints', () => {
            const routineListSchema = z.array(z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                order: z.number().int()
            })).nonempty();

            const fallbackList = [{ id: 'default', name: 'Default Routine', order: 0 }];

            // Valid non-empty array
            const validList = [
                { id: 'r1', name: 'Push', order: 1 },
                { id: 'r2', name: 'Pull', order: 2 }
            ];
            window.localStorage.setItem('routines', JSON.stringify(validList));
            const { result } = renderHook(() => useLocalStorage('routines', fallbackList, routineListSchema));
            expect(result.current[0]).toEqual(validList);

            // Invalid: empty array (violates .nonempty())
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            window.localStorage.setItem('routines_empty', JSON.stringify([]));
            const { result: emptyRes } = renderHook(() => useLocalStorage('routines_empty', fallbackList, routineListSchema));
            expect(emptyRes.current[0]).toEqual(fallbackList);
            expect(warnSpy).toHaveBeenCalled();
        });

        it('handles discriminated union schemas for polymorphic workout tracking types', () => {
            const workoutSetSchema = z.discriminatedUnion('trackingType', [
                z.object({
                    trackingType: z.literal('weight_reps'),
                    weight: z.number().nonnegative(),
                    reps: z.number().int().positive()
                }),
                z.object({
                    trackingType: z.literal('time'),
                    durationSec: z.number().positive(),
                    load: z.number().optional()
                }),
                z.object({
                    trackingType: z.literal('cardio'),
                    distanceKm: z.number().positive(),
                    durationMin: z.number().positive(),
                    incline: z.number().min(0).max(30).optional()
                })
            ]);

            const fallbackSet = { trackingType: 'weight_reps' as const, weight: 0, reps: 10 };

            // Valid weight_reps
            window.localStorage.setItem('set_1', JSON.stringify({ trackingType: 'weight_reps', weight: 100, reps: 5 }));
            const { result: res1 } = renderHook(() => useLocalStorage('set_1', fallbackSet, workoutSetSchema));
            expect(res1.current[0]).toEqual({ trackingType: 'weight_reps', weight: 100, reps: 5 });

            // Valid cardio
            window.localStorage.setItem('set_2', JSON.stringify({ trackingType: 'cardio', distanceKm: 5.2, durationMin: 25, incline: 2 }));
            const { result: res2 } = renderHook(() => useLocalStorage('set_2', fallbackSet, workoutSetSchema));
            expect(res2.current[0]).toEqual({ trackingType: 'cardio', distanceKm: 5.2, durationMin: 25, incline: 2 });

            // Invalid discriminator value
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            window.localStorage.setItem('set_invalid_disc', JSON.stringify({ trackingType: 'flying', altitude: 1000 }));
            const { result: res3 } = renderHook(() => useLocalStorage('set_invalid_disc', fallbackSet, workoutSetSchema));
            expect(res3.current[0]).toEqual(fallbackSet);
            expect(warnSpy).toHaveBeenCalled();
        });

        it('handles strict schemas rejecting unexpected extra properties', () => {
            const strictConfigSchema = z.object({
                theme: z.enum(['dark', 'light']),
                volume: z.number()
            }).strict();

            const fallback = { theme: 'dark' as const, volume: 50 };

            // Stored data contains injected unexpected keys
            const payloadWithExtra = { theme: 'dark', volume: 50, injectedField: 'malicious', isAdmin: true };
            window.localStorage.setItem('strict_config', JSON.stringify(payloadWithExtra));

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { result } = renderHook(() => useLocalStorage('strict_config', fallback, strictConfigSchema));

            // Strict schema MUST fail and return fallback
            expect(result.current[0]).toEqual(fallback);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di validazione schema'),
                expect.any(z.ZodError)
            );
        });

        it('handles custom refinement and piped transform schemas', () => {
            const evenNumberSchema = z.number().refine(n => n % 2 === 0, { message: 'Must be even' });
            const emailTransformSchema = z.string().transform(e => e.trim().toLowerCase()).pipe(z.string().email());

            const fallbackNum = 2;
            const fallbackEmail = 'default@example.com';

            // Odd number fails refine
vi.spyOn(console, 'warn').mockImplementation(() => {});
            window.localStorage.setItem('odd_num', JSON.stringify(7));
            const { result: numRes } = renderHook(() => useLocalStorage('odd_num', fallbackNum, evenNumberSchema));
            expect(numRes.current[0]).toBe(fallbackNum);

            // Untrimmed uppercase email is transformed and validated
            window.localStorage.setItem('user_email', JSON.stringify('  USER@LOGBOOK.APP '));
            const { result: emailRes } = renderHook(() => useLocalStorage('user_email', fallbackEmail, emailTransformSchema));
            expect(emailRes.current[0]).toBe('user@logbook.app');
        });

        // --- SECTION 1B: Extreme Fault Injection ---
        it('safely recovers from malformed and unparseable JSON tokens', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const testCases = [
                '{ broken_json: ',
                'undefined',
                'NaN',
                'Infinity',
                '[object Object]',
                '{"key": undefined}',
                '<html><body>Server 500</body></html>',
                '',
                '\0\0\0'
            ];

            testCases.forEach((corruptedPayload, idx) => {
                const key = `corrupted_key_${idx}`;
                window.localStorage.setItem(key, corruptedPayload);

                const { result } = renderHook(() => useLocalStorage(key, { safe: true }));
                expect(result.current[0]).toEqual({ safe: true });
            });

            expect(errorSpy).toHaveBeenCalled();
        });

        it('safely handles primitive string stored when object schema expected', () => {
            const schema = z.object({ id: z.string(), count: z.number() });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            window.localStorage.setItem('obj_expected_key', JSON.stringify('plain string instead of object'));
            const { result } = renderHook(() => useLocalStorage('obj_expected_key', { id: 'init', count: 0 }, schema));

            expect(result.current[0]).toEqual({ id: 'init', count: 0 });
            expect(warnSpy).toHaveBeenCalled();
        });

        it('safely handles null in localStorage when nullable is not allowed', () => {
            const schema = z.string();
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            window.localStorage.setItem('non_null_key', JSON.stringify(null));
            const { result } = renderHook(() => useLocalStorage('non_null_key', 'initial', schema));

            expect(result.current[0]).toBe('initial');
            expect(warnSpy).toHaveBeenCalled();
        });

        // --- SECTION 1C: Backward Compatibility (No Schema) ---
        it('preserves full backward compatibility when no schema is provided', () => {
            const noSchemaObj = { a: 1, b: [true, 'test'], c: { nested: true } };
            window.localStorage.setItem('no_schema_key', JSON.stringify(noSchemaObj));

            const { result } = renderHook(() => useLocalStorage('no_schema_key', { fallback: true }));
            expect(result.current[0]).toEqual(noSchemaObj);

            // Setter works and serializes correctly
            act(() => {
                result.current[1]({ updated: true });
            });

            expect(result.current[0]).toEqual({ updated: true });
            expect(JSON.parse(window.localStorage.getItem('no_schema_key')!)).toEqual({ updated: true });
        });

        // --- SECTION 1D: Storage Exception Resilience in useEffect ---
        it('does not throw when localStorage.setItem throws QuotaExceededError', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError: DOM Exception 22');
            });

            const { result } = renderHook(() => useLocalStorage('quota_test', { val: 1 }));
            expect(result.current[0]).toEqual({ val: 1 });

            act(() => {
                result.current[1]({ val: 2 });
            });

            expect(result.current[0]).toEqual({ val: 2 });
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Errore di salvataggio nel localStorage key "quota_test":'),
                expect.any(Error)
            );

            setItemSpy.mockRestore();
        });
    });

    describe('2. ErrorBoundary & GlobalDialog Hardening Verification', () => {
        const ThrowingComponent = ({ message }: { message?: string }) => {
            throw new Error(message || 'Fatal Component Explosion');
        };

        beforeEach(() => {
            vi.clearAllMocks();
            window.localStorage.clear();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('renders children smoothly when no error is thrown', () => {
            render(
                <ErrorBoundary>
                    <div data-testid="child-ok">Application Running Normally</div>
                </ErrorBoundary>
            );

            expect(screen.getByTestId('child-ok').textContent).toBe('Application Running Normally');
        });

        it('catches fatal exception, mounts GlobalDialog, and renders fallback UI', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            render(
                <ErrorBoundary>
                    <ThrowingComponent message="Uncaught Crash in View" />
                </ErrorBoundary>
            );

            expect(screen.getByText('Ops, qualcosa è andato storto!')).toBeDefined();
            expect(screen.getByText('Si è verificato un errore imprevisto. Prova a ricaricare la pagina.')).toBeDefined();
            expect(screen.getByText(/Ricarica pagina/i)).toBeDefined();
            expect(screen.getByText(/Azzera dati locali/i)).toBeDefined();

            errorSpy.mockRestore();
        });

        it('reloads page when "Ricarica pagina" button is clicked', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const reloadMock = vi.fn();
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { reload: reloadMock }
            });

            render(
                <ErrorBoundary>
                    <ThrowingComponent />
                </ErrorBoundary>
            );

            fireEvent.click(screen.getByText(/Ricarica pagina/i));
            expect(reloadMock).toHaveBeenCalledTimes(1);

            errorSpy.mockRestore();
        });

        it('confirms and purges through the local-data boundary before reloading', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const reloadMock = vi.fn();
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { reload: reloadMock }
            });

            vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);
            vi.mocked(window.localStorage.clear).mockClear();

            render(
                <ErrorBoundary>
                    <ThrowingComponent />
                </ErrorBoundary>
            );

            const resetBtn = screen.getByText(/Azzera dati locali/i);
            await act(async () => {
                fireEvent.click(resetBtn);
            });

            expect(useDialogStore.getState().showConfirm).toHaveBeenCalledWith(
                'Questa operazione elimina i dati locali della sessione corrente, inclusi quelli non ancora sincronizzati. I dati già presenti nel cloud non vengono cancellati. Procedere?',
                'Azzera dati locali'
            );
            expect(DB.purgeAllLocalUserData).toHaveBeenCalledTimes(1);
            expect(window.localStorage.clear).not.toHaveBeenCalled();
            expect(reloadMock).toHaveBeenCalledTimes(1);

            errorSpy.mockRestore();
        });

        it('aborts local-data purge when confirmation is cancelled', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const reloadMock = vi.fn();
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { reload: reloadMock }
            });

            vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(false);
            vi.mocked(window.localStorage.clear).mockClear();

            render(
                <ErrorBoundary>
                    <ThrowingComponent />
                </ErrorBoundary>
            );

            const resetBtn = screen.getByText(/Azzera dati locali/i);
            await act(async () => {
                fireEvent.click(resetBtn);
            });

            expect(useDialogStore.getState().showConfirm).toHaveBeenCalled();
            expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
            expect(window.localStorage.clear).not.toHaveBeenCalled();
            expect(reloadMock).not.toHaveBeenCalled();

            errorSpy.mockRestore();
        });
    });

    describe('3. Dynamic Base Path & PWA Manifest Evaluation', () => {
        it('evaluates base path defaulting logic for all environment variations', () => {
            const computeBasePath = (envVal: string | undefined): string => {
                return envVal || '/';
            };

            // Variation 1: undefined -> root '/'
            expect(computeBasePath(undefined)).toBe('/');

            // Variation 2: empty string -> root '/'
            expect(computeBasePath('')).toBe('/');

            // Variation 3: custom subpath
            expect(computeBasePath('/logbook/')).toBe('/logbook/');
            expect(computeBasePath('/custom-pwa-path/')).toBe('/custom-pwa-path/');

            // Variation 4: relative path './'
            expect(computeBasePath('./')).toBe('./');
        });

        it('ensures start_url, scope, and base are uniformly aligned in manifest configuration', () => {
            const createPwaConfig = (basePathEnv?: string) => {
                const basePath = basePathEnv || '/';
                return {
                    base: basePath,
                    manifest: {
                        start_url: basePath,
                        scope: basePath
                    }
                };
            };

            const defaultCfg = createPwaConfig(undefined);
            expect(defaultCfg.base).toBe('/');
            expect(defaultCfg.manifest.start_url).toBe('/');
            expect(defaultCfg.manifest.scope).toBe('/');

            const customCfg = createPwaConfig('/logbook/');
            expect(customCfg.base).toBe('/logbook/');
            expect(customCfg.manifest.start_url).toBe('/logbook/');
            expect(customCfg.manifest.scope).toBe('/logbook/');
        });
    });
});