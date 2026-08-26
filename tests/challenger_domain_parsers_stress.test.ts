import { describe, it, expect } from 'vitest';
import { DomainParsers, UserDataSchema, defaultUserDataFallback } from '../src/lib/schema';

describe('Challenger 2: DomainParsers Adversarial Stress Testing', () => {
    describe('1. parseProfile', () => {
        it('handles valid full and partial profile payloads', () => {
            const validProfile = {
                dob: '1995-05-15',
                height: '180',
                gender: 'male',
                neck: '40',
                waist: '82',
                hip: '95',
                hips: '95',
                manualBf: '12',
                chest: '105',
                shoulders: '120',
                biceps: '38',
                thighs: '60',
                calves: '38'
            };
            const result = DomainParsers.parseProfile(validProfile);
            expect(result).toMatchObject(validProfile);
        });

        it('sanitizes malicious, invalid, and corrupted profile payloads without throwing', () => {
            const corruptedPayloads = [
                null,
                undefined,
                'invalid string',
                12345,
                NaN,
                [],
                { height: 185, waist: null, neck: { nested: 'garbage' }, evil: true },
                { height: '   ', waist: '120cm', __proto__: { polluted: true } }
            ];

            corruptedPayloads.forEach(payload => {
                expect(() => {
                    const parsed = DomainParsers.parseProfile(payload);
                    expect(typeof parsed).toBe('object');
                    expect(parsed).not.toBeNull();
                }).not.toThrow();
            });
        });

        it('transforms numeric inputs into string representations defensively', () => {
            const parsed = DomainParsers.parseProfile({ height: 178, weight: 75 });
            expect((parsed as any).height).toBe('178');
        });
    });

    describe('2. parseWorkoutSession', () => {
        it('handles valid workout session with nested sets, dropsets, and isometrics', () => {
            const validSession = {
                id: 'sess_123',
                routineId: 'rout_1',
                routineName: 'Push Day A',
                date: '2026-08-16',
                globalStartTime: 1723810000000,
                exercises: [
                    {
                        exId: 'bench_press',
                        sessionNote: 'Felt strong',
                        sets: [
                            {
                                id: 's1',
                                kg: '100',
                                reps: '8',
                                done: true,
                                dropsets: [{ id: 'ds1', kg: '80', reps: '6' }],
                                isometrics: [{ id: 'iso1', kg: '60', time: '15' }]
                            }
                        ]
                    }
                ]
            };
            const result = DomainParsers.parseWorkoutSession(validSession);
            expect(result.id).toBe('sess_123');
            expect(result.exercises).toHaveLength(1);
            expect(result.exercises[0].sets[0].dropsets).toHaveLength(1);
            expect(result.exercises[0].sets[0].isometrics).toHaveLength(1);
        });

        it('recovers gracefully from heavily corrupted session objects without crashing', () => {
            const corruptedSessions = [
                null,
                undefined,
                'a string',
                999,
                { exercises: 'not-an-array' },
                { exercises: [{ sets: 'garbage', sessionNote: 12345 }] },
                { exercises: [{ sets: [{ kg: null, reps: undefined, dropsets: 'corrupt', isometrics: null }] }] }
            ];

            corruptedSessions.forEach(payload => {
                expect(() => {
                    const parsed = DomainParsers.parseWorkoutSession(payload);
                    expect(Array.isArray(parsed.exercises)).toBe(true);
                }).not.toThrow();
            });
        });

        it('handles extreme volume session (500 sets) without memory issues or failures', () => {
            const hugeExercises = Array.from({ length: 50 }, (_, exIdx) => ({
                exId: `ex_${exIdx}`,
                sessionNote: `Note ${exIdx}`,
                sets: Array.from({ length: 10 }, (_, setIdx) => ({
                    id: `s_${exIdx}_${setIdx}`,
                    kg: `${50 + setIdx * 5}`,
                    reps: `${10 - setIdx}`,
                    done: true,
                    dropsets: [{ id: `ds_${exIdx}_${setIdx}`, kg: '40', reps: '5' }],
                    isometrics: [{ id: `iso_${exIdx}_${setIdx}`, kg: '30', time: '10' }]
                }))
            }));

            const largeSession = {
                id: 'large_session',
                routineName: 'Mega Volume',
                exercises: hugeExercises
            };

            const parsed = DomainParsers.parseWorkoutSession(largeSession);
            expect(parsed.exercises).toHaveLength(50);
            expect(parsed.exercises[0].sets).toHaveLength(10);
            expect(parsed.exercises[0].sets[0].dropsets).toHaveLength(1);
        });
    });

    describe('3. parseHistory', () => {
        it('parses valid session history array', () => {
            const history = [
                { id: 'h1', date: '2026-08-01', globalStartTime: 1722470400000, exercises: [] },
                { id: 'h2', date: '2026-08-03', globalStartTime: 1722643200000, exercises: [] }
            ];
            const parsed = DomainParsers.parseHistory(history);
            expect(parsed).toHaveLength(2);
            expect(parsed[0].id).toBe('h1');
        });

        it('sanitizes individual corrupted items inside history array using sub-schema fallbacks', () => {
            const dirtyHistory = [
                { id: 'h1', date: '2026-08-01', exercises: [{ exId: 'e1', sets: [] }] },
                { invalid: 'session', corrupted: true },
                'raw_string_item',
                12345,
                null
            ];
            const parsed = DomainParsers.parseHistory(dirtyHistory);
            expect(parsed).toHaveLength(5);
            expect(parsed[0].id).toBe('h1');
            expect(Array.isArray(parsed[1].exercises)).toBe(true);
            expect(Array.isArray(parsed[2].exercises)).toBe(true);
            expect(Array.isArray(parsed[3].exercises)).toBe(true);
            expect(Array.isArray(parsed[4].exercises)).toBe(true);
        });

        it('returns empty array (defensive fallback) when non-array is passed to parseHistory', () => {
            // New defensive behavior: instead of throwing, returns [] and logs a warning
            expect(DomainParsers.parseHistory('not an array')).toEqual([]);
            expect(DomainParsers.parseHistory(null)).toEqual([]);
            expect(DomainParsers.parseHistory(12345)).toEqual([]);
            expect(DomainParsers.parseHistory({ history: [] })).toEqual([]);
        });
    });

    describe('4. parseNutrition', () => {
        it('parses valid nutrition map with multiple dates and meals', () => {
            const nutritionMap = {
                '2026-08-15': {
                    date: '2026-08-15',
                    kcal: 2450,
                    carbs: 280,
                    pro: 170,
                    fat: 65,
                    weight: 78.5,
                    isDayOn: true,
                    meals: [
                        { id: 'm1', name: 'Oats & Whey', meal: 'breakfast', quantity: 100, kcal: 380, carbs: 60, pro: 30, fat: 5 }
                    ],
                    supplementsIntake: [
                        { id: 'si1', supplementId: 'creatine', amount: 5, time: 1723700000000 }
                    ]
                }
            };

            const parsed = DomainParsers.parseNutrition(nutritionMap);
            expect(parsed['2026-08-15'].kcal).toBe(2450);
            expect(parsed['2026-08-15'].meals).toHaveLength(1);
            expect(parsed['2026-08-15'].supplementsIntake).toHaveLength(1);
        });

        it('cleanses invalid values within day records (NaN, string numbers, null meals)', () => {
            const dirtyNutrition = {
                '2026-08-16': {
                    date: '2026-08-16',
                    kcal: '2500' as any,
                    carbs: NaN as any,
                    pro: '180.5' as any,
                    fat: null as any,
                    meals: 'not-array' as any,
                    supplementsIntake: null as any
                }
            };

            const parsed = DomainParsers.parseNutrition(dirtyNutrition);
            expect(parsed['2026-08-16'].kcal).toBe(2500);
            expect(parsed['2026-08-16'].carbs).toBe(0); // NaN falls back to 0
            expect(parsed['2026-08-16'].pro).toBe(180.5);
            expect(parsed['2026-08-16'].fat).toBe(0);
            expect(Array.isArray(parsed['2026-08-16'].meals)).toBe(true);
            expect(Array.isArray(parsed['2026-08-16'].supplementsIntake)).toBe(true);
        });

        it('returns empty object (defensive fallback) on non-object inputs for parseNutrition', () => {
            // New defensive behavior: instead of throwing, returns {} and logs a warning
            expect(DomainParsers.parseNutrition(null)).toEqual({});
            expect(DomainParsers.parseNutrition('invalid')).toEqual({});
            expect(DomainParsers.parseNutrition([1, 2, 3])).toEqual({});
        });
    });

    describe('5. parseLibrary', () => {
        it('parses valid exercise library items with tracking types', () => {
            const library = [
                {
                    id: 'bench',
                    name: 'Panca piana',
                    setsCount: 4,
                    muscles: ['chest', 'triceps'],
                    secondaryMuscles: ['shoulders'],
                    trackingType: 'weight_reps' as const
                },
                {
                    id: 'plank',
                    name: 'Plank addominale',
                    setsCount: 3,
                    trackingType: 'time' as const
                },
                {
                    id: 'treadmill',
                    name: 'Tapis roulant',
                    setsCount: 1,
                    trackingType: 'cardio' as const
                }
            ];

            const parsed = DomainParsers.parseLibrary(library);
            expect(parsed).toHaveLength(3);
            expect(parsed[0].trackingType).toBe('weight_reps');
            expect(parsed[1].trackingType).toBe('time');
            expect(parsed[2].trackingType).toBe('cardio');
        });

        it('handles invalid trackingType by falling back to undefined', () => {
            const dirtyLibrary = [
                { id: 'custom', name: 'Unknown tracking', trackingType: 'invalid_type' }
            ];
            const parsed = DomainParsers.parseLibrary(dirtyLibrary);
            expect(parsed[0].trackingType).toBeUndefined();
        });
    });

    describe('6. parseCustomFoods', () => {
        it('parses food items with full micronutrients and brand information', () => {
            const customFoods = [
                {
                    id: 'food_1',
                    name: 'Petto di pollo',
                    brand: 'Amadori',
                    kcal: 110,
                    pro: 23.5,
                    carbs: 0,
                    fat: 1.2,
                    satFat: 0.3,
                    sodium: 65,
                    fiber: 0,
                    iron: 0.8
                }
            ];

            const parsed = DomainParsers.parseCustomFoods(customFoods);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].name).toBe('Petto di pollo');
            expect(parsed[0].pro).toBe(23.5);
            expect(parsed[0].satFat).toBe(0.3);
        });

        it('converts stringified numbers and handles empty strings gracefully', () => {
            const dirtyFoods = [
                {
                    id: 'pasta-semola-dirty',  // required: isValidParsedId filters items without a valid id
                    name: 'Pasta di semola',
                    kcal: '350',
                    pro: '12',
                    carbs: '72',
                    fat: '1.5',
                    satFat: '',
                    sugars: '  '
                }
            ];

            const parsed = DomainParsers.parseCustomFoods(dirtyFoods);
            expect(parsed[0].kcal).toBe(350);
            expect(parsed[0].carbs).toBe(72);
            expect(parsed[0].satFat).toBeNull();
            expect(parsed[0].sugars).toBeNull();
        });
    });

    describe('7. parseRoutines', () => {
        it('parses workout routines with exercise sequences and default techniques', () => {
            const routines = [
                {
                    id: 'push_a',
                    name: 'Push A',
                    exercises: [
                        { exId: 'bench', setsCount: 4, minReps: 6, maxReps: 8, defaultTechnique: 'dropset' as const },
                        { exId: 'lateral_raise', setsCount: 3, defaultTechnique: 'isometrics' as const }
                    ]
                }
            ];

            const parsed = DomainParsers.parseRoutines(routines);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].exercises[0].defaultTechnique).toBe('dropset');
            expect(parsed[0].exercises[1].defaultTechnique).toBe('isometrics');
        });
    });

    describe('8. parseTrainingCycles', () => {
        it('parses training cycles with progression mode and duration weeks', () => {
            const cycles = [
                {
                    id: 'cycle_1',
                    name: 'Ipertrofia Blocco 1',
                    durationWeeks: 6,
                    sessionsPerWeek: 4,
                    progressionMode: 'sequential' as const,
                    routines: [
                        { routineId: 'push_a', frequencyPerWeek: 2 },
                        { routineId: 'pull_a', frequencyPerWeek: 2 }
                    ],
                    isActive: true
                }
            ];

            const parsed = DomainParsers.parseTrainingCycles(cycles);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].durationWeeks).toBe(6);
            expect(parsed[0].progressionMode).toBe('sequential');
            expect(parsed[0].isActive).toBe(true);
        });
    });

    describe('9. parseSupplements', () => {
        it('parses supplements list with targets and units', () => {
            const supplements = [
                { id: 'creatine', name: 'Creatina Monoidrato', unit: 'g', target: 5, portion: 5 },
                { id: 'whey', name: 'Proteine Whey', unit: 'g', target: 30, portion: 30 },
                { id: 'omega3', name: 'Omega 3', unit: 'cps', target: 3, portion: 1 }
            ];

            const parsed = DomainParsers.parseSupplements(supplements);
            expect(parsed).toHaveLength(3);
            expect(parsed[0].unit).toBe('g');
            expect(parsed[2].unit).toBe('cps');
        });
    });

    describe('10. parseNutritionPlanning', () => {
        it('parses full nutrition planning with on/off ratios, boost percentages, and normocalorica', () => {
            const planning = {
                weight: 82,
                onDaysCount: 4,
                avgMacros: { carbsPerKg: 4.0, proPerKg: 2.2, fatPerKg: 1.0 },
                onBoost: { carbsPercent: 25, proPercent: 0, fatPercent: -10 },
                normocalorica: { kcal: 2600, carbs: 320, pro: 170, fat: 75 }
            };

            const parsed = DomainParsers.parseNutritionPlanning(planning);
            expect(parsed.weight).toBe(82);
            expect(parsed.onDaysCount).toBe(4);
            expect(parsed.avgMacros?.carbsPerKg).toBe(4.0);
            expect(parsed.onBoost?.carbsPercent).toBe(25);
            expect(parsed.normocalorica?.kcal).toBe(2600);
        });

        it('recovers gracefully from corrupted planning data with default fallbacks', () => {
            const dirtyPlanning = {
                weight: 'invalid_weight',
                avgMacros: { carbsPerKg: 'NaN', proPerKg: null, fatPerKg: undefined },
                normocalorica: null
            };

            const parsed = DomainParsers.parseNutritionPlanning(dirtyPlanning);
            expect(parsed.weight).toBeUndefined(); // safeOptionalNumber returns undefined on invalid
            expect(parsed.avgMacros?.carbsPerKg).toBe(0);
            expect(parsed.avgMacros?.proPerKg).toBe(0);
        });
    });

    describe('11. Monolithic UserDataSchema Fallback Integrity', () => {
        it('provides complete default fallback matching defaultUserDataFallback when parsing total junk', () => {
            const junkInputs = [null, undefined, 'total string garbage', 123456, false];
            junkInputs.forEach(junk => {
                const parsed = UserDataSchema.parse(junk);
                expect(parsed).toBeDefined();
                expect(Array.isArray(parsed.library)).toBe(true);
                expect(Array.isArray(parsed.routines)).toBe(true);
                expect(Array.isArray(parsed.history)).toBe(true);
                expect(typeof parsed.nutrition).toBe('object');
                expect(parsed.activeWorkout).toBeNull();
            });
        });
    });
});
