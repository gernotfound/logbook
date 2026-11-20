import { describe, it, expect } from 'vitest';
import { removeUndefinedValuesForFirestore } from '../../../src/lib/utils/object';
import { projectDocuments } from '../../../src/lib/sync/documentProjection';
import { getSeedCatalog } from '../../../src/lib/catalog/catalogService';
import { assertNoUndefined } from './firestoreSanitizationOracle';

describe('Empirical Challenger: removeUndefinedValuesForFirestore & Firestore Serialization Adversarial Stress Suite', () => {

    describe('8. Full UserData & Firestore Payloads Serialization Invariants', () => {
        it('sanitizes manually assembled root and monthly document fixtures without undefined values', () => {
            // Construct a complete realistic UserData payload with pervasive undefined values in every collection
            // Deliberately legacy/malformed Firestore payload: this exercises undefined cleanup,
            // not the validated application UserData contract.
            const mockFullState = {
                profile: {
                    displayName: 'Challenger Athlete',
                    gender: 'male',
                    weight: 82.5,
                    height: 183,
                    bodyFat: undefined as any,
                    activityLevel: 'heavy',
                    avatar: undefined as any,
                    tdee: 2800,
                    calorieSurplus: undefined as any
                },
                library: [
                    {
                        id: 'ex_1',
                        name: 'Squat',
                        muscle: 'quads',
                        secondaryMuscles: ['glutes', 'hamstrings'],
                        equipment: 'barbell',
                        notes: undefined as any,
                        trackingType: 'weight_reps',
                        custom: false
                    },
                    {
                        id: 'ex_2',
                        name: 'Corsa',
                        muscle: 'cardio',
                        secondaryMuscles: [],
                        equipment: 'treadmill',
                        notes: 'Riscaldamento',
                        trackingType: 'cardio',
                        custom: true
                    }
                ],
                routines: [
                    {
                        id: 'rt_1',
                        name: 'Legs A',
                        exercises: [
                            {
                                exerciseId: 'ex_1',
                                sets: 4,
                                targetReps: 6,
                                rpe: undefined as any,
                                restTime: 180,
                                notes: undefined as any
                            }
                        ],
                        notes: undefined as any
                    }
                ],
                customFoods: [
                    {
                        id: 'cf_1',
                        name: 'Proteine Whey',
                        calories: 380,
                        protein: 80,
                        carbs: 5,
                        fat: 3,
                        unit: 'g',
                        barcode: undefined as any,
                        brand: undefined as any
                    }
                ],
                activeWorkout: {
                    id: 'sess_1',
                    name: 'Legs A',
                    date: '2026-08-17',
                    globalStartTime: 1786960000000,
                    globalEndTime: undefined as any,
                    exercises: [
                        {
                            exerciseId: 'ex_1',
                            sets: [
                                { setNumber: 1, weight: 140, reps: 6, completed: true, rpe: undefined as any, dropset: undefined as any },
                                { setNumber: 2, weight: 140, reps: 5, completed: true, rpe: 9, dropset: undefined as any }
                            ],
                            notes: undefined as any
                        }
                    ],
                    notes: undefined as any
                },
                trainingCycles: [
                    {
                        id: 'cyc_1',
                        name: 'Ipertrofia Blocco 1',
                        routineIds: ['rt_1'],
                        completedSessions: 3,
                        notes: undefined as any,
                        startDate: '2026-08-01',
                        endDate: undefined as any
                    }
                ],
                activeCycleId: 'cyc_1',
                nutritionPlanning: {
                    targetCalories: 3000,
                    proteinGrams: 180,
                    carbGrams: 370,
                    fatGrams: 75,
                    formula: 'mifflin',
                    notes: undefined as any
                },
                supplements: [
                    {
                        id: 'sup_1',
                        name: 'Creatina Monoidrato',
                        timing: 'mattina',
                        dosage: '5g',
                        notes: undefined as any
                    }
                ],
                history: [
                    {
                        id: 'hist_sess_1',
                        name: 'Legs A Completed',
                        date: '2026-08-10',
                        globalStartTime: 1786350000000,
                        globalEndTime: 1786354000000,
                        duration: 4000,
                        exercises: [
                            {
                                exerciseId: 'ex_1',
                                sets: [
                                    { setNumber: 1, weight: 135, reps: 6, completed: true, rpe: undefined as any }
                                ]
                            }
                        ],
                        notes: undefined as any
                    }
                ],
                nutrition: {
                    '2026-08-17': {
                        date: '2026-08-17',
                        weight: 82.5,
                        measurements: {
                            waist: 84,
                            neck: 40,
                            hips: undefined as any,
                            chest: undefined as any,
                            biceps: undefined as any
                        },
                        notes: undefined as any,
                        meals: [
                            {
                                id: 'm_1',
                                name: 'Pranzo',
                                foods: [
                                    {
                                        id: 'cf_1',
                                        name: 'Proteine Whey',
                                        grams: 30,
                                        calories: 114,
                                        protein: 24,
                                        carbs: 1.5,
                                        fat: 0.9,
                                        note: undefined as any
                                    }
                                ]
                            }
                        ],
                        supplementsIntake: [
                            {
                                id: 'sup_1',
                                name: 'Creatina',
                                taken: true,
                                time: undefined as any
                            }
                        ]
                    }
                }
            };

            // 1. Simulate db.ts userDocData payload
            const userDocData = {
                profile: mockFullState.profile || {},
                library: mockFullState.library || [],
                routines: mockFullState.routines || [],
                customFoods: mockFullState.customFoods || [],
                activeWorkout: mockFullState.activeWorkout || null,
                trainingCycles: mockFullState.trainingCycles || [],
                activeCycleId: mockFullState.activeCycleId !== undefined ? mockFullState.activeCycleId : null,
                nutritionPlanning: mockFullState.nutritionPlanning || null,
                supplements: mockFullState.supplements || []
            };

            const cleanUserDocData = removeUndefinedValuesForFirestore(userDocData);
            expect(() => assertNoUndefined(cleanUserDocData, 'cleanUserDocData')).not.toThrow();

            // 2. Simulate db.ts history_months payload
            const histMonths: Record<string, any> = {};
            mockFullState.history.forEach(h => {
                const month = h.date.substring(0, 7);
                if (!histMonths[month]) histMonths[month] = {};
                histMonths[month][h.id] = h;
            });

            for (const month of Object.keys(histMonths)) {
                const cleanHistDoc = removeUndefinedValuesForFirestore(histMonths[month]);
                expect(() => assertNoUndefined(cleanHistDoc, `history_months/${month}`)).not.toThrow();
            }

            // 3. Simulate db.ts nutrition_months payload
            const nutMonths: Record<string, any> = {};
            const nutritionByDate: Record<string, unknown> = mockFullState.nutrition;
            Object.keys(nutritionByDate).forEach(date => {
                const month = date.substring(0, 7);
                if (!nutMonths[month]) nutMonths[month] = {};
                nutMonths[month][date] = nutritionByDate[date];
            });

            for (const month of Object.keys(nutMonths)) {
                const cleanNutDoc = removeUndefinedValuesForFirestore(nutMonths[month]);
                expect(() => assertNoUndefined(cleanNutDoc, `nutrition_months/${month}`)).not.toThrow();
            }
        });
    });

    // =========================================================================
    // 9. Projection & Repeated Sanitization Invariants
    // =========================================================================
    describe('9. Projection & Repeated Sanitization Invariants', () => {
        it('projects validated current user data to actual root and monthly documents without undefined fields', () => {
            const input = {
                profile: { height: '175' },
                routines: [{ id: 'routine-current', name: 'Workout attuale', exercises: [] }],
                history: [{ id: 'workout-current', date: '2026-10-18', exercises: [] }],
                nutrition: {
                    '2026-10-18': {
                        date: '2026-10-18', kcal: 2100, carbs: 210, pro: 150, fat: 70,
                        meals: [], supplementsIntake: [],
                    },
                },
            };
            const documents = projectDocuments(input, getSeedCatalog());
            expect([...documents.keys()].sort()).toEqual([
                '', 'history_months/2026-10', 'nutrition_months/2026-10',
            ]);
            for (const [path, document] of documents) {
                expect(() => assertNoUndefined(document, path || 'root')).not.toThrow();
            }
            expect(documents.get('')?.routines).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'routine-current' }),
            ]));
            expect(documents.get('history_months/2026-10')?.['workout-current'])
                .toMatchObject({ id: 'workout-current' });
            expect(documents.get('nutrition_months/2026-10')?.['2026-10-18'])
                .toMatchObject({ kcal: 2100 });
        });

        it('preserves non-JSON types and does not mutate inputs across repeated sanitizations', () => {
            const sampleData = {
                profile: { name: 'User 1', age: 30, notes: undefined },
                items: Array.from({ length: 50 }, (_, i) => ({
                    id: `id_${i}`,
                    count: i,
                    date: new Date('2026-10-18T12:00:00.000Z'),
                    sub: { active: true, extra: undefined }
                }))
            };

            // Repeated calls must not reuse stale sanitization state or mutate the source.
            for (let i = 0; i < 100; i++) {
                const result = removeUndefinedValuesForFirestore(sampleData);
                expect(result.profile).not.toHaveProperty('notes');
                expect(result.items).toHaveLength(50);
                expect(result.items[0].sub).not.toHaveProperty('extra');
                expect(result.items[0].date).toBe(sampleData.items[0].date);
            }

            // JSON serialization loses Date instances; the sanitizer preserves them.
            const customResult = removeUndefinedValuesForFirestore(sampleData);
            const jsonResult = JSON.parse(JSON.stringify(sampleData));
            expect(customResult.items[0].date).toBeInstanceOf(Date);
            expect(typeof jsonResult.items[0].date).toBe('string');
            expect(sampleData.profile).toHaveProperty('notes');
            expect(sampleData.items[0].sub).toHaveProperty('extra');
        });
    });
});
