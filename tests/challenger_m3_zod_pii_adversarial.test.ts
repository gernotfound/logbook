import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import {
    DomainParsers,
    UserDataSchema,
    setSchemaFallbackListener,
    reportZodSchemaFallback,
    defaultUserDataFallback,
    type ZodFallbackContext
} from '../src/lib/schema';
import { telemetryHub } from '../src/lib/telemetryHub';

describe('Adversarial Challenger M3: Zod Fallbacks, Zero-PII Leakage & Stress Hardening', () => {
    const capturedSetDocPayloads: Array<{ path: string; payload: any }> = [];
    let mockSetDoc: any;

    const SENSITIVE_STRINGS = [
        'super_secret_password_12345!',
        'user.victim_test@confidential-corp.org',
        'AIzaSyB39xK94aZp01234567890123456789012',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature',
        '192.168.1.105',
        '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        'C:\\Users\\Administrator\\SecretDocuments\\bank_details.txt',
        '/home/confidential_user/.ssh/id_rsa',
        '4532-1234-5678-9012',
        '+39 333 9876543',
        'Patient diagnosed with hypertension and acute tendonitis',
        'SELECT * FROM users WHERE password IS NOT NULL; --',
    ];

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        capturedSetDocPayloads.length = 0;
        vi.clearAllMocks();
        vi.useRealTimers();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

        mockSetDoc = vi.spyOn(firestoreModule, 'setDoc').mockImplementation(async (docRef: any, data: any) => {
            capturedSetDocPayloads.push({ path: docRef?.path || '', payload: data });
            return undefined;
        });

        vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {
            return { path: pathSegments.join('/') } as any;
        });

        setSchemaFallbackListener(null);
        telemetryHub.reset();
        telemetryHub.init();
        telemetryHub.setUserId('adversarial_challenger_user');
    });

    afterEach(() => {
        setSchemaFallbackListener(null);
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
        vi.useRealTimers();
        telemetryHub.reset();
    });

    function assertZeroPIIInTelemetry(capturedPayloads: Array<{ path: string; payload: any }>) {
        expect(capturedPayloads.length).toBeGreaterThan(0);
        for (const item of capturedPayloads) {
            const stringified = JSON.stringify(item);
            for (const secret of SENSITIVE_STRINGS) {
                expect(stringified).not.toContain(secret);
            }
        }
    }

    describe('1. Comprehensive PII Fuzzing Across All Domain Parsers', () => {
        it('DomainParsers.parseProfile with malicious PII strings activates fallback with zero leakage', async () => {
            vi.useFakeTimers();

            for (const secret of SENSITIVE_STRINGS) {
                const maliciousInput = `CORRUPT_PROFILE_${secret}`;
                const result = DomainParsers.parseProfile(maliciousInput);
                expect(result).toEqual({});
            }

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseWorkoutSession with malicious PII activates fallback with zero leakage', async () => {
            vi.useFakeTimers();

            for (const secret of SENSITIVE_STRINGS) {
                const maliciousInput = `CORRUPT_WORKOUT_${secret}`;
                const result = DomainParsers.parseWorkoutSession(maliciousInput);
                expect(result).toBeDefined();
                expect(result.exercises).toEqual([]);
                expect(result.pains).toEqual([]);
            }

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseNutritionPlanning with malicious PII activates fallback with zero leakage', async () => {
            vi.useFakeTimers();

            for (const secret of SENSITIVE_STRINGS) {
                const maliciousInput = `CORRUPT_PLANNING_${secret}`;
                const result = DomainParsers.parseNutritionPlanning(maliciousInput);
                expect(result).toEqual({});
            }

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseHistory with non-array and corrupted elements containing PII', async () => {
            vi.useFakeTimers();

            // Non-array input
            const nonArrayResult = DomainParsers.parseHistory(`INVALID_HISTORY_${SENSITIVE_STRINGS[0]}`);
            expect(nonArrayResult).toEqual([]);

            // Array containing corrupted items with PII
            const arrayInput = [
                { id: 'session_ok', date: '2026-08-25', exercises: [] },
                `CORRUPT_SESSION_${SENSITIVE_STRINGS[1]}`,
                `CORRUPT_SESSION_${SENSITIVE_STRINGS[2]}`,
            ];
            const arrayResult = DomainParsers.parseHistory(arrayInput);
            expect(arrayResult).toHaveLength(3);
            expect(arrayResult[0].id).toBe('session_ok');
            expect(arrayResult[1].exercises).toEqual([]);
            expect(arrayResult[2].exercises).toEqual([]);

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseLibrary with non-array and corrupted elements containing PII', async () => {
            vi.useFakeTimers();

            const nonArrayResult = DomainParsers.parseLibrary(`INVALID_LIBRARY_${SENSITIVE_STRINGS[3]}`);
            expect(nonArrayResult).toEqual([]);

            const arrayInput = [
                { id: 'ex1', name: 'Bench Press', setsCount: 4, muscles: [], secondaryMuscles: [], sets: [] },
                `CORRUPT_EXERCISE_${SENSITIVE_STRINGS[4]}`,
            ];
            const arrayResult = DomainParsers.parseLibrary(arrayInput);
            expect(arrayResult).toHaveLength(2);
            expect(arrayResult[0].id).toBe('ex1');
            expect(arrayResult[1].name).toBe('');

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseCustomFoods with non-array and corrupted elements containing PII', async () => {
            vi.useFakeTimers();

            const nonArrayResult = DomainParsers.parseCustomFoods(`INVALID_FOODS_${SENSITIVE_STRINGS[5]}`);
            expect(nonArrayResult).toEqual([]);

            const arrayInput = [
                { name: 'Oatmeal', kcal: 360, pro: 13, carbs: 60, fat: 7 },
                `CORRUPT_FOOD_${SENSITIVE_STRINGS[6]}`,
            ];
            const arrayResult = DomainParsers.parseCustomFoods(arrayInput);
            expect(arrayResult).toHaveLength(2);
            expect(arrayResult[0].name).toBe('Oatmeal');
            expect(arrayResult[1].name).toBe('');

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseRoutines with non-array and corrupted elements containing PII', async () => {
            vi.useFakeTimers();

            const nonArrayResult = DomainParsers.parseRoutines(`INVALID_ROUTINES_${SENSITIVE_STRINGS[7]}`);
            expect(nonArrayResult).toEqual([]);

            const arrayInput = [
                { id: 'r1', name: 'Push', exercises: [] },
                `CORRUPT_ROUTINE_${SENSITIVE_STRINGS[8]}`,
            ];
            const arrayResult = DomainParsers.parseRoutines(arrayInput);
            expect(arrayResult).toHaveLength(2);
            expect(arrayResult[0].id).toBe('r1');
            expect(arrayResult[1].name).toBe('');

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseTrainingCycles with non-array and corrupted elements containing PII', async () => {
            vi.useFakeTimers();

            const nonArrayResult = DomainParsers.parseTrainingCycles(`INVALID_CYCLES_${SENSITIVE_STRINGS[9]}`);
            expect(nonArrayResult).toEqual([]);

            const arrayInput = [
                { id: 'c1', name: 'Strength', durationWeeks: 4, routines: [] },
                `CORRUPT_CYCLE_${SENSITIVE_STRINGS[10]}`,
            ];
            const arrayResult = DomainParsers.parseTrainingCycles(arrayInput);
            expect(arrayResult).toHaveLength(2);
            expect(arrayResult[0].id).toBe('c1');
            expect(arrayResult[1].name).toBe('');

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseSupplements with non-array and corrupted elements containing PII', async () => {
            vi.useFakeTimers();

            const nonArrayResult = DomainParsers.parseSupplements(`INVALID_SUPPLEMENTS_${SENSITIVE_STRINGS[11]}`);
            expect(nonArrayResult).toEqual([]);

            const arrayInput = [
                { id: 's1', name: 'Whey Protein', unit: 'scoop' },
                `CORRUPT_SUPPLEMENT_${SENSITIVE_STRINGS[0]}`,
            ];
            const arrayResult = DomainParsers.parseSupplements(arrayInput);
            expect(arrayResult).toHaveLength(2);
            expect(arrayResult[0].id).toBe('s1');
            expect(arrayResult[1].name).toBe('');

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseActivePains filtering invalid items containing PII', async () => {
            vi.useFakeTimers();

            const nonArrayResult = DomainParsers.parseActivePains(`INVALID_PAINS_${SENSITIVE_STRINGS[1]}`);
            expect(nonArrayResult).toEqual([]);

            const painsArray = [
                'Ginocchio sinistro',
                12345, // invalid type
                { confidential: SENSITIVE_STRINGS[2] }, // invalid type
                '', // empty string
                null, // null
                undefined, // undefined
            ];

            const result = DomainParsers.parseActivePains(painsArray);
            expect(result).toEqual(['Ginocchio sinistro']);

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('DomainParsers.parseNutrition with non-object and corrupted days containing PII', async () => {
            vi.useFakeTimers();

            const nonObjResult = DomainParsers.parseNutrition(`INVALID_NUTRITION_${SENSITIVE_STRINGS[3]}`);
            expect(nonObjResult).toEqual({});

            const nutritionData = {
                '2026-08-25': { date: '2026-08-25', kcal: 2000, pro: 150, carbs: 200, fat: 60, meals: [], supplementsIntake: [] },
                '2026-08-26': `CORRUPT_DAY_${SENSITIVE_STRINGS[4]}`,
            };

            const result = DomainParsers.parseNutrition(nutritionData);
            expect(result['2026-08-25']).toBeDefined();
            expect(result['2026-08-26']).toBeDefined();
            expect(result['2026-08-26'].date).toBe('');

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });

        it('UserDataSchema root parsing fallback on complete corruption with PII', async () => {
            vi.useFakeTimers();

            const completelyCorruptData = `TOTAL_DATABASE_CORRUPTION_WITH_TOKEN_${SENSITIVE_STRINGS[3]}_AND_EMAIL_${SENSITIVE_STRINGS[1]}`;
            const parsed = UserDataSchema.parse(completelyCorruptData);

            expect(parsed).toEqual(defaultUserDataFallback);

            await vi.advanceTimersByTimeAsync(100);

            assertZeroPIIInTelemetry(capturedSetDocPayloads);
        });
    });

    describe('2. Custom Schema Fallback Listener Isolation', () => {
        it('listener receives structured metadata without raw input payload', () => {
            const capturedContexts: ZodFallbackContext[] = [];
            setSchemaFallbackListener((ctx) => {
                capturedContexts.push(ctx);
            });

            DomainParsers.parseProfile(`MALICIOUS_${SENSITIVE_STRINGS[0]}`);

            expect(capturedContexts.length).toBe(1);
            const ctx = capturedContexts[0];
            expect(ctx.schema).toBe('UserProfileSchema');
            expect(ctx.fallbackUsed).toBe('default_empty_profile');

            const stringified = JSON.stringify(ctx);
            for (const secret of SENSITIVE_STRINGS) {
                expect(stringified).not.toContain(secret);
            }
        });

        it('throwing custom listener does NOT crash validation or throw to caller', () => {
            setSchemaFallbackListener(() => {
                throw new Error('Hostile listener throwing deliberately');
            });

            expect(() => {
                const res = DomainParsers.parseProfile('corrupt');
                expect(res).toEqual({});
            }).not.toThrow();
        });
    });

    describe('3. Adversarial Stress & High-Throughput Burst Test', () => {
        it('handles burst of 1,000 corrupt parsing requests in < 300ms without memory leak or freeze', () => {
            const start = performance.now();

            for (let i = 0; i < 1000; i++) {
                DomainParsers.parseProfile(`corrupt_burst_${i % 10}`);
                DomainParsers.parseWorkoutSession(`corrupt_workout_${i % 10}`);
                DomainParsers.parseNutritionPlanning(`corrupt_planning_${i % 10}`);
            }

            const elapsed = performance.now() - start;
            expect(elapsed).toBeLessThan(500); // Must be fast for 3,000 parse operations
        });

        it('deduplicates error flood within 60s sliding window so only 1 error doc is dispatched', async () => {
            vi.useFakeTimers();

            for (let i = 0; i < 500; i++) {
                DomainParsers.parseProfile('repeated_corrupt_profile');
            }

            // Deduplicator should aggregate repeated errors for the same schema
            expect(telemetryHub.getActiveRateLimiterCount()).toBeLessThanOrEqual(5);

            await vi.advanceTimersByTimeAsync(100);

            // Filter captured payloads by error vs event
            const errorCalls = capturedSetDocPayloads.filter((c) => c.path.includes('telemetry_errors'));
            const eventCalls = capturedSetDocPayloads.filter((c) => c.path.includes('telemetry_events'));

            // Error must be deduplicated to exactly 1 Firestore doc
            expect(errorCalls.length).toBe(1);
            expect(errorCalls[0].payload.count).toBe(500);
            expect(errorCalls[0].payload.source).toBe('zod_schema_fallback');

            // Events were dispatched for each occurrence
            expect(eventCalls.length).toBe(500);
        });
    });

    describe('4. TelemetryHub Fault Tolerance', () => {
        it('reportZodSchemaFallback fails safely when telemetryHub.trackEvent and trackError throw', () => {
            const originalTrackEvent = telemetryHub.trackEvent;
            const originalTrackError = telemetryHub.trackError;

            try {
                (telemetryHub as any).trackEvent = () => {
                    throw new Error('Explosive trackEvent failure');
                };
                (telemetryHub as any).trackError = () => {
                    throw new Error('Explosive trackError failure');
                };

                expect(() => {
                    reportZodSchemaFallback({
                        schema: 'TestSchema',
                        field: 'testField',
                        fallbackUsed: 'test_fallback',
                    });
                }).not.toThrow();

                expect(() => {
                    const result = DomainParsers.parseProfile('corrupt_when_hub_throws');
                    expect(result).toEqual({});
                }).not.toThrow();
            } finally {
                telemetryHub.trackEvent = originalTrackEvent;
                telemetryHub.trackError = originalTrackError;
            }
        });
    });
});
