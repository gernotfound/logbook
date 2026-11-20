import { describe, it, expect, vi } from 'vitest';
import { firestoreMockStore } from '../setup';
import { getDocFromServer } from 'firebase/firestore';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { readDeviceValueStrict, writeDeviceValue } from '../../src/lib/sync/deviceStorage';
import { DeviceWorkoutCorruptError, getInitialLocalWorkout } from '../../src/store/slices/createWorkoutSlice';
import { sealTestCloudFixture, testCloudKey } from '../testUtils';
import {
    UserDataSchema, MacroTargetSchema, MacroRatioSchema, MacroBoostSchema,
    PartialMacroTargetSchema, ExerciseSetSchema, RoutineExerciseSchema,
    WorkoutSessionSchema, MealSchema, RoutineSchema, ExerciseLibraryItemSchema,
    SupplementSchema, SupplementIntakeSchema, NutritionDaySchema, FoodSchema,
    TrainingCycleRoutineItemSchema, TrainingCycleSchema, defaultUserDataFallback,
} from '../../src/lib/schema';
import type { UserData } from '../../src/types';

vi.unmock('../../src/lib/db');
import { DB } from '../../src/lib/db';

describe('Zod Schema Resilience & Defensive Catches', () => {
    describe('Runtime Gateway in DB.loadCloudPayload', () => {
        it('UserDataSchema normalizes non-authoritative malformed objects', () => {
            const mockFirestoreData = {
                profile: { height: 175 },
                library: [{ id: 'ex1', name: 'Deadlift', setsCount: 5, sets: [] }],
                routines: 'corrupted string',
                customFoods: 'bad array',
                activeWorkout: undefined,
                trainingCycles: null
            };

            const parsed = UserDataSchema.parse(mockFirestoreData) as unknown as UserData;
            expect(parsed.library?.[0].name).toBe('Deadlift');
            expect(parsed.routines).toEqual([]);
            expect(parsed.customFoods).toEqual([]);
            expect(parsed.trainingCycles).toEqual([]);
            expect(parsed.activeWorkout).toBeNull();
        });

        it('rejects lossy Firestore root data during real DB.loadCloudPayload', async () => {
            const rootPath = 'users/test-user-id';
            const original = firestoreMockStore[rootPath];
            const cloudRoot = {
                _schemaVersion: 1,
                _sync: {
                    protocolVersion: 3, clock: {}, fields: {},
                    writer: { slot: 's00', replicaId: 'replica-test', generation: 1, seq: 0 },
                },
                profile: { height: 175 },
                routines: 'corrupted string',
            };
            const encryptedRoot = sealTestCloudFixture(cloudRoot);
            firestoreMockStore[rootPath] = encryptedRoot;
            try {
                await expect(DB.loadCloudPayload({ cloudKey: testCloudKey() })).rejects.toThrow(/dati cloud non validi/i);
                expect(vi.mocked(getDocFromServer).mock.calls.some(([ref]) =>
                    (ref as { path?: string }).path === rootPath
                )).toBe(true);
                expect(firestoreMockStore[rootPath]).toBe(encryptedRoot);
            } finally {
                if (original === undefined) delete firestoreMockStore[rootPath];
                else firestoreMockStore[rootPath] = original;
            }
        });
    });

    describe('Individual Schema Export Checks', () => {
        it('validates MacroTargetSchema, MacroRatioSchema, MacroBoostSchema, PartialMacroTargetSchema', () => {
            expect(MacroTargetSchema.parse({ kcal: '2000', carbs: '250', pro: '150', fat: '60' })).toEqual({
                kcal: 2000,
                carbs: 250,
                pro: 150,
                fat: 60
            });
            expect(MacroRatioSchema.parse({ carbsPerKg: '3.0', proPerKg: '2.0', fatPerKg: '1.0' })).toEqual({
                carbsPerKg: 3.0,
                proPerKg: 2.0,
                fatPerKg: 1.0
            });
            expect(MacroBoostSchema.parse({ carbsPercent: '15', proPercent: '0', fatPercent: '-15' })).toEqual({
                carbsPercent: 15,
                proPercent: 0,
                fatPercent: -15
            });
            expect(PartialMacroTargetSchema.parse({ kcal: '2200' })).toEqual({
                kcal: 2200
            });

            expect(MacroTargetSchema.parse({ kcal: -1, carbs: -2, pro: -3, fat: -4 })).toEqual({
                kcal: 0,
                carbs: 0,
                pro: 0,
                fat: 0
            });
            expect(MacroRatioSchema.parse({ carbsPerKg: -1, proPerKg: -2, fatPerKg: -3 })).toEqual({
                carbsPerKg: 0,
                proPerKg: 0,
                fatPerKg: 0
            });
            expect(MacroBoostSchema.parse({ carbsPercent: -101, proPercent: -100, fatPercent: 25 })).toEqual({
                carbsPercent: 0,
                proPercent: -100,
                fatPercent: 25
            });
        });

        it('validates ExerciseSetSchema, RoutineExerciseSchema', () => {
            expect(ExerciseSetSchema.parse({ weight: 80, reps: 10, done: 1 })).toEqual({
                weight: '80',
                reps: '10',
                done: true
            });
            expect(RoutineExerciseSchema.parse({ exId: 'ex1', setsCount: '4', minReps: '8', maxReps: '12' })).toEqual({
                exId: 'ex1',
                setsCount: 4,
                minReps: 8,
                maxReps: 12
            });

        });

        it('validates MealSchema, RoutineSchema, ExerciseLibraryItemSchema alias exports', () => {
            expect(MealSchema.parse({ id: 'm1', name: 'Uova', meal: 'colazione', quantity: 2, kcal: 180, carbs: 1, pro: 14, fat: 12 })).toBeDefined();
            expect(RoutineSchema.parse({ id: 'r1', name: 'Upper', exercises: [] })).toBeDefined();
            expect(ExerciseLibraryItemSchema.parse({ id: 'ex1', name: 'Trazioni', setsCount: 4, sets: [] })).toBeDefined();
        });

        it('validates SupplementSchema, SupplementIntakeSchema, TrainingCycleRoutineItemSchema', () => {
            expect(SupplementSchema.parse({ id: 'sup1', name: 'Omega 3', unit: 'capsule', target: '2', portion: '1' })).toEqual({
                id: 'sup1',
                name: 'Omega 3',
                unit: 'capsule',
                target: 2,
                portion: 1
            });
            expect(SupplementIntakeSchema.parse({ id: 'i1', supplementId: 'sup1', amount: '2', time: '1000' })).toEqual({
                id: 'i1',
                supplementId: 'sup1',
                amount: 2,
                time: 1000
            });
            expect(TrainingCycleRoutineItemSchema.parse({ routineId: 'r1', frequencyPerWeek: '3' })).toEqual({
                routineId: 'r1',
                frequencyPerWeek: 3
            });
        });

        it('validates defaultUserDataFallback integrity', () => {
            expect(defaultUserDataFallback).toBeDefined();
            expect(defaultUserDataFallback.profile).toEqual({});
            expect(defaultUserDataFallback.library).toEqual([]);
            expect(defaultUserDataFallback.routines).toEqual([]);
            expect(defaultUserDataFallback.history).toEqual([]);
            expect(defaultUserDataFallback.nutrition).toEqual({});
            expect(defaultUserDataFallback.customFoods).toEqual([]);
            expect(defaultUserDataFallback.activeWorkout).toBeNull();
            expect(defaultUserDataFallback.trainingCycles).toEqual([]);
            expect(defaultUserDataFallback.activeCycleId).toBeNull();
            expect(defaultUserDataFallback.supplements).toEqual([]);
        });

        it('handles null, empty string, and numeric measurement values in NutritionDaySchema correctly', () => {
            const parsedNull = NutritionDaySchema.parse({
                date: '2026-08-14',
                kcal: '2200',
                carbs: '250',
                pro: '150',
                fat: '60',
                weight: null,
                bf: null,
                neck: ''
            });
            expect(parsedNull.weight).toBeUndefined();
            expect(parsedNull.bf).toBeUndefined();
            expect(parsedNull.neck).toBeUndefined();

            const parsedValid = NutritionDaySchema.parse({
                date: '2026-08-14',
                kcal: 2200,
                carbs: 250,
                pro: 150,
                fat: 60,
                weight: 79.5,
                bf: '14.5',
                neck: '39.5'
            });
            expect(parsedValid.weight).toBe(79.5);
            expect(parsedValid.bf).toBe(14.5);
            expect(parsedValid.neck).toBe(39.5);
        });

        it('normalizes malformed optional workout fields in the standalone schema', () => {
            const corruptedLocalWorkout = {
                id: 'w-corrupted',
                exercises: 'not an array',
                moodRating: 'invalid_rating',
                pumpRating: '3'
            };

            const sanitized = WorkoutSessionSchema.parse(corruptedLocalWorkout);
            expect(sanitized.id).toBe('w-corrupted');
            expect(sanitized.exercises).toEqual([]);
            expect(sanitized.moodRating).toBeNull();
            expect(sanitized.pumpRating).toBe(3);
        });

        it('fails closed on malformed encrypted device workout and preserves original bytes', async () => {
            const owner = 'user:test-user-id';
            await prepareUnlockedTestArchive(owner);
            const original = '{invalid-workout-json';
            writeDeviceValue('workout', original, owner);
            expect(() => getInitialLocalWorkout(owner)).toThrow(DeviceWorkoutCorruptError);
            expect(readDeviceValueStrict('workout', owner)).toBe(original);
        });

        it('verifies deep passthrough preservation across schemas', () => {
            const foodWithExtras = {
                name: 'Whey Protein',
                kcal: 120,
                pro: 24,
                carbs: 2,
                fat: 1.5,
                extraNutritionNote: 'Preserved by passthrough',
                customBarcode: '123456789'
            };
            const parsedFood = FoodSchema.parse(foodWithExtras) as any;
            expect(parsedFood.extraNutritionNote).toBe('Preserved by passthrough');
            expect(parsedFood.customBarcode).toBe('123456789');

            const cycleWithExtras = {
                id: 'c1',
                name: 'Strength Block',
                durationWeeks: 6,
                routines: [],
                coachNote: 'Focus on bench press progression'
            };
            const parsedCycle = TrainingCycleSchema.parse(cycleWithExtras) as any;
            expect(parsedCycle.coachNote).toBe('Focus on bench press progression');
        });
    });
});
