import { describe, it, expect, beforeEach } from 'vitest';
import {
    UserDataSchema,
    UserProfileSchema,
    MacroTargetSchema,
    MacroRatioSchema,
    MacroBoostSchema,
    PartialMacroTargetSchema,

    ExerciseSetSchema,

    RoutineExerciseSchema,

    SessionExerciseDropsetSchema,
    SessionExerciseIsometricSchema,


    WorkoutSessionSchema,

    MealSchema,
    RoutineSchema,
    ExerciseLibraryItemSchema,
    SupplementSchema,
    SupplementIntakeSchema,
    NutritionDaySchema,
    FoodSchema,
    TrainingCycleRoutineItemSchema,
    TrainingCycleSchema,
    defaultUserDataFallback
} from '../src/lib/schema';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';

describe('Zod Schema Resilience & Defensive Catches', () => {
    describe('Completely Malformed Root Payloads', () => {
        it('handles null root payload gracefully', () => {
            expect(() => UserDataSchema.parse(null)).not.toThrow();
            const result = UserDataSchema.parse(null) as unknown as UserData;
            expect(result).toBeDefined();
            expect(result.library).toEqual([]);
            expect(result.routines).toEqual([]);
            expect(result.history).toEqual([]);
            expect(result.nutrition).toEqual({});
        });

        it('handles undefined root payload gracefully', () => {
            expect(() => UserDataSchema.parse(undefined)).not.toThrow();
            const result = UserDataSchema.parse(undefined) as unknown as UserData;
            expect(result).toBeDefined();
            expect(result.library).toEqual([]);
        });

        it('handles primitive string root payload gracefully', () => {
            expect(() => UserDataSchema.parse("invalid garbage")).not.toThrow();
            const result = UserDataSchema.parse("invalid garbage") as unknown as UserData;
            expect(result).toBeDefined();
            expect(result.routines).toEqual([]);
        });

        it('handles primitive number root payload gracefully', () => {
            expect(() => UserDataSchema.parse(12345)).not.toThrow();
            const result = UserDataSchema.parse(12345) as unknown as UserData;
            expect(result).toBeDefined();
            expect(result.history).toEqual([]);
        });

        it('handles boolean root payload gracefully', () => {
            expect(() => UserDataSchema.parse(true)).not.toThrow();
            const result = UserDataSchema.parse(true) as unknown as UserData;
            expect(result).toBeDefined();
            expect(result.customFoods).toEqual([]);
        });

        it('handles root array payload gracefully', () => {
            expect(() => UserDataSchema.parse([1, 2, 3])).not.toThrow();
            const result = UserDataSchema.parse([1, 2, 3]) as unknown as UserData;
            expect(result).toBeDefined();
            expect(result.trainingCycles).toEqual([]);
        });
    });

    describe('Partial & Nested Malformed Fields', () => {
        it('defensively sanitizes corrupted UserProfile and coerces numeric measurements to strings', () => {
            const corruptedProfile = {
                dob: 19900101, // number coerced to string
                height: 180, // number coerced to string
                gender: 'M',
                neck: 40,
                waist: 85,
                hip: 95,
                hips: 95,
                manualBf: 15.5,
                chest: 100,
                shoulders: 120,
                biceps: 38,
                thighs: 60,
                calves: 39,
                extraField: 'kept_by_passthrough'
            };
            expect(() => UserProfileSchema.parse(corruptedProfile)).not.toThrow();
            const res = UserProfileSchema.parse(corruptedProfile) as any;
            expect(res.dob).toBe('19900101');
            expect(res.height).toBe('180');
            expect(res.neck).toBe('40');
            expect(res.manualBf).toBe('15.5');
            expect(res.extraField).toBe('kept_by_passthrough');
        });

        it('defensively sanitizes corrupted ExerciseLibrary items', () => {
            const corruptedLibrary = [
                {
                    id: 123, // coerced to string
                    name: 'Bench Press',
                    setsCount: '5', // numeric string parsed to 5
                    muscles: ['chest', 123, null],
                    sets: [
                        { weight: 100, reps: 10, done: 'true' }, // done is string -> boolean true
                        'corrupted set'
                    ]
                },
                'totally corrupted exercise',
                null,
                undefined
            ];

            const parsed = UserDataSchema.parse({ library: corruptedLibrary }) as unknown as UserData;
            expect(parsed.library).toBeDefined();
            expect(Array.isArray(parsed.library)).toBe(true);
            expect(parsed.library!.length).toBe(4);
            // Exercise 0
            expect(parsed.library![0].id).toBe('123');
            expect(parsed.library![0].name).toBe('Bench Press');
            expect(parsed.library![0].setsCount).toBe(5);
            expect(parsed.library![0].muscles).toEqual(['chest', '123', '']);
            expect(Array.isArray(parsed.library![0].sets)).toBe(true);
            expect(parsed.library![0].sets[0].weight).toBe('100');
            expect(parsed.library![0].sets[0].done).toBe(true);
            expect(parsed.library![0].sets[1].weight).toBe('');
        });

        it('defensively sanitizes corrupted WorkoutRoutines', () => {
            const corruptedRoutines = [
                {
                    id: 'r1',
                    name: 'Leg Day',
                    exercises: [
                        { exId: 'ex1', setsCount: 4, minReps: '8', maxReps: '12', defaultTechnique: 'dropset' },
                        { exId: 'ex2', setsCount: 'invalid_words', minReps: 'invalid', defaultTechnique: 'unknown_technique' },
                        'invalid routine exercise'
                    ]
                },
                'corrupted routine'
            ];

            const parsed = UserDataSchema.parse({ routines: corruptedRoutines }) as unknown as UserData;
            expect(Array.isArray(parsed.routines)).toBe(true);
            expect(parsed.routines!.length).toBe(2);
            expect(parsed.routines![0].name).toBe('Leg Day');
            expect(parsed.routines![0].exercises[0].minReps).toBe(8);
            expect(parsed.routines![0].exercises[0].maxReps).toBe(12);
            expect(parsed.routines![0].exercises[0].defaultTechnique).toBe('dropset');
            expect(parsed.routines![0].exercises[1].setsCount).toBe(0);
            expect(parsed.routines![0].exercises[1].defaultTechnique).toBeUndefined();
        });

        it('defensively sanitizes corrupted WorkoutSession history with dropsets and isometrics', () => {
            const corruptedHistory = [
                {
                    id: 'session-1',
                    globalStartTime: '1690000000', // string timestamp coerced to number
                    globalEndTime: '1690003600',
                    moodRating: '4', // string rating coerced to 4
                    waterLiters: '2.5',
                    exercises: [
                        {
                            exId: 'ex-1',
                            sessionNote: null,
                            sets: [
                                {
                                    id: 's-1',
                                    kg: 80,
                                    reps: 8,
                                    time: '60',
                                    distance: 1000,
                                    done: 1,
                                    dropsets: [
                                        { id: 'ds-1', kg: 60, reps: 6 },
                                        'bad dropset'
                                    ],
                                    isometrics: [
                                        { id: 'iso-1', kg: 40, time: 10 },
                                        null
                                    ]
                                },
                                'bad set'
                            ]
                        }
                    ]
                }
            ];

            const parsed = UserDataSchema.parse({ history: corruptedHistory }) as unknown as UserData;
            expect(Array.isArray(parsed.history)).toBe(true);
            expect(parsed.history!.length).toBe(1);
            expect(parsed.history![0].globalStartTime).toBe(1690000000);
            expect(parsed.history![0].moodRating).toBe(4);
            expect(parsed.history![0].waterLiters).toBe(2.5);
            expect(parsed.history![0].exercises[0].sessionNote).toBe('');
            expect(parsed.history![0].exercises[0].sets.length).toBe(2);
            expect(parsed.history![0].exercises[0].sets[0].kg).toBe('80');
            expect(parsed.history![0].exercises[0].sets[0].distance).toBe('1000');
            expect(parsed.history![0].exercises[0].sets[0].done).toBe(true);
            expect(parsed.history![0].exercises[0].sets[0].dropsets?.length).toBe(2);
            expect(parsed.history![0].exercises[0].sets[0].dropsets?.[0].kg).toBe('60');
            expect(parsed.history![0].exercises[0].sets[0].isometrics?.length).toBe(2);
            expect(parsed.history![0].exercises[0].sets[0].isometrics?.[0].time).toBe('10');
        });

        it('defensively sanitizes corrupted Nutrition dictionary and preserves numeric values in strings', () => {
            const corruptedNutrition = {
                '2026-08-14': {
                    date: '2026-08-14',
                    kcal: '2500', // string parsed to 2500
                    carbs: '300',
                    pro: '150',
                    fat: '70',
                    weight: '78.5',
                    bf: 14.2,
                    isDayOn: 'true',
                    meals: [
                        { id: 'm1', name: 'Pasta', meal: 'pranzo', quantity: '150', kcal: '500', carbs: '100', pro: '15', fat: '5' },
                        'invalid meal'
                    ],
                    supplementsIntake: [
                        { id: 'sup1', supplementId: 'creatine', amount: '5', time: '123456' },
                        null
                    ]
                },
                '2026-08-15': 'corrupted day data',
                '2026-08-16': null
            };

            const parsed = UserDataSchema.parse({ nutrition: corruptedNutrition }) as unknown as UserData;
            expect(parsed.nutrition).toBeDefined();
            expect(parsed.nutrition!['2026-08-14'].kcal).toBe(2500);
            expect(parsed.nutrition!['2026-08-14'].carbs).toBe(300);
            expect(parsed.nutrition!['2026-08-14'].pro).toBe(150);
            expect(parsed.nutrition!['2026-08-14'].fat).toBe(70);
            expect(parsed.nutrition!['2026-08-14'].weight).toBe(78.5);
            expect(parsed.nutrition!['2026-08-14'].isDayOn).toBe(true);
            expect(parsed.nutrition!['2026-08-14'].meals?.length).toBe(2);
            expect(parsed.nutrition!['2026-08-14'].meals?.[0].kcal).toBe(500);
            expect(parsed.nutrition!['2026-08-14'].meals?.[0].quantity).toBe(150);
            expect(parsed.nutrition!['2026-08-14'].supplementsIntake?.length).toBe(2);
            expect(parsed.nutrition!['2026-08-14'].supplementsIntake?.[0].amount).toBe(5);
            expect(parsed.nutrition!['2026-08-15']).toBeDefined();
            expect(parsed.nutrition!['2026-08-16']).toBeDefined();
        });

        it('defensively sanitizes corrupted Food items and custom foods', () => {
            const corruptedFoods = [
                {
                    id: 'f1',
                    name: 'Chicken Breast',
                    kcal: '165',
                    pro: '31',
                    carbs: '0',
                    fat: '3.6',
                    servingWeight: '100',
                    satFat: '1.0',
                    fiber: null,
                    isCustom: 1
                },
                'corrupted food item',
                null
            ];

            const parsed = UserDataSchema.parse({ customFoods: corruptedFoods }) as unknown as UserData;
            expect(parsed.customFoods).toBeDefined();
            expect(parsed.customFoods!.length).toBe(3);
            expect(parsed.customFoods![0].name).toBe('Chicken Breast');
            expect(parsed.customFoods![0].kcal).toBe(165);
            expect(parsed.customFoods![0].pro).toBe(31);
            expect(parsed.customFoods![0].servingWeight).toBe(100);
            expect(parsed.customFoods![0].satFat).toBe(1.0);
            expect(parsed.customFoods![0].fiber).toBeNull();
            expect(parsed.customFoods![0].isCustom).toBe(true);
            expect(parsed.customFoods![1].name).toBe('');
            expect(parsed.customFoods![1].kcal).toBe(0);
        });

        it('defensively sanitizes corrupted TrainingCycles and activeCycleId', () => {
            const corruptedData = {
                trainingCycles: [
                    {
                        id: 'cycle-1',
                        name: 'Hypertrophy',
                        durationWeeks: '8', // numeric string parsed to 8
                        sessionsPerWeek: '4',
                        progressionMode: 'fixed',
                        routines: [
                            { routineId: 'r1', frequencyPerWeek: '2' },
                            { routineId: 'r2', frequencyPerWeek: 'invalid' },
                            null
                        ]
                    },
                    'corrupted cycle'
                ],
                activeCycleId: 12345 // invalid type, should fall back to null/string
            };

            const parsed = UserDataSchema.parse(corruptedData) as unknown as UserData;
            expect(Array.isArray(parsed.trainingCycles)).toBe(true);
            expect(parsed.trainingCycles!.length).toBe(2);
            expect(parsed.trainingCycles![0].durationWeeks).toBe(8);
            expect(parsed.trainingCycles![0].sessionsPerWeek).toBe(4);
            expect(parsed.trainingCycles![0].progressionMode).toBe('fixed');
            expect(parsed.trainingCycles![0].routines.length).toBe(3);
            expect(parsed.trainingCycles![0].routines[0].frequencyPerWeek).toBe(2);
            expect(parsed.trainingCycles![0].routines[1].frequencyPerWeek).toBe(1);
            expect(parsed.activeCycleId).toBe(null);
        });

        it('defensively sanitizes corrupted NutritionPlanning', () => {
            const corruptedPlanning = {
                weight: '82.5',
                onDaysCount: '4',
                avgMacros: { carbsPerKg: '3.5', proPerKg: '2.0', fatPerKg: '1.0' },
                onBoost: { carbsPercent: '20', proPercent: '0', fatPercent: '-10' },
                normocalorica: { kcal: '2600', carbs: '320', pro: '165', fat: '75' }
            };

            const parsed = UserDataSchema.parse({ nutritionPlanning: corruptedPlanning }) as unknown as UserData;
            expect(parsed.nutritionPlanning).toBeDefined();
            expect(parsed.nutritionPlanning?.weight).toBe(82.5);
            expect(parsed.nutritionPlanning?.onDaysCount).toBe(4);
            expect(parsed.nutritionPlanning?.avgMacros?.carbsPerKg).toBe(3.5);
            expect(parsed.nutritionPlanning?.onBoost?.carbsPercent).toBe(20);
            expect(parsed.nutritionPlanning?.normocalorica?.kcal).toBe(2600);
        });
    });

    describe('Runtime Gateway in useAppStore & LocalStorage', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        it('loads valid user data correctly from localStorage', () => {
            const validData: UserData = {
                profile: { dob: '1990-01-01', height: '180' },
                library: [{ id: 'ex1', name: 'Squat', setsCount: 3, sets: [] }],
                routines: [{ id: 'r1', name: 'Legs', exercises: [] }],
                history: [],
                nutrition: {},
                customFoods: [],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                supplements: []
            };

            localStorage.setItem('logbook_cached_user_data', JSON.stringify(validData));
            
            // Trigger state reset to re-read initial data
            useAppStore.setState({ userData: null });
            const parsed = UserDataSchema.parse(validData) as unknown as UserData;
            expect(parsed.profile?.height).toBe('180');
            expect(parsed.library?.[0].name).toBe('Squat');
        });

        it('gracefully recovers from severely corrupted localStorage JSON payload', () => {
            const corruptedPayload = {
                profile: 'not an object',
                library: 'broken',
                routines: 9999,
                history: null,
                nutrition: 'bad',
                trainingCycles: 'none'
            };

            localStorage.setItem('logbook_cached_user_data', JSON.stringify(corruptedPayload));
            const cached = localStorage.getItem('logbook_cached_user_data');
            const parsed = JSON.parse(cached!);
            const sanitized = UserDataSchema.parse(parsed) as unknown as UserData;

            expect(sanitized).toBeDefined();
            expect(sanitized.library).toEqual([]);
            expect(sanitized.routines).toEqual([]);
            expect(sanitized.history).toEqual([]);
            expect(sanitized.nutrition).toEqual({});
            expect(sanitized.trainingCycles).toEqual([]);
        });

        it('gracefully handles non-JSON corrupted string in localStorage without crashing', () => {
            localStorage.setItem('logbook_cached_user_data', '<<<NOT JSON>>>');
            expect(() => {
                try {
                    const cached = localStorage.getItem('logbook_cached_user_data');
                    if (!cached) return null;
                    const parsed = JSON.parse(cached);
                    if (!parsed || typeof parsed !== 'object') return null;
                    return UserDataSchema.parse(parsed);
                } catch {
                    return null;
                }
            }).not.toThrow();
        });
    });

    describe('Runtime Gateway in DB.loadUserData', () => {
        it('DB.loadUserData sanitizes corrupted firestore snapshots into safe UserData', async () => {
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
        });

        it('validates ExerciseSetSchema, RoutineExerciseSchema, SessionExerciseDropsetSchema, SessionExerciseIsometricSchema', () => {
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
            expect(SessionExerciseDropsetSchema.parse({ id: 'ds1', kg: 50, reps: 8 })).toEqual({
                id: 'ds1',
                kg: '50',
                reps: '8'
            });
            expect(SessionExerciseIsometricSchema.parse({ id: 'iso1', kg: 30, time: 15 })).toEqual({
                id: 'iso1',
                kg: '30',
                time: '15'
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

        it('recovers localWorkout from completely corrupted localStorage entries via WorkoutSessionSchema', () => {
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

