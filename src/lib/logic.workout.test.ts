import { describe, it, expect } from 'vitest';
import { Logic } from './logic';

describe('Logic Library Tests', () => {
    describe('Volume & Weight Calculation Engine (R1)', () => {
        describe('getLatestUserWeight', () => {
            it('returns latest weight from chronological nutrition days', () => {
                const nutrition = {
                    '2026-08-01': { weight: 82.5 },
                    '2026-08-15': { weight: 81.0 },
                    '2026-08-10': { weight: 81.8 },
                };
                expect(Logic.getLatestUserWeight(nutrition)).toBe(81.0);
            });

            it('skips invalid/empty weight entries in nutrition', () => {
                const nutrition = {
                    '2026-08-01': { weight: 82.5 },
                    '2026-08-15': { weight: '' },
                    '2026-08-20': { weight: null },
                };
                expect(Logic.getLatestUserWeight(nutrition)).toBe(82.5);
            });

            it('falls back to nutritionPlanning weight if no valid nutrition entries', () => {
                const planning = { weight: 75 };
                expect(Logic.getLatestUserWeight({}, planning)).toBe(75);
                expect(Logic.getLatestUserWeight(null, planning)).toBe(75);
            });

            it('falls back to 80 if both nutrition and nutritionPlanning are missing or empty', () => {
                expect(Logic.getLatestUserWeight(null, null)).toBe(80);
                expect(Logic.getLatestUserWeight({}, {})).toBe(80);
            });
        });

        describe('calculateEffectiveSetWeight', () => {
            it('returns baseKg for standard exercise without bodyweight or equipment', () => {
                expect(Logic.calculateEffectiveSetWeight(50, null, 80)).toBe(50);
                expect(Logic.calculateEffectiveSetWeight('60', { isBodyweight: false }, 75)).toBe(60);
            });

            it('adds user weight when isBodyweight is true', () => {
                // 0 kg + 80 kg user = 80 kg
                expect(Logic.calculateEffectiveSetWeight(0, { isBodyweight: true }, 80)).toBe(80);
                expect(Logic.calculateEffectiveSetWeight('0', { isBodyweight: true }, 80)).toBe(80);
                // +10 kg ballast + 80 kg user = 90 kg
                expect(Logic.calculateEffectiveSetWeight(10, { isBodyweight: true }, 80)).toBe(90);
                expect(Logic.calculateEffectiveSetWeight('15.5', { isBodyweight: true }, 70)).toBe(85.5);
            });

            it('adds equipment weight when equipmentWeight is specified', () => {
                // 60 kg + 20 kg barbell = 80 kg
                expect(Logic.calculateEffectiveSetWeight(60, { equipmentWeight: 20 }, 80)).toBe(80);
                expect(Logic.calculateEffectiveSetWeight(0, { equipmentWeight: 20 }, 80)).toBe(20);
            });

            it('combines bodyweight and equipment weight when both are present', () => {
                // 0 kg + 75 kg user + 5 kg weighted vest = 80 kg
                expect(Logic.calculateEffectiveSetWeight(0, { isBodyweight: true, equipmentWeight: 5 }, 75)).toBe(80);
                // 10 kg + 75 kg user + 5 kg vest = 90 kg
                expect(Logic.calculateEffectiveSetWeight(10, { isBodyweight: true, equipmentWeight: 5 }, 75)).toBe(90);
            });

            it('handles invalid or undefined inputs gracefully', () => {
                expect(Logic.calculateEffectiveSetWeight('', null, 80)).toBe(0);
                expect(Logic.calculateEffectiveSetWeight(null, null, 80)).toBe(0);
                expect(Logic.calculateEffectiveSetWeight('invalid', null, 80)).toBe(0);
            });
        });

        describe('calculateSetVolume', () => {
            it('calculates standard volume as effectiveWeight * reps', () => {
                const set = { kg: '50', reps: '10' };
                expect(Logic.calculateSetVolume(set, null, 80)).toBe(500);
            });

            it('calculates volume for bodyweight exercise with 0 kg correctly (acceptance criterion R1)', () => {
                const set = { kg: '0', reps: '10' };
                const bwEx = { isBodyweight: true };
                // 80 kg * 10 reps = 800
                expect(Logic.calculateSetVolume(set, bwEx, 80)).toBe(800);
            });

            it('includes dropsets volume in the total set volume', () => {
                const set = {
                    kg: '100',
                    reps: '8', // 800
                    segments: [
                        { technique: 'dropset' as const, id: 'seg-fixture-1', kg: '70', reps: '6' },  // 420
                        { technique: 'dropset' as const, id: 'seg-fixture-2', kg: '50', reps: '8' }   // 400
                    ]
                };
                expect(Logic.calculateSetVolume(set, null, 80)).toBe(800 + 420 + 400); // 1620
            });

            it('includes dropsets on bodyweight exercises', () => {
                const set = {
                    kg: '20', // +20 ballast on 80kg = 100kg
                    reps: '5', // 500
                    segments: [
                        { technique: 'dropset' as const, id: 'seg-fixture-3', kg: '0', reps: '5' } // 0 ballast on 80kg = 80kg * 5 = 400
                    ]
                };
                const bwEx = { isBodyweight: true };
                expect(Logic.calculateSetVolume(set, bwEx, 80)).toBe(500 + 400); // 900
            });

            it('returns 0 for null/undefined or empty sets', () => {
                expect(Logic.calculateSetVolume(null as any)).toBe(0);
                expect(Logic.calculateSetVolume({ kg: '50', reps: '0' })).toBe(0);
            });
        });

        describe('calculateWorkoutVolume', () => {
            it('calculates total volume across multiple exercises matching library metadata', () => {
                const library = [
                    { id: 'ex-bench', name: 'Panca piana', isBodyweight: false, equipmentWeight: 0 },
                    { id: 'ex-pullup', name: 'Trazioni', isBodyweight: true, equipmentWeight: 0 },
                    { id: 'ex-trapbar', name: 'Trap Bar Deadlift', isBodyweight: false, equipmentWeight: 25 },
                ];

                const session = {
                    exercises: [
                        {
                            exId: 'ex-bench',
                            sets: [
                                { kg: '80', reps: '10' }, // 800
                                { kg: '90', reps: '8' }   // 720
                            ]
                        },
                        {
                            exId: 'ex-pullup',
                            sets: [
                                { kg: '0', reps: '10' }, // (80 + 0) * 10 = 800
                                { kg: '10', reps: '6' }  // (80 + 10) * 6 = 540
                            ]
                        },
                        {
                            exId: 'ex-trapbar',
                            sets: [
                                { kg: '100', reps: '5' } // (100 + 25) * 5 = 625
                            ]
                        }
                    ]
                };

                const total = Logic.calculateWorkoutVolume(session, library, 80);
                expect(total).toBe(800 + 720 + 800 + 540 + 625); // 3485
            });

            it('returns 0 for empty or invalid sessions', () => {
                expect(Logic.calculateWorkoutVolume(null as any)).toBe(0);
                expect(Logic.calculateWorkoutVolume({ exercises: [] })).toBe(0);
            });
        });

        describe('DOMS Muscle Pain Tracking & Explicit Persistence (R5 & R6)', () => {
            it('getMuscleName: returns Italian localized name for valid ID and falls back to ID if not found', () => {
                expect(Logic.getMuscleName('chest')).toBe('Petto');
                expect(Logic.getMuscleName('biceps')).toBe('Bicipiti');
                expect(Logic.getMuscleName('biceps_left')).toBe('Bicipite sinistro');
                expect(Logic.getMuscleName('unknown_muscle_id')).toBe('unknown_muscle_id');
                expect(Logic.getMuscleName('')).toBe('');
            });

            it('searchMuscles: finds muscles with direct, fuzzy, and Italian stemmed queries', () => {
                const chestMatches = Logic.searchMuscles('pettorali');
                expect(chestMatches.length).toBeGreaterThan(0);
                expect(chestMatches.some(m => m.id === 'chest' || m.name.toLowerCase().includes('petto'))).toBe(true);

                const bicepsMatches = Logic.searchMuscles('bicipite');
                expect(bicepsMatches.length).toBeGreaterThan(0);
                expect(bicepsMatches.some(m => m.id.includes('biceps'))).toBe(true);

                const emptyMatches = Logic.searchMuscles('');
                expect(emptyMatches).toEqual([]);
            });

            it('mergeActivePains: preserves active pains until the user explicitly clears them', () => {
                const activePains = ['chest', 'quads'];
                const result = Logic.mergeActivePains(activePains, []);
                expect(result).toEqual(['chest', 'quads']);
            });

            it('mergeActivePains: deduplicates pains reported again after a session', () => {
                const activePains = ['chest', 'quads'];
                const sessionPains = ['chest'];
                const result = Logic.mergeActivePains(activePains, sessionPains);
                expect(result).toEqual(['chest', 'quads']);
            });

            it('mergeActivePains: does not infer recovery from trained muscles or laterality', () => {
                const activePains = ['biceps_left'];
                const result = Logic.mergeActivePains(activePains, []);
                expect(result).toEqual(['biceps_left']);
            });

            it('mergeActivePains: appends newly reported post-workout pains', () => {
                const result = Logic.mergeActivePains(['lats'], ['quads', 'glutes']);
                expect(result).toEqual(['lats', 'quads', 'glutes']);
            });

            it('mergeActivePains: safely handles null, duplicates and empty values', () => {
                expect(Logic.mergeActivePains()).toEqual([]);
                expect(Logic.mergeActivePains(null as any, null as any)).toEqual([]);
                expect(Logic.mergeActivePains(['chest', '', 'chest'], ['chest', 'quads'])).toEqual(['chest', 'quads']);
            });
        });
    });
});
