import { describe, it, expect } from 'vitest';
import { removeUndefinedValues, isPlainObject } from '../src/lib/utils/object';
import { Logic } from '../src/lib/logic';

describe('R3: Object Sanitization & removeUndefinedValues Suite', () => {
    describe('isPlainObject', () => {
        it('returns true for literal object {} and Object.create(null)', () => {
            expect(isPlainObject({})).toBe(true);
            expect(isPlainObject({ a: 1, b: 'test' })).toBe(true);
            expect(isPlainObject(Object.create(null))).toBe(true);
        });

        it('returns false for primitives, null, and undefined', () => {
            expect(isPlainObject(null)).toBe(false);
            expect(isPlainObject(undefined)).toBe(false);
            expect(isPlainObject(123)).toBe(false);
            expect(isPlainObject('string')).toBe(false);
            expect(isPlainObject(true)).toBe(false);
            expect(isPlainObject(Symbol('sym'))).toBe(false);
        });

        it('returns false for arrays, Dates, RegExps, Maps, Sets, and class instances', () => {
            expect(isPlainObject([])).toBe(false);
            expect(isPlainObject(new Date())).toBe(false);
            expect(isPlainObject(/abc/g)).toBe(false);
            expect(isPlainObject(new Map())).toBe(false);
            expect(isPlainObject(new Set())).toBe(false);

            class CustomClass {
                constructor(public name: string) {}
            }
            expect(isPlainObject(new CustomClass('custom'))).toBe(false);
        });
    });

    describe('Primitives & Falsy Values', () => {
        it('returns primitives and falsy values as-is', () => {
            expect(removeUndefinedValues(null)).toBe(null);
            expect(removeUndefinedValues(undefined)).toBe(undefined);
            expect(removeUndefinedValues(0)).toBe(0);
            expect(removeUndefinedValues(-0)).toBe(-0);
            expect(removeUndefinedValues(NaN)).toBeNaN();
            expect(removeUndefinedValues(Infinity)).toBe(Infinity);
            expect(removeUndefinedValues('')).toBe('');
            expect(removeUndefinedValues(false)).toBe(false);
            expect(removeUndefinedValues(true)).toBe(true);
            expect(removeUndefinedValues('valid string')).toBe('valid string');
            expect(removeUndefinedValues(12345)).toBe(12345);
        });
    });

    describe('Plain Objects Sanitization', () => {
        it('removes top-level undefined properties and keeps null, false, 0, and strings', () => {
            const input = {
                keepNumber: 0,
                keepNull: null,
                keepBool: false,
                keepEmptyStr: '',
                keepStr: 'LogBook',
                dropUndefined: undefined,
                dropAnotherUndefined: undefined
            };

            const result = removeUndefinedValues(input);

            expect(result).toEqual({
                keepNumber: 0,
                keepNull: null,
                keepBool: false,
                keepEmptyStr: '',
                keepStr: 'LogBook'
            });
            expect('dropUndefined' in result).toBe(false);
            expect('dropAnotherUndefined' in result).toBe(false);
        });

        it('recursively cleans deeply nested objects', () => {
            const input = {
                level1: {
                    keep1: 'a',
                    drop1: undefined,
                    level2: {
                        keep2: 42,
                        drop2: undefined,
                        level3: {
                            keep3: true,
                            drop3: undefined
                        }
                    }
                }
            };

            const result = removeUndefinedValues(input);

            expect(result).toEqual({
                level1: {
                    keep1: 'a',
                    level2: {
                        keep2: 42,
                        level3: {
                            keep3: true
                        }
                    }
                }
            });
            expect('drop1' in result.level1).toBe(false);
            expect('drop2' in result.level1.level2).toBe(false);
            expect('drop3' in result.level1.level2.level3).toBe(false);
        });

        it('supports Object.create(null) dictionary objects', () => {
            const dict = Object.create(null);
            dict.name = 'bench press';
            dict.notes = undefined;
            dict.weight = 80;

            const result = removeUndefinedValues(dict);

            expect(result.name).toBe('bench press');
            expect(result.weight).toBe(80);
            expect('notes' in result).toBe(false);
        });
    });

    describe('Arrays Sanitization', () => {
        it('preserves array of primitives without undefined values', () => {
            const input = [1, 'two', null, false, 0, ''];
            const result = removeUndefinedValues(input);

            expect(result).toEqual([1, 'two', null, false, 0, '']);
        });

        it('converts undefined array items to null to preserve index positions for Firestore', () => {
            const input = [1, undefined, 'three', undefined, null];
            const result = removeUndefinedValues(input);

            expect(result).toEqual([1, null, 'three', null, null]);
        });

        it('recursively cleans objects within arrays', () => {
            const input = [
                { id: '1', name: 'Squat', notes: undefined, sets: 4 },
                { id: '2', name: 'Deadlift', notes: 'heavy', rpe: undefined }
            ];

            const result = removeUndefinedValues(input);

            expect(result).toEqual([
                { id: '1', name: 'Squat', sets: 4 },
                { id: '2', name: 'Deadlift', notes: 'heavy' }
            ]);
            expect('notes' in result[0]).toBe(false);
            expect('rpe' in result[1]).toBe(false);
        });

        it('recursively cleans nested multi-dimensional arrays', () => {
            const input = [
                [1, undefined, 2],
                [{ key: 'val', bad: undefined }, undefined]
            ];

            const result = removeUndefinedValues(input);

            expect(result).toEqual([
                [1, null, 2],
                [{ key: 'val' }, null]
            ]);
        });
    });

    describe('Special & Non-Plain Objects Preservation', () => {
        it('preserves Date instances without converting them to strings', () => {
            const date = new Date('2026-08-17T10:00:00Z');
            const input = {
                timestamp: date,
                nested: { createdAt: date },
                dropMe: undefined
            };

            const result = removeUndefinedValues(input);

            expect(result.timestamp).toBeInstanceOf(Date);
            expect(result.timestamp.getTime()).toBe(date.getTime());
            expect(result.nested.createdAt).toBeInstanceOf(Date);
            expect('dropMe' in result).toBe(false);
        });

        it('preserves custom class instances and simulated Firestore FieldValue objects', () => {
            class MockServerTimestamp {
                readonly _type = 'FieldValue';
                toFirestore() { return 'server_timestamp'; }
            }

            const mockTimestamp = new MockServerTimestamp();
            const input = {
                updatedAt: mockTimestamp,
                meta: { field: mockTimestamp },
                missing: undefined
            };

            const result = removeUndefinedValues(input);

            expect(result.updatedAt).toBe(mockTimestamp);
            expect(result.meta.field).toBe(mockTimestamp);
            expect(result.updatedAt).toBeInstanceOf(MockServerTimestamp);
            expect('missing' in result).toBe(false);
        });

        it('preserves Uint8Array, RegExp, and Map objects', () => {
            const reg = /^test$/i;
            const uint = new Uint8Array([1, 2, 3]);
            const map = new Map([['k', 'v']]);

            const input = {
                reg,
                uint,
                map,
                bad: undefined
            };

            const result = removeUndefinedValues(input);

            expect(result.reg).toBe(reg);
            expect(result.uint).toBe(uint);
            expect(result.map).toBe(map);
            expect('bad' in result).toBe(false);
        });
    });

    describe('Circular References Protection', () => {
        it('handles circular object references without throwing stack overflow errors', () => {
            const cyclicObj: any = { name: 'cyclic', omit: undefined };
            cyclicObj.self = cyclicObj;

            expect(() => {
                const result = removeUndefinedValues(cyclicObj);
                expect(result.name).toBe('cyclic');
                expect('omit' in result).toBe(false);
                expect(result.self).toBe(cyclicObj);
            }).not.toThrow();
        });

        it('handles circular array references without throwing stack overflow errors', () => {
            const cyclicArr: any = [1, undefined];
            cyclicArr.push(cyclicArr);

            expect(() => {
                const result = removeUndefinedValues(cyclicArr);
                expect(result[0]).toBe(1);
                expect(result[1]).toBe(null);
            }).not.toThrow();
        });
    });

    describe('Re-export through Logic module', () => {
        it('Logic object exposes removeUndefinedValues and isPlainObject', () => {
            expect(typeof Logic.removeUndefinedValues).toBe('function');
            expect(typeof Logic.isPlainObject).toBe('function');

            const testObj = { a: 1, b: undefined };
            const cleaned = Logic.removeUndefinedValues(testObj);
            expect(cleaned).toEqual({ a: 1 });
            expect(Logic.isPlainObject(testObj)).toBe(true);
        });
    });

    describe('Complex Real-World Firestore Payload Simulation', () => {
        it('sanitizes a comprehensive userDocData and history/nutrition structure', () => {
            const fullUserData = {
                profile: {
                    displayName: 'Mario Rossi',
                    gender: 'male',
                    weight: 75,
                    height: 178,
                    bodyFat: undefined,
                    activityLevel: 'moderate'
                },
                library: [
                    {
                        id: 'ex_1',
                        name: 'Panca piana',
                        muscle: 'chest',
                        secondaryMuscles: ['triceps', 'shoulders'],
                        equipment: 'barbell',
                        notes: undefined,
                        trackingType: 'weight_reps'
                    }
                ],
                routines: [
                    {
                        id: 'routine_1',
                        name: 'Push A',
                        exercises: [
                            {
                                exerciseId: 'ex_1',
                                sets: 4,
                                targetReps: 8,
                                rpe: undefined,
                                restTime: 120
                            }
                        ]
                    }
                ],
                activeWorkout: {
                    id: 'sess_1',
                    name: 'Push A',
                    date: '2026-08-17',
                    globalStartTime: 1786960000000,
                    exercises: [
                        {
                            exerciseId: 'ex_1',
                            sets: [
                                { setNumber: 1, weight: 80, reps: 8, completed: true, rpe: undefined },
                                { setNumber: 2, weight: 80, reps: 7, completed: true, dropset: undefined }
                            ]
                        }
                    ],
                    notes: undefined
                },
                nutrition: {
                    '2026-08-17': {
                        date: '2026-08-17',
                        weight: 75.2,
                        measurements: {
                            waist: 82,
                            neck: 38,
                            hips: undefined,
                            chest: undefined
                        },
                        meals: [
                            {
                                id: 'm1',
                                name: 'Colazione',
                                foods: [
                                    { id: 'f1', name: 'Avena', grams: 80, note: undefined }
                                ]
                            }
                        ]
                    }
                }
            };

            const sanitized = removeUndefinedValues(fullUserData);

            // Assertions for deep undefined removal
            expect('bodyFat' in sanitized.profile).toBe(false);
            expect('notes' in sanitized.library[0]).toBe(false);
            expect('rpe' in sanitized.routines[0].exercises[0]).toBe(false);
            expect('rpe' in sanitized.activeWorkout.exercises[0].sets[0]).toBe(false);
            expect('dropset' in sanitized.activeWorkout.exercises[0].sets[1]).toBe(false);
            expect('notes' in sanitized.activeWorkout).toBe(false);
            expect('hips' in sanitized.nutrition['2026-08-17'].measurements).toBe(false);
            expect('chest' in sanitized.nutrition['2026-08-17'].measurements).toBe(false);
            expect('note' in sanitized.nutrition['2026-08-17'].meals[0].foods[0]).toBe(false);

            // Assertions that valid data is intact
            expect(sanitized.profile.displayName).toBe('Mario Rossi');
            expect(sanitized.profile.weight).toBe(75);
            expect(sanitized.library[0].name).toBe('Panca piana');
            expect(sanitized.routines[0].exercises[0].restTime).toBe(120);
            expect(sanitized.activeWorkout.exercises[0].sets[0].weight).toBe(80);
            expect(sanitized.nutrition['2026-08-17'].measurements.waist).toBe(82);
        });
    });
});
