import { describe, it, expect, vi } from 'vitest';
import {
    UserDataSchema, UserProfileSchema, NutritionPlanningSchema,
    WorkoutSessionSchema, NutritionDaySchema,
} from '../../src/lib/schema';
import type { UserData } from '../../src/types';

vi.unmock('../../src/lib/db');

describe('Zod Schema Resilience & Defensive Catches', () => {
    describe('Completely Malformed Root Payloads', () => {
        it.each([
            { label: 'null', payload: null, expected: {
                library: [], routines: [], history: [], nutrition: {},
            } },
            { label: 'undefined', payload: undefined, expected: { library: [] } },
            { label: 'primitive string', payload: 'invalid garbage', expected: { routines: [] } },
            { label: 'primitive number', payload: 12345, expected: { history: [] } },
            { label: 'boolean', payload: true, expected: { customFoods: [] } },
            { label: 'array', payload: [1, 2, 3], expected: { trainingCycles: [] } },
        ])('handles $label root payload gracefully', ({ payload, expected }) => {
            const parsed = UserDataSchema.parse(payload) as unknown as UserData;
            expect(parsed).toMatchObject(expected);
        });
    });

    describe('Partial & Nested Malformed Fields', () => {
        it('retires only unsupported planning fields across active plans and pending conflicts', () => {
            const raw = {
                weight: 80,
                onDaysCount: 4,
                avgMacros: { carbsPerKg: 3, proPerKg: 2, fatPerKg: 1 },
                lockedMacro: 'carbs',
                chartPeriod: 30,
                carbsPerKg: 9,
                proPerKg: 8,
                fatPerKg: 7,
                futureSetting: 'retain',
            };
            const parsed = NutritionPlanningSchema.parse(raw);
            expect(parsed).not.toHaveProperty('lockedMacro');
            expect(parsed).not.toHaveProperty('chartPeriod');
            for (const field of ['carbsPerKg', 'proPerKg', 'fatPerKg']) {
                expect(parsed).not.toHaveProperty(field);
            }
            expect(parsed.weight).toBe(80);
            expect(parsed.avgMacros?.carbsPerKg).toBe(3);
            expect((parsed as Record<string, unknown>).futureSetting).toBe('retain');

            const userData = UserDataSchema.parse({
                nutritionPlanning: raw,
                pendingConflicts: { nutritionPlanning: raw },
            });
            expect(userData.nutritionPlanning).not.toHaveProperty('lockedMacro');
            expect(userData.nutritionPlanning).not.toHaveProperty('chartPeriod');
            for (const field of ['carbsPerKg', 'proPerKg', 'fatPerKg']) {
                expect(userData.nutritionPlanning).not.toHaveProperty(field);
                expect(userData.pendingConflicts?.nutritionPlanning).not.toHaveProperty(field);
            }
            expect(userData.pendingConflicts?.nutritionPlanning).not.toHaveProperty('lockedMacro');
            expect(userData.pendingConflicts?.nutritionPlanning).not.toHaveProperty('chartPeriod');
            expect(userData.pendingConflicts?.nutritionPlanning?.avgMacros?.proPerKg).toBe(2);
        });

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
            expect(res).not.toHaveProperty('manualBf');
            expect(res.extraField).toBe('kept_by_passthrough');
            expect(res.hip).toBe('95');
            expect(res).not.toHaveProperty('hips');
        });

        it('does not adopt or persist the unsupported pre-launch hips alias', () => {
            const profile = UserProfileSchema.parse({ hips: '94', height: '180', extraField: 'retained' });
            expect(UserProfileSchema.parse({ hip: '' }).hip).toBeUndefined();
            expect(profile.hip).toBeUndefined();
            expect(profile).not.toHaveProperty('hips');
            expect(profile.extraField).toBe('retained');

            const baseDay = { date: '2026-10-04', kcal: 0, carbs: 0, pro: 0, fat: 0 };
            const oldDay = NutritionDaySchema.parse({ ...baseDay, hips: 93, notes: 'retained' });
            expect(oldDay.hip).toBeUndefined();
            expect(oldDay).not.toHaveProperty('hips');
            expect(oldDay.notes).toBe('retained');

            const currentDay = NutritionDaySchema.parse({ ...baseDay, hip: 96, hips: 93 });
            expect(currentDay.hip).toBe(96);
            expect(currentDay).not.toHaveProperty('hips');
        });

        it('bounds modeled profile strings while preserving intentional passthrough fields', () => {
            const oversized = 'x'.repeat(129);
            const res = UserProfileSchema.parse({
                height: oversized,
                waist: 85,
                extraField: oversized,
            }) as any;

            expect(res.height).toBeUndefined();
            expect(res.waist).toBe('85');
            expect(res.extraField).toBe(oversized);
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
            expect(parsed.library!.length).toBe(1);
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
            expect(parsed.routines!.length).toBe(1);
            expect(parsed.routines![0].name).toBe('Leg Day');
            expect(parsed.routines![0].exercises[0].minReps).toBe(8);
            expect(parsed.routines![0].exercises[0].maxReps).toBe(12);
            expect(parsed.routines![0].exercises[0].defaultTechnique).toBe('dropset');
            expect(parsed.routines![0].exercises[1].setsCount).toBe(0);
            expect(parsed.routines![0].exercises[1].defaultTechnique).toBeUndefined();
        });

        it('defensively sanitizes corrupted WorkoutSession history with continuation segments', () => {
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
                                    segments: [
                                        { technique: 'dropset' as const, id: 'ds-1', kg: 60, reps: 6 },
                                        'bad dropset',
                                        { technique: 'isometry' as const, reps: '', id: 'iso-1', kg: 40, time: 10 },
                                        null
                                    ],
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
            expect(parsed.history![0].exercises[0].sets[0].segments?.filter(segment => segment.technique === 'dropset')?.length).toBe(1);
            expect(parsed.history![0].exercises[0].sets[0].segments?.filter(segment => segment.technique === 'dropset')?.[0].kg).toBe('60');
            expect(parsed.history![0].exercises[0].sets[0].segments?.filter(segment => segment.technique === 'isometry')?.length).toBe(1);
            expect(parsed.history![0].exercises[0].sets[0].segments?.filter(segment => segment.technique === 'isometry')?.[0].time).toBe('10');
        });

        it('keeps only valid workout continuation IDs, rejecting the reserved ordering segment', () => {
            const parsed = WorkoutSessionSchema.parse({
                id: 'workout-1',
                exercises: [{
                    id: 'ex-1', exId: 'exercise', sessionNote: '',
                    sets: [{
                        id: 'set-1', kg: '10', reps: '8',
                        segments: [
                            { id: 'segment-1', kg: '8', reps: '6' },
                            { id: '$order', kg: '6', reps: '6' },
                        ],
                    }],
                }],
            });
            expect(parsed.exercises[0].sets[0].segments?.map(segment => segment.id))
                .toEqual(['segment-1']);
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
            expect(parsed.nutrition!['2026-08-14'].meals?.length).toBe(1);
            expect(parsed.nutrition!['2026-08-14'].meals?.[0].kcal).toBe(500);
            expect(parsed.nutrition!['2026-08-14'].meals?.[0].quantity).toBe(150);
            expect(parsed.nutrition!['2026-08-14'].supplementsIntake?.length).toBe(1);
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
            expect(parsed.customFoods!.length).toBe(1);
            expect(parsed.customFoods![0].name).toBe('Chicken Breast');
            expect(parsed.customFoods![0].kcal).toBe(165);
            expect(parsed.customFoods![0].pro).toBe(31);
            expect(parsed.customFoods![0].servingWeight).toBe(100);
            expect(parsed.customFoods![0].satFat).toBe(1.0);
            expect(parsed.customFoods![0].fiber).toBeNull();
            expect(parsed.customFoods![0].isCustom).toBe(true);
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
            expect(parsed.trainingCycles!.length).toBe(1);
            expect(parsed.trainingCycles![0].durationWeeks).toBe(8);
            expect(parsed.trainingCycles![0].sessionsPerWeek).toBe(4);
            expect(parsed.trainingCycles![0].progressionMode).toBe('fixed');
            expect(parsed.trainingCycles![0].routines.length).toBe(2);
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
});
