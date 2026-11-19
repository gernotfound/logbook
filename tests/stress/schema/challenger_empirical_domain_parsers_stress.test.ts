import { describe, it, expect } from 'vitest';
import { DomainParsers, WorkoutSessionSchema } from '../../../src/lib/schema';

describe('Empirical Challenger: DomainParsers malformed-input stress suite', () => {
    describe('3. DomainParsers Adversarial & Malformed Input Stress Suite', () => {
        it('3.1: parseProfile handles adversarial types (NaN, boolean, array, symbols, nested garbage, prototype keys)', () => {
            const attackVectors = [
                NaN,
                null,
                undefined,
                true,
                false,
                12345,
                ['an', 'array'],
                { height: NaN, waist: null, neck: undefined, dob: 19900101, hips: { deep: 'corrupt' }, __proto__: { evil: 'true' } },
                { gender: 'other', height: '185.5', unknownKey: 'preservedViaPassthrough' }
            ];

            attackVectors.forEach(vector => {
                const parsed = DomainParsers.parseProfile(vector);
                expect(parsed).toBeDefined();
                expect(typeof parsed).toBe('object');
                expect(parsed).not.toBeNull();
            });

            // Specific conversion assertions
            const transformed = DomainParsers.parseProfile({ height: 180, waist: '85', dob: 20000101 });
            expect(transformed.height).toBe('180');
            expect(transformed.waist).toBe('85');
            expect(transformed.dob).toBe('20000101');
        });

        it('3.2: parseWorkoutSession recovers gracefully from corrupted exercises, nested sets, continuation segments, and ratings', () => {
            const corruptedSession = {
                id: 12345, // string union transforms to '12345'
                routineName: null,
                date: undefined,
                moodRating: 'NaN', // string NaN transformed to null
                pumpRating: 5,
                fatigueRating: '  ', // empty trimmed string converted to null
                waterLiters: '2.5', // string float parsed to 2.5
                exercises: [
                    {
                        exId: 999, // transformed to '999'
                        sessionNote: null, // safeString falls back to ''
                        sets: [
                            {
                                id: 'set_1',
                                kg: 100, // converted to '100'
                                reps: 10, // converted to '10'
                                done: 'true', // string boolean converted to true
                                segments: [
                                    { technique: 'dropset' as const, id: 'ds_1', kg: 80, reps: '6' },
                                    'corrupted_segment_string', // invalid segment quarantined
                                    null,
                                    { technique: 'isometry' as const, reps: '', id: 'iso_1', kg: 50, time: 20 },
                                    12345 // invalid segment quarantined
                                ],
                            },
                            null, // corrupted set element falls back to default
                            { kg: 'NaN', reps: null }
                        ]
                    },
                    'corrupted_exercise_item' // falls back to default
                ]
            };

            const parsed = WorkoutSessionSchema.parse(corruptedSession);
            expect(parsed.id).toBe('12345');
            expect(parsed.pumpRating).toBe(5);
            expect(parsed.fatigueRating).toBeNull();
            expect(parsed.waterLiters).toBe(2.5);
            expect(parsed.exercises).toHaveLength(2);
            expect(parsed.exercises[0].exId).toBe('999');
            expect(parsed.exercises[0].sets[0].kg).toBe('100');
            expect(parsed.exercises[0].sets[0].reps).toBe('10');
            expect(parsed.exercises[0].sets[0].done).toBe(true);
            expect(parsed.exercises[0].sets[0].segments?.filter(segment => segment.technique === 'dropset')).toHaveLength(1);
            expect(parsed.exercises[0].sets[0].segments?.filter(segment => segment.technique === 'isometry')).toHaveLength(1);
        });

        it('3.3: parseHistory sanitizes arrays containing corrupted items without crashing or dropping valid entries', () => {
            const rawHistory = [
                { id: 'h_valid', date: '2026-08-16', exercises: [] },
                null,
                undefined,
                { id: 999, corrupted: true },
                'raw string item',
                12345
            ];

            const parsed = DomainParsers.parseHistory(rawHistory);
            expect(parsed).toHaveLength(2);
            expect(parsed[0].id).toBe('h_valid');
            expect(parsed[1].id).toBe('999');
            expect(Array.isArray(parsed[1].exercises)).toBe(true);
        });

        it('3.4: parseNutrition handles invalid date keys, corrupted meals, and biometric values with defensive defaults', () => {
            const rawNutrition = {
                '2026-08-16': {
                    date: '2026-08-16',
                    kcal: '2400',
                    carbs: 'NaN', // falls back to 0
                    pro: '180.5',
                    fat: null, // falls back to 0
                    weight: '82.3',
                    bf: '14.5',
                    neck: ' ',
                    meals: [
                        { id: 'm1', name: 'Shake', meal: 'Spuntino', quantity: '300', kcal: '250', carbs: 10, pro: 40, fat: 3 },
                        null,
                        'corrupted meal'
                    ],
                    supplementsIntake: [
                        { id: 'si1', supplementId: 'creatine', amount: '5', time: '1723800000000' }
                    ]
                }
            };

            const parsed = DomainParsers.parseNutrition(rawNutrition);
            expect(parsed['2026-08-16'].kcal).toBe(2400);
            expect(parsed['2026-08-16'].carbs).toBe(0);
            expect(parsed['2026-08-16'].pro).toBe(180.5);
            expect(parsed['2026-08-16'].fat).toBe(0);
            expect(parsed['2026-08-16'].weight).toBe(82.3);
            expect(parsed['2026-08-16'].bf).toBe(14.5);
            expect(parsed['2026-08-16'].neck).toBeUndefined();
            expect(parsed['2026-08-16'].meals).toHaveLength(1);
            expect(parsed['2026-08-16'].meals[0].name).toBe('Shake');
            expect(parsed['2026-08-16'].supplementsIntake[0].amount).toBe(5);
        });

        it('3.5: parseLibrary handles exercise trackingType enums and sanitized sets', () => {
            const rawLibrary = [
                { id: 'ex_1', name: 'Panca', setsCount: '4', trackingType: 'weight_reps' },
                { id: 'ex_2', name: 'Plank', setsCount: 3, trackingType: 'time' },
                { id: 'ex_3', name: 'Cyclette', setsCount: 1, trackingType: 'cardio' },
                { id: 'ex_4', name: 'Invalid Type', setsCount: 2, trackingType: 'unsupported_mode' }
            ];

            const parsed = DomainParsers.parseLibrary(rawLibrary);
            expect(parsed).toHaveLength(4);
            expect(parsed[0].setsCount).toBe(4);
            expect(parsed[0].trackingType).toBe('weight_reps');
            expect(parsed[1].trackingType).toBe('time');
            expect(parsed[2].trackingType).toBe('cardio');
            expect(parsed[3].trackingType).toBeUndefined(); // invalid enum falls back to undefined
        });

        it('3.6: parseCustomFoods handles full micronutrient schema and stringified floats', () => {
            const rawFoods = [
                {
                    id: 'f1',
                    name: 'Salmone Selvaggio',
                    kcal: '208',
                    pro: '20.4',
                    carbs: '0',
                    fat: '13.2',
                    satFat: '3.1',
                    sodium: '55',
                    fiber: null,
                    iron: '0.5'
                }
            ];

            const parsed = DomainParsers.parseCustomFoods(rawFoods);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].kcal).toBe(208);
            expect(parsed[0].pro).toBe(20.4);
            expect(parsed[0].fat).toBe(13.2);
            expect(parsed[0].satFat).toBe(3.1);
            expect(parsed[0].sodium).toBe(55);
            expect(parsed[0].fiber).toBeNull();
            expect(parsed[0].iron).toBe(0.5);
        });

        it('3.7: parseRoutines & parseTrainingCycles handle sequence arrays and enum validation', () => {
            const rawCycles = [
                {
                    id: 'c1',
                    name: 'Forza 1',
                    durationWeeks: '6',
                    progressionMode: 'fixed',
                    routines: [{ routineId: 'r1', frequencyPerWeek: '2' }]
                },
                {
                    id: 'c2',
                    name: 'Forza 2',
                    durationWeeks: 4,
                    progressionMode: 'invalid_progression',
                    routines: []
                }
            ];

            const parsed = DomainParsers.parseTrainingCycles(rawCycles);
            expect(parsed).toHaveLength(2);
            expect(parsed[0].durationWeeks).toBe(6);
            expect(parsed[0].progressionMode).toBe('fixed');
            expect(parsed[0].routines[0].frequencyPerWeek).toBe(2);
            expect(parsed[1].progressionMode).toBeUndefined();
        });

        it('3.8: parseSupplements & parseNutritionPlanning handle nested ratios, boosts and unsupported pre-launch fields', () => {
            const rawSupplements = [
                { id: 's1', name: 'Vitamina D3', unit: 'UI', target: '2000', portion: '1000' }
            ];
            const parsedSups = DomainParsers.parseSupplements(rawSupplements);
            expect(parsedSups[0].target).toBe(2000);
            expect(parsedSups[0].portion).toBe(1000);

            const rawPlanning = {
                weight: '82.5',
                onDaysCount: '4',
                avgMacros: { carbsPerKg: '4.0', proPerKg: '2.2', fatPerKg: '1.0' },
                onBoost: { carbsPercent: '20', proPercent: '0', fatPercent: '-10' },
                lockedMacro: 'carbs',
                normocalorica: { kcal: '2500', carbs: '300', pro: '160', fat: '70' }
            };

            const parsedPlanning = DomainParsers.parseNutritionPlanning(rawPlanning);
            if (!parsedPlanning) throw new Error('La pianificazione valida non deve essere null');
            expect(parsedPlanning.weight).toBe(82.5);
            expect(parsedPlanning.onDaysCount).toBe(4);
            expect(parsedPlanning.avgMacros?.carbsPerKg).toBe(4);
            expect(parsedPlanning.onBoost?.carbsPercent).toBe(20);
            expect(parsedPlanning.onBoost?.fatPercent).toBe(-10);
            expect(parsedPlanning).not.toHaveProperty('lockedMacro');
            expect(parsedPlanning.normocalorica?.kcal).toBe(2500);
        });


    });
});
