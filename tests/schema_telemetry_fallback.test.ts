import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import * as firebaseLib from '../src/lib/firebase';
import {
    DomainParsers,
    UserDataSchema,









    setSchemaFallbackListener,

    type ZodFallbackContext
} from '../src/lib/schema';
import { telemetryHub, type TelemetryErrorPayload, type TelemetryEventPayload } from '../src/lib/telemetryHub';

describe('Zod Schema Fallback & Telemetry Integration (Milestone 3 R1)', () => {
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
        vi.spyOn(firebaseLib, 'ensureAppCheck').mockResolvedValue(undefined);
        vi.spyOn(firebaseLib, 'getDb').mockReturnValue({} as any);

        setSchemaFallbackListener(null);
        telemetryHub.reset();
        telemetryHub.init();
        telemetryHub.setUserId('test_zod_user');
    });

    afterEach(() => {
        setSchemaFallbackListener(null);
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
        vi.useRealTimers();
        telemetryHub.reset();
    });

    describe('1. ErrorSource and Schema Fallback Reporting', () => {
        it('supports zod_schema_fallback source in telemetryHub.trackError', async () => {
            vi.useFakeTimers();
            const syntheticError = new Error('Zod fallback in UserProfileSchema [height]: invalid_type');
            syntheticError.name = 'ZodSchemaFallbackError';

            telemetryHub.trackError(syntheticError, {
                source: 'zod_schema_fallback',
                customMessage: 'Zod fallback in UserProfileSchema [height]: invalid_type',
            });

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
            expect(payload.source).toBe('zod_schema_fallback');
            expect(payload.type).toBe('ZodSchemaFallbackError');
            expect(payload.message).toContain('Zod fallback in UserProfileSchema');
        });

        it('dispatches zod_schema_fallback event with structural metadata', async () => {
            vi.useFakeTimers();
            telemetryHub.trackEvent('zod_schema_fallback', {
                schema: 'ExerciseSchema',
                field: 'setsCount',
                issueCode: 'invalid_type',
                expectedType: 'number',
                receivedType: 'string',
                fallbackUsed: 'default_empty_exercise',
            });

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
            expect(payload.type).toBe('zod_schema_fallback');
            expect(payload.details?.schema).toBe('ExerciseSchema');
            expect(payload.details?.field).toBe('setsCount');
            expect(payload.details?.issueCode).toBe('invalid_type');
            expect(payload.details?.expectedType).toBe('number');
            expect(payload.details?.receivedType).toBe('string');
            expect(payload.details?.fallbackUsed).toBe('default_empty_exercise');
        });
    });

    describe('2. DomainParsers Telemetry Triggering & Fallbacks', () => {
        it('notifies telemetry when parseProfile encounters corrupt non-object data', async () => {
            vi.useFakeTimers();
            const corruptProfile = 'completely_invalid_profile_string';

            const parsed = DomainParsers.parseProfile(corruptProfile);
            expect(parsed).toBeDefined();
            expect(typeof parsed).toBe('object');

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('UserProfileSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_profile');
        });

        it('notifies telemetry when parseWorkoutSession encounters corrupt non-object data', async () => {
            vi.useFakeTimers();
            const corruptSession = 'not_an_object_session';

            const parsed = DomainParsers.parseWorkoutSession(corruptSession);
            expect(parsed).toBeDefined();
            expect(parsed.exercises).toEqual([]);

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('WorkoutSessionSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_session');
        });

        it('notifies telemetry and returns fallback object when parseNutritionPlanning receives invalid non-object', async () => {
            vi.useFakeTimers();
            const corruptPlanning = 'not_an_object_planning';

            const parsed = DomainParsers.parseNutritionPlanning(corruptPlanning);
            expect(parsed).toEqual({});

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('NutritionPlanningSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_planning');
        });

        it('returns null cleanly for null or undefined in parseNutritionPlanning', () => {
            expect(DomainParsers.parseNutritionPlanning(null)).toBeNull();
            expect(DomainParsers.parseNutritionPlanning(undefined)).toBeNull();
        });

        it('sanitizes corrupt history items and notifies telemetry per corrupted item', async () => {
            vi.useFakeTimers();
            const historyData = [
                { id: 'sess_valid', date: '2026-08-25', exercises: [] },
                'corrupted_history_string',
            ];

            const parsed = DomainParsers.parseHistory(historyData);
            expect(parsed).toHaveLength(2);
            expect(parsed[0].id).toBe('sess_valid');
            expect(parsed[1].exercises).toEqual([]);

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('WorkoutSessionSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_session');
        });

        it('handles non-array history input safely and notifies telemetry', async () => {
            vi.useFakeTimers();
            const parsed = DomainParsers.parseHistory('not_an_array');
            expect(parsed).toEqual([]);

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('WorkoutSessionSchema');
            expect(eventCall[1].details.field).toBe('history');
            expect(eventCall[1].details.expectedType).toBe('array');
        });

        it('sanitizes corrupt library items and notifies telemetry', async () => {
            vi.useFakeTimers();
            const libraryData = [
                { id: 'ex_valid', name: 'Valid Exercise', setsCount: 3 },
                'corrupted_exercise_string',
            ];

            const parsed = DomainParsers.parseLibrary(libraryData);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].id).toBe('ex_valid');

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('ExerciseSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_exercise');
        });

        it('sanitizes corrupt customFoods and notifies telemetry', async () => {
            vi.useFakeTimers();
            const foodsData = [
                { id: 'avena123', name: 'Avena', kcal: 370, pro: 13, carbs: 68, fat: 7 },
                'corrupted_food_string',
            ];

            const parsed = DomainParsers.parseCustomFoods(foodsData);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].name).toBe('Avena');

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('FoodSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_food');
        });

        it('sanitizes corrupt routines and notifies telemetry', async () => {
            vi.useFakeTimers();
            const routinesData = [
                { id: 'r1', name: 'Upper A', exercises: [] },
                'corrupted_routine_string',
            ];

            const parsed = DomainParsers.parseRoutines(routinesData);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].id).toBe('r1');

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('WorkoutRoutineSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_routine');
        });

        it('sanitizes corrupt trainingCycles and notifies telemetry', async () => {
            vi.useFakeTimers();
            const cyclesData = [
                { id: 'c1', name: 'Hypertrophy 1', durationWeeks: 6, routines: [] },
                'corrupted_cycle_string',
            ];

            const parsed = DomainParsers.parseTrainingCycles(cyclesData);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].id).toBe('c1');

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('TrainingCycleSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_cycle');
        });

        it('sanitizes corrupt supplements and notifies telemetry', async () => {
            vi.useFakeTimers();
            const suppsData = [
                { id: 's1', name: 'Creatina', unit: 'g' },
                'corrupted_supplement_string',
            ];

            const parsed = DomainParsers.parseSupplements(suppsData);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].name).toBe('Creatina');

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('SupplementSchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_supplement');
        });

        it('filters invalid activePains entries and notifies telemetry', async () => {
            vi.useFakeTimers();
            const painsData = ['Spalla dx', 12345, null, '', { pain: 'Ginocchio' }];

            const parsed = DomainParsers.parseActivePains(painsData);
            expect(parsed).toEqual(['Spalla dx']);

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('UserDataSchema');
            expect(eventCall[1].details.field).toBe('activePains[]');
        });

        it('sanitizes corrupt nutrition days and notifies telemetry', async () => {
            vi.useFakeTimers();
            const nutritionData = {
                '2026-08-25': { date: '2026-08-25', kcal: 2500, pro: 160, carbs: 300, fat: 70, meals: [], supplementsIntake: [] },
                '2026-08-26': 'invalid_day_string',
            };

            const parsed = DomainParsers.parseNutrition(nutritionData);
            expect(parsed['2026-08-25']).toBeDefined();
            expect(parsed['2026-08-26']).toBeDefined();
            expect(parsed['2026-08-26'].meals).toEqual([]);

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            const calls = mockSetDoc.mock.calls;
            const eventCall = calls.find((c: any) => c[1].type === 'zod_schema_fallback');
            expect(eventCall).toBeDefined();
            expect(eventCall[1].details.schema).toBe('NutritionDaySchema');
            expect(eventCall[1].details.fallbackUsed).toBe('default_empty_day');
        });
    });

    describe('3. Strict Privacy & Zero-PII Leakage Verification', () => {
        it('never leaks user emails, secret notes, tokens or sensitive values in telemetry', async () => {
            vi.useFakeTimers();
            const sensitiveCorruptedPayload = 'corrupt_string_with_secret_email_user@gym.it_and_jwt_eyJhbGciOiJIUzI1NiJ9';

            DomainParsers.parseWorkoutSession(sensitiveCorruptedPayload);

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            for (const call of mockSetDoc.mock.calls) {
                const payloadStr = JSON.stringify(call[1]);
                expect(payloadStr).not.toContain('user@gym.it');
                expect(payloadStr).not.toContain('eyJhbGciOiJIUzI1NiJ9');
                expect(payloadStr).not.toContain('corrupt_string_with_secret');
            }
        });

        it('UserDataSchema root fallback reports telemetry without leaking input data', async () => {
            vi.useFakeTimers();
            const maliciousData = 'completely_invalid_root_string_with_secret_phone_+393331234567';

            const parsed = UserDataSchema.parse(maliciousData);
            expect(parsed).toBeDefined();
            expect(parsed.library).toEqual([]);

            await vi.advanceTimersByTimeAsync(50);

            expect(mockSetDoc).toHaveBeenCalled();
            for (const call of mockSetDoc.mock.calls) {
                const payloadStr = JSON.stringify(call[1]);
                expect(payloadStr).not.toContain('+393331234567');
                expect(payloadStr).not.toContain('completely_invalid_root_string');
            }
        });
    });

    describe('4. Pluggable Listener Support (setSchemaFallbackListener)', () => {
        it('invokes custom fallback listener when configured', () => {
            const receivedEvents: ZodFallbackContext[] = [];
            setSchemaFallbackListener((ctx) => {
                receivedEvents.push(ctx);
            });

            DomainParsers.parseProfile('invalid_profile_string');

            expect(receivedEvents).toHaveLength(1);
            expect(receivedEvents[0].schema).toBe('UserProfileSchema');
            expect(receivedEvents[0].fallbackUsed).toBe('default_empty_profile');
        });

        it('catches and suppresses any exceptions in custom fallback listener without crashing parsing', () => {
            setSchemaFallbackListener(() => {
                throw new Error('Custom listener crash');
            });

            expect(() => {
                const parsed = DomainParsers.parseProfile('invalid_profile_string');
                expect(parsed).toBeDefined();
            }).not.toThrow();
        });
    });
});
