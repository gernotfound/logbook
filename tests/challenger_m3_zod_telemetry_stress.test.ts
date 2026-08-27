import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import {
    DomainParsers,
    UserDataSchema,









    setSchemaFallbackListener,
    reportZodSchemaFallback,
} from '../src/lib/schema';
import {
    telemetryHub,
    TELEMETRY_QUEUE_KEY,
    TELEMETRY_QUEUE_CAPACITY,
    type TelemetryErrorPayload,

} from '../src/lib/telemetryHub';

describe('Empirical Challenger: Milestone 3 (R1: Zod Integration) Adversarial Stress Suite', () => {
    let mockSetDoc: any;

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.clearAllMocks();
        vi.useRealTimers();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

        mockSetDoc = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);
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

    // =========================================================================
    // 1. Rapid Bursts of 1000+ Malformed Records (Throughput & Non-Blocking)
    // =========================================================================
    describe('1. High-Load Burst Testing (1000+ Malformed Records)', () => {
        it('processes 1,000 malformed profile records in < 500ms without throwing or hanging', () => {
            // Build input array once; same inputs used in both sections (correctness and timing)
            const samples = Array.from({ length: 1000 }, (_, i) =>
                i % 2 === 0
                    ? `corrupted_profile_${i}`
                    : { height: null, waist: { invalid: true }, [i]: 'junk' }
            );

            // Correctness check (outside timer): Vitest/chai expect() overhead not included
            for (const input of samples.slice(0, 10)) {
                const result = DomainParsers.parseProfile(input);
                expect(result).toBeDefined();
                expect(typeof result).toBe('object');
            }

            // Timed section: only Zod parsing, no Vitest matcher overhead
            const start = performance.now();
            for (const input of samples) {
                const result = DomainParsers.parseProfile(input);
                if (!result || typeof result !== 'object') {
                    throw new Error(`parseProfile returned an invalid result for input: ${JSON.stringify(input)}`);
                }
            }
            const duration = performance.now() - start;

            // 500ms: robust threshold for Windows CI scheduling jitter.
            // This is a test-environment guard, NOT a product SLA.
            // Pure Zod parse of 1,000 records typically completes in < 30ms.
            expect(duration).toBeLessThan(500);
        });

        it('processes 1,000 malformed workout sessions in < 500ms without throwing', () => {
            // Baseline measured: ~80-86ms for pure parsing.
            // 500ms threshold ensures 95th percentile stability on CI multi-thread runs to tolerate scheduling jitter.
            // This is a test-environment guard, NOT a product SLA.
            
            // 1. Correctness check (isolated sample)
            const sample = DomainParsers.parseWorkoutSession({ exercises: [{ sets: 'invalid_sets' }] });
            expect(sample).toBeDefined();
            expect(Array.isArray(sample.exercises)).toBe(true);

            // 2. Pure performance loop (timing separated from expectations)
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                const malformed = i % 3 === 0 
                    ? `corrupted_session_${i}` 
                    : i % 3 === 1 
                        ? { exercises: 'not_an_array', moodRating: 'bad' } 
                        : { exercises: [{ sets: 'invalid_sets' }] };
                DomainParsers.parseWorkoutSession(malformed);
            }
            const duration = performance.now() - start;
            expect(duration).toBeLessThan(500);
        });

        it('processes 1,000 malformed custom food records in < 250ms without throwing', () => {
            const start = performance.now();
            const malformedArray = Array.from({ length: 1000 }, (_, i) => 
                i % 2 === 0 ? `corrupt_food_${i}` : { name: 12345, kcal: 'invalid_kcal', satFat: 'bad_fat' }
            );
            const result = DomainParsers.parseCustomFoods(malformedArray);
            expect(result).toHaveLength(0);
            for (const food of result) {
                expect(typeof food.name).toBe('string');
                expect(typeof food.kcal).toBe('number');
                expect(isNaN(food.kcal)).toBe(false);
            }
            const duration = performance.now() - start;
            expect(duration).toBeLessThan(250);
        });

        it('processes 1,000 malformed history items in < 300ms without throwing', () => {
            const start = performance.now();
            const malformedHistory = Array.from({ length: 1000 }, (_, i) => 
                i % 2 === 0 ? `corrupt_history_${i}` : { id: 123, exercises: 'bad_array' }
            );
            const result = DomainParsers.parseHistory(malformedHistory);
            expect(result).toHaveLength(1000);
            for (const session of result) {
                expect(Array.isArray(session.exercises)).toBe(true);
            }
            const duration = performance.now() - start;
            expect(duration).toBeLessThan(300);
        });

        it('processes 1,000 malformed UserData monolithic parses in < 500ms and yields safe defaults', () => {
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                const malformed = i % 4 === 0 
                    ? `total_junk_${i}` 
                    : i % 4 === 1 
                        ? { library: 'bad', routines: null, nutrition: 12345 } 
                        : i % 4 === 2 
                            ? { activeWorkout: 'invalid_active', customFoods: { not: 'array' } } 
                            : null;
                const result = UserDataSchema.parse(malformed);
                expect(result).toBeDefined();
                expect(Array.isArray(result.library)).toBe(true);
                expect(Array.isArray(result.routines)).toBe(true);
                expect(Array.isArray(result.history)).toBe(true);
                expect(typeof result.nutrition).toBe('object');
            }
            const duration = performance.now() - start;
            expect(duration).toBeLessThan(500);
        });
    });

    // =========================================================================
    // 2. Deeply Nested Corrupted Objects & Recursion Safety
    // =========================================================================
    describe('2. Deeply Nested Corrupted Objects & Recursion Safety', () => {
        it('handles 50-level nested corrupted objects in DomainParsers without stack overflow', () => {
            let deeplyNested: any = { leaf: 'poison' };
            for (let i = 0; i < 50; i++) {
                deeplyNested = { level: i, nested: deeplyNested, badField: NaN };
            }

            expect(() => DomainParsers.parseProfile(deeplyNested)).not.toThrow();
            expect(() => DomainParsers.parseWorkoutSession(deeplyNested)).not.toThrow();
            expect(() => DomainParsers.parseNutritionPlanning(deeplyNested)).not.toThrow();
            expect(() => DomainParsers.parseHistory([deeplyNested])).not.toThrow();
            expect(() => DomainParsers.parseLibrary([deeplyNested])).not.toThrow();
            expect(() => DomainParsers.parseCustomFoods([deeplyNested])).not.toThrow();
            expect(() => DomainParsers.parseRoutines([deeplyNested])).not.toThrow();
            expect(() => DomainParsers.parseTrainingCycles([deeplyNested])).not.toThrow();
            expect(() => DomainParsers.parseSupplements([deeplyNested])).not.toThrow();
            expect(() => DomainParsers.parseNutrition({ '2026-08-25': deeplyNested })).not.toThrow();
            expect(() => UserDataSchema.parse(deeplyNested)).not.toThrow();
        });

        it('handles deeply nested corrupted workout sessions with malformed sets, dropsets, and isometrics', () => {
            const malformedSession = {
                id: 'sess_deep',
                exercises: Array.from({ length: 20 }, (_, exIdx) => ({
                    exId: `ex_${exIdx}`,
                    sets: Array.from({ length: 10 }, (_, setIdx) => ({
                        id: `s_${setIdx}`,
                        kg: { complex: 'not_a_string' },
                        reps: [1, 2, 3],
                        dropsets: Array.from({ length: 5 }, (_, dsIdx) => ({
                            id: `ds_${dsIdx}`,
                            kg: { nested: true },
                            reps: null,
                        })),
                        isometrics: Array.from({ length: 5 }, (_, isoIdx) => ({
                            id: `iso_${isoIdx}`,
                            kg: undefined,
                            time: { deep: { deeper: 'error' } },
                        })),
                    })),
                })),
            };

            const parsed = DomainParsers.parseWorkoutSession(malformedSession);
            expect(parsed.exercises).toHaveLength(20);
            expect(parsed.exercises[0].sets).toHaveLength(10);
            expect(parsed.exercises[0].sets[0].dropsets).toHaveLength(5);
            expect(parsed.exercises[0].sets[0].isometrics).toHaveLength(5);
            expect(typeof parsed.exercises[0].sets[0].kg).toBe('string');
            expect(typeof parsed.exercises[0].sets[0].dropsets![0].kg).toBe('string');
            expect(typeof parsed.exercises[0].sets[0].isometrics![0].time).toBe('string');
        });

        it('handles heavily nested nutrition day with corrupted meals, micronutrients, and supplements', () => {
            const malformedNutrition = {
                '2026-08-25': {
                    date: '2026-08-25',
                    kcal: '2500',
                    pro: { nested: 160 },
                    carbs: NaN,
                    fat: null,
                    meals: Array.from({ length: 15 }, (_, mIdx) => ({
                        id: `m_${mIdx}`,
                        name: { name: 'Whey' },
                        meal: 12345,
                        quantity: '100g',
                        kcal: '380',
                        pro: null,
                        carbs: undefined,
                        fat: NaN,
                    })),
                    supplementsIntake: Array.from({ length: 10 }, (_, sIdx) => ({
                        id: `si_${sIdx}`,
                        supplementId: { id: 'creatine' },
                        amount: '5g',
                        time: '12:00',
                    })),
                    sleepHours: { invalid: 'object' },
                },
            };

            const parsed = DomainParsers.parseNutrition(malformedNutrition);
            const day = parsed['2026-08-25'];
            expect(day).toBeDefined();
            expect(day.kcal).toBe(2500);
            expect(day.carbs).toBe(0);
            expect(day.fat).toBe(0);
            expect(day.meals).toHaveLength(15);
            expect(day.supplementsIntake).toHaveLength(10);
            expect(day.sleepHours).toBeUndefined();
        });
    });

    // =========================================================================
    // 3. Circular Object References & Prototype Pollution Protection
    // =========================================================================
    describe('3. Circular References & Prototype Pollution', () => {
        it('safely handles self-referential circular objects in DomainParsers and UserDataSchema without freezing', () => {
            const circularObj: any = {
                name: 'Circular test',
                id: 'circ_1',
            };
            circularObj.self = circularObj;
            circularObj.nested = { parent: circularObj };

            expect(() => DomainParsers.parseProfile(circularObj)).not.toThrow();
            expect(() => DomainParsers.parseWorkoutSession(circularObj)).not.toThrow();
            expect(() => DomainParsers.parseNutritionPlanning(circularObj)).not.toThrow();
            expect(() => DomainParsers.parseHistory([circularObj])).not.toThrow();
            expect(() => DomainParsers.parseLibrary([circularObj])).not.toThrow();
            expect(() => DomainParsers.parseCustomFoods([circularObj])).not.toThrow();
            expect(() => DomainParsers.parseRoutines([circularObj])).not.toThrow();
            expect(() => DomainParsers.parseTrainingCycles([circularObj])).not.toThrow();
            expect(() => DomainParsers.parseSupplements([circularObj])).not.toThrow();
            expect(() => DomainParsers.parseNutrition({ '2026-08-25': circularObj })).not.toThrow();
            expect(() => UserDataSchema.parse(circularObj)).not.toThrow();
        });

        it('safely handles mutual circular references between two objects', () => {
            const objA: any = { id: 'A', name: 'Object A' };
            const objB: any = { id: 'B', name: 'Object B', refA: objA };
            objA.refB = objB;

            expect(() => DomainParsers.parseWorkoutSession(objA)).not.toThrow();
            expect(() => DomainParsers.parseHistory([objA, objB])).not.toThrow();
            expect(() => UserDataSchema.parse({ activeWorkout: objA, library: [objB] })).not.toThrow();
        });

        it('defends against prototype pollution payloads without altering Object prototype', () => {
            const pollutionPayload = JSON.parse(
                '{"__proto__": {"polluted": "YES"}, "constructor": {"prototype": {"injected": "YES"}}}'
            );

            DomainParsers.parseProfile(pollutionPayload);
            DomainParsers.parseWorkoutSession(pollutionPayload);
            UserDataSchema.parse(pollutionPayload);

            expect((Object.prototype as any).polluted).toBeUndefined();
            expect((Object.prototype as any).injected).toBeUndefined();
        });

        it('handles Object.create(null) dictionary objects without prototype methods', () => {
            const nullProtoObj = Object.create(null);
            nullProtoObj.height = '180';
            nullProtoObj.weight = '80';
            nullProtoObj.waist = '82';

            const parsed = DomainParsers.parseProfile(nullProtoObj);
            expect(parsed).toBeDefined();
            expect((parsed as any).height).toBe('180');
        });

        it('handles sparse arrays with massive empty slots safely without high memory allocation', () => {
            const sparse = new Array(5000);
            sparse[0] = { id: 'ex_1', name: 'Bench Press', setsCount: 3 };
            sparse[2500] = { id: 'ex_2', name: 'Squat', setsCount: 5 };

            const parsed = DomainParsers.parseLibrary(sparse);
            expect(parsed).toBeDefined();
            expect(parsed.length).toBe(2);
            expect(parsed[0].name).toBe('Bench Press');
            expect(parsed[1].name).toBe('Squat');
        });
    });

    // =========================================================================
    // 4. Undefined / Null / Symbol / BigInt / Function Cascades
    // =========================================================================
    describe('4. Type Edge Cases & Weird Primitives', () => {
        it('handles Symbol, BigInt, Function, and Promise inputs in DomainParsers gracefully', () => {
            const weirdInputs = [
                Symbol('malicious_symbol'),
                BigInt(9007199254740991),
                () => 'evil_function',
                Promise.resolve('evil_promise'),
                new Date(),
                /regex_attack/gi,
                new Map([['key', 'val']]),
                new Set([1, 2, 3]),
                new Uint8Array([1, 2, 3, 4]),
            ];

            for (const input of weirdInputs) {
                expect(() => DomainParsers.parseProfile(input)).not.toThrow();
                expect(() => DomainParsers.parseWorkoutSession(input)).not.toThrow();
                expect(() => DomainParsers.parseNutritionPlanning(input)).not.toThrow();
                expect(() => DomainParsers.parseHistory(input as any)).not.toThrow();
                expect(() => DomainParsers.parseLibrary(input as any)).not.toThrow();
                expect(() => DomainParsers.parseCustomFoods(input as any)).not.toThrow();
                expect(() => DomainParsers.parseRoutines(input as any)).not.toThrow();
                expect(() => DomainParsers.parseTrainingCycles(input as any)).not.toThrow();
                expect(() => DomainParsers.parseSupplements(input as any)).not.toThrow();
                expect(() => DomainParsers.parseActivePains(input as any)).not.toThrow();
                expect(() => DomainParsers.parseNutrition(input as any)).not.toThrow();
                expect(() => UserDataSchema.parse(input)).not.toThrow();
            }
        });
    });

    // =========================================================================
    // 5. Telemetry Deduplication & Queue Safety under Zod Storm
    // =========================================================================
    describe('5. Telemetry Deduplication & Queue Invariant under Storm', () => {
        it('deduplicates 1,000 rapid schema fallbacks into aggregated rate limiters without duplicate firestore writes', async () => {
            vi.useFakeTimers();

            for (let i = 0; i < 1000; i++) {
                reportZodSchemaFallback({
                    schema: 'UserProfileSchema',
                    field: 'height',
                    issueCode: 'invalid_type',
                    expectedType: 'string',
                    receivedType: 'number',
                    fallbackUsed: 'default_empty_profile',
                });
            }

            // Flush microtasks
            await vi.advanceTimersByTimeAsync(50);

            // Active rate limiters should only have 1 entry (deduplicated by hash)
            expect(telemetryHub.getActiveRateLimiterCount()).toBe(1);

            // Exactly 1 Firestore dispatch occurred for the initial occurrence
            const errorCalls = mockSetDoc.mock.calls.filter((c: any) => c[1].type === 'ZodSchemaFallbackError');
            expect(errorCalls.length).toBe(1);

            const payload = errorCalls[0][1] as TelemetryErrorPayload;
            expect(payload.count).toBe(1000);
            expect(payload.source).toBe('zod_schema_fallback');
        });

        it('maintains strict offline FIFO queue capacity of <= 50 items under a storm of 500 distinct schema fallbacks', () => {
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

            for (let i = 0; i < 500; i++) {
                reportZodSchemaFallback({
                    schema: `Schema_${i}`,
                    field: `field_${i}`,
                    issueCode: 'invalid_type',
                    expectedType: 'string',
                    receivedType: 'number',
                    fallbackUsed: 'default',
                });
            }

            const rawQueue = localStorage.getItem(TELEMETRY_QUEUE_KEY);
            expect(rawQueue).toBeDefined();
            const queue = JSON.parse(rawQueue!);
            expect(Array.isArray(queue)).toBe(true);
            expect(queue.length).toBeLessThanOrEqual(TELEMETRY_QUEUE_CAPACITY);
            expect(queue.length).toBe(TELEMETRY_QUEUE_CAPACITY);
        });

        it('replays offline schema fallback items cleanly upon reconnection', async () => {
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

            // Generate 10 offline fallbacks
            for (let i = 0; i < 10; i++) {
                reportZodSchemaFallback({
                    schema: 'ExerciseSchema',
                    field: `field_${i}`,
                    issueCode: 'invalid_type',
                    expectedType: 'string',
                    receivedType: 'number',
                    fallbackUsed: 'default_empty_exercise',
                });
            }

            expect(telemetryHub.getQueuedEvents().length).toBeGreaterThanOrEqual(10);

            // Come back online and flush
            Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
            await telemetryHub.flushQueue();

            expect(telemetryHub.getQueuedEvents().length).toBe(0);
            expect(mockSetDoc).toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 6. Strict Privacy & Zero-PII Leakage Verification
    // =========================================================================
    describe('6. Privacy & Zero-PII Leakage Adversarial Verification', () => {
        it('never leaks PII, passwords, JWT tokens, paths or API keys even when embedded in corrupted payload objects', async () => {
            vi.useFakeTimers();

            const maliciousProfile = {
                height: '180cm',
                email: 'victim_user_private@company.org',
                secretToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDNxyz',
                apiKey: 'AIzaSyA_fake_secret_key_for_testing_1234',
                localPath: 'C:\\Users\\Administrator\\Documents\\SecretNotes.txt',
                password: 'SuperSecretPassword123!',
                waist: { secret: 'nested_secret_123' },
            };

            DomainParsers.parseProfile(maliciousProfile);
            UserDataSchema.parse(maliciousProfile);

            await vi.advanceTimersByTimeAsync(50);

            for (const call of mockSetDoc.mock.calls) {
                const serialized = JSON.stringify(call[1]);
                expect(serialized).not.toContain('victim_user_private@company.org');
                expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
                expect(serialized).not.toContain('AIzaSyA_fake_secret_key');
                expect(serialized).not.toContain('Administrator');
                expect(serialized).not.toContain('SuperSecretPassword123!');
                expect(serialized).not.toContain('nested_secret_123');
            }
        });
    });

    // =========================================================================
    // 7. Pluggable Fallback Listener Resilience
    // =========================================================================
    describe('7. Schema Fallback Listener Isolation', () => {
        it('survives throwing, async-failing, and mutating listeners without interrupting parsing pipeline', () => {
            let listenerInvoked = false;
            setSchemaFallbackListener((ctx) => {
                listenerInvoked = true;
                (ctx as any).mutated = true;
                throw new Error('Hostile listener failure');
            });

            expect(() => {
                const parsed = DomainParsers.parseWorkoutSession('invalid_session_string');
                expect(parsed).toBeDefined();
                expect(Array.isArray(parsed.exercises)).toBe(true);
            }).not.toThrow();

            expect(listenerInvoked).toBe(true);
        });
    });
});
