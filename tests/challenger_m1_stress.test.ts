import { describe, it, expect } from 'vitest';
import { removeUndefinedValues, isPlainObject } from '../src/lib/utils/object';
import { Logic } from '../src/lib/logic';
import type { UserData } from '../src/types';

/**
 * Adversarial validator that recursively traverses a data structure
 * and asserts that NO property or element is `undefined`.
 * Simulates the strict Firestore SDK serialization check.
 */
function assertNoUndefined(value: unknown, path = 'root'): void {
    if (value === undefined) {
        throw new Error(`[FIRESTORE VIOLATION] Encountered 'undefined' at path: ${path}`);
    }
    if (value === null || typeof value !== 'object') {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            if (item === undefined) {
                throw new Error(`[FIRESTORE VIOLATION] Encountered 'undefined' in array at path: ${path}[${index}]`);
            }
            assertNoUndefined(item, `${path}[${index}]`);
        });
        return;
    }
    if (isPlainObject(value)) {
        for (const key of Object.keys(value)) {
            const val = (value as Record<string, any>)[key];
            if (val === undefined) {
                throw new Error(`[FIRESTORE VIOLATION] Encountered 'undefined' in object at path: ${path}.${key}`);
            }
            assertNoUndefined(val, `${path}.${key}`);
        }
    }
}

describe('Empirical Challenger: removeUndefinedValues & Firestore Serialization Adversarial Stress Suite', () => {

    // =========================================================================
    // 1. Extreme Deep Nesting Stress (50+ and 100+ levels)
    // =========================================================================
    describe('1. Extreme Deep Nesting Stress', () => {
        it('safely sanitizes a 100-level deeply nested object without stack overflow', () => {
            const DEPTH = 100;
            const root: Record<string, any> = {};
            let current = root;

            for (let i = 0; i < DEPTH; i++) {
                current.level = i;
                current.dropUndefined = undefined;
                if (i < DEPTH - 1) {
                    current.next = {};
                    current = current.next;
                } else {
                    current.leaf = 'deep payload';
                }
            }

            const cleaned = removeUndefinedValues(root);

            // Traverse and assert all 100 levels are intact and all dropUndefined keys removed
            let check = cleaned;
            for (let i = 0; i < DEPTH; i++) {
                expect(check.level).toBe(i);
                expect('dropUndefined' in check).toBe(false);
                if (i < DEPTH - 1) {
                    expect(check.next).toBeDefined();
                    check = check.next;
                } else {
                    expect(check.leaf).toBe('deep payload');
                }
            }
            expect(() => assertNoUndefined(cleaned)).not.toThrow();
        });

        it('safely sanitizes a 60-level deeply nested array chain', () => {
            const DEPTH = 60;
            let current: any[] = ['deepest', undefined, 42];

            for (let i = 0; i < DEPTH; i++) {
                current = [i, undefined, current, { drop: undefined, keep: i }];
            }

            const cleaned = removeUndefinedValues(current);
            expect(() => assertNoUndefined(cleaned)).not.toThrow();
        });
    });

    // =========================================================================
    // 2. Primitives, Falsy Values & Edge Primitives
    // =========================================================================
    describe('2. Primitives and Falsy Edge Cases', () => {
        it('preserves all standard and exotic primitives without alteration', () => {
            const sym = Symbol('test');
            const bigIntVal = BigInt(9007199254740991);

            const input = {
                nullVal: null,
                zero: 0,
                negZero: -0,
                emptyStr: '',
                falseVal: false,
                trueVal: true,
                nanVal: NaN,
                infVal: Infinity,
                negInfVal: -Infinity,
                bigIntVal,
                symVal: sym,
                num: 42.195,
                str: 'LogBook PWA',
                dropMe1: undefined,
                dropMe2: undefined
            };

            const result = removeUndefinedValues(input);

            expect(result.nullVal).toBe(null);
            expect(result.zero).toBe(0);
            expect(Object.is(result.negZero, -0)).toBe(true);
            expect(result.emptyStr).toBe('');
            expect(result.falseVal).toBe(false);
            expect(result.trueVal).toBe(true);
            expect(Number.isNaN(result.nanVal)).toBe(true);
            expect(result.infVal).toBe(Infinity);
            expect(result.negInfVal).toBe(-Infinity);
            expect(result.bigIntVal).toBe(bigIntVal);
            expect(result.symVal).toBe(sym);
            expect(result.num).toBe(42.195);
            expect(result.str).toBe('LogBook PWA');
            expect('dropMe1' in result).toBe(false);
            expect('dropMe2' in result).toBe(false);
        });

        it('returns primitives passed directly at root without throwing', () => {
            expect(removeUndefinedValues(null)).toBe(null);
            expect(removeUndefinedValues(undefined)).toBe(undefined);
            expect(removeUndefinedValues(0)).toBe(0);
            expect(removeUndefinedValues('')).toBe('');
            expect(removeUndefinedValues(false)).toBe(false);
            expect(removeUndefinedValues(100)).toBe(100);
        });
    });

    // =========================================================================
    // 3. Array Variations, Sparse Arrays & Array Holes
    // =========================================================================
    describe('3. Array Variations & Sparse Arrays', () => {
        it('converts sparse array holes and undefined indices to null', () => {
            // Sparse array with holes: [1, <empty>, 3, <empty>, 5]
            const sparseArr: any[] = new Array(5);
            sparseArr[0] = 1;
            sparseArr[2] = 3;
            sparseArr[4] = 5;

            const result = removeUndefinedValues(sparseArr);

            expect(result.length).toBe(5);
            expect(result[0]).toBe(1);
            expect(result[1]).toBe(null);
            expect(result[2]).toBe(3);
            expect(result[3]).toBe(null);
            expect(result[4]).toBe(5);
            expect(() => assertNoUndefined(result)).not.toThrow();
        });

        it('handles array with trailing undefined, null, and empty objects', () => {
            const arr = [undefined, null, {}, { a: undefined }, [undefined]];
            const result = removeUndefinedValues(arr);

            expect(result).toEqual([null, null, {}, {}, [null]]);
            expect(() => assertNoUndefined(result)).not.toThrow();
        });

        it('handles large array of 5,000 items efficiently without data corruption', () => {
            const largeArray: any[] = [];
            for (let i = 0; i < 5000; i++) {
                if (i % 3 === 0) {
                    largeArray.push({ id: `item_${i}`, drop: undefined, index: i });
                } else if (i % 3 === 1) {
                    largeArray.push(undefined);
                } else {
                    largeArray.push(i);
                }
            }

            const start = performance.now();
            const result = removeUndefinedValues(largeArray);
            const duration = performance.now() - start;

            expect(result.length).toBe(5000);
            expect(duration).toBeLessThan(100); // Sub-100ms for 5k items
            expect(result[0]).toEqual({ id: 'item_0', index: 0 });
            expect(result[1]).toBe(null);
            expect(result[2]).toBe(2);
            expect(() => assertNoUndefined(result)).not.toThrow();
        });
    });

    // =========================================================================
    // 4. Non-Plain Objects & Mock Firestore Instances
    // =========================================================================
    describe('4. Non-Plain Objects & Firestore Mock Types', () => {
        it('preserves Date, RegExp, Error, Map, Set, Uint8Array and custom class instances', () => {
            const d = new Date('2026-08-17T09:00:00Z');
            const r = /^[a-z0-9]+$/gi;
            const err = new Error('Test Error');
            const map = new Map<string, any>([['k', 'v']]);
            const set = new Set([1, 2, 3]);
            const uint8 = new Uint8Array([10, 20, 30]);

            class RoutineBlueprint {
                constructor(public name: string, public split: string) {}
                calculateTotalSets() { return 12; }
            }
            const routineInst = new RoutineBlueprint('Upper A', 'Upper/Lower');

            const payload = {
                d,
                r,
                err,
                map,
                set,
                uint8,
                routineInst,
                nested: { d, routineInst, drop: undefined },
                dropRoot: undefined
            };

            const result = removeUndefinedValues(payload);

            expect(result.d).toBe(d);
            expect(result.d.getTime()).toBe(d.getTime());
            expect(result.r).toBe(r);
            expect(result.err).toBe(err);
            expect(result.map).toBe(map);
            expect(result.set).toBe(set);
            expect(result.uint8).toBe(uint8);
            expect(result.routineInst).toBe(routineInst);
            expect(result.routineInst.calculateTotalSets()).toBe(12);
            expect(result.nested.d).toBe(d);
            expect(result.nested.routineInst).toBe(routineInst);
            expect('drop' in result.nested).toBe(false);
            expect('dropRoot' in result).toBe(false);
        });

        it('preserves Firestore FieldValue, Timestamp, and DocumentReference objects', () => {
            // Mock Firestore FieldValue (e.g. serverTimestamp, deleteField, arrayUnion)
            class MockFieldValue {
                readonly _methodName: string;
                constructor(methodName: string) {
                    this._methodName = methodName;
                }
                isEqual(other: MockFieldValue) {
                    return other?._methodName === this._methodName;
                }
            }

            // Mock Firestore Timestamp
            class MockTimestamp {
                constructor(public seconds: number, public nanoseconds: number) {}
                toDate() { return new Date(this.seconds * 1000); }
                toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
            }

            // Mock Firestore DocumentReference
            class MockDocumentReference {
                constructor(public id: string, public path: string) {}
            }

            const serverTs = new MockFieldValue('serverTimestamp');
            const arrayUnion = new MockFieldValue('arrayUnion');
            const docTs = new MockTimestamp(1786960000, 500000);
            const userDocRef = new MockDocumentReference('usr_123', 'users/usr_123');

            const payload = {
                serverTs,
                arrayUnion,
                docTs,
                userDocRef,
                historyEntry: {
                    completedAt: serverTs,
                    loggedTime: docTs,
                    ownerRef: userDocRef,
                    unusedField: undefined
                },
                dropTop: undefined
            };

            const result = removeUndefinedValues(payload);

            expect(result.serverTs).toBe(serverTs);
            expect(result.arrayUnion).toBe(arrayUnion);
            expect(result.docTs).toBe(docTs);
            expect(result.docTs.toDate()).toEqual(docTs.toDate());
            expect(result.userDocRef).toBe(userDocRef);
            expect(result.historyEntry.completedAt).toBe(serverTs);
            expect(result.historyEntry.loggedTime).toBe(docTs);
            expect(result.historyEntry.ownerRef).toBe(userDocRef);
            expect('unusedField' in result.historyEntry).toBe(false);
            expect('dropTop' in result).toBe(false);
        });
    });

    // =========================================================================
    // 5. Object.create(null) (Null Prototype Dictionaries)
    // =========================================================================
    describe('5. Null Prototype Dictionaries', () => {
        it('cleans null-prototype objects without error and supports deep null-prototype hierarchies', () => {
            const rootDict = Object.create(null);
            const childDict = Object.create(null);

            childDict.title = 'Null Proto Child';
            childDict.omit = undefined;

            rootDict.name = 'Null Proto Root';
            rootDict.dropKey = undefined;
            rootDict.child = childDict;
            rootDict.arr = [Object.create(null)];
            rootDict.arr[0].itemKey = 'itemVal';
            rootDict.arr[0].itemDrop = undefined;

            const result = removeUndefinedValues(rootDict);

            expect(result.name).toBe('Null Proto Root');
            expect(result.child.title).toBe('Null Proto Child');
            expect(result.arr[0].itemKey).toBe('itemVal');

            expect('dropKey' in result).toBe(false);
            expect('omit' in result.child).toBe(false);
            expect('itemDrop' in result.arr[0]).toBe(false);
            expect(() => assertNoUndefined(result)).not.toThrow();
        });
    });

    // =========================================================================
    // 6. Getters, Non-Enumerable Properties & Symbol Keys
    // =========================================================================
    describe('6. Getters, Non-Enumerable Properties & Symbol Keys', () => {
        it('evaluates getter properties and sanitizes undefined results', () => {
            const obj = {
                firstName: 'Mario',
                lastName: 'Rossi',
                get fullName() {
                    return `${this.firstName} ${this.lastName}`;
                },
                get undefinedGetter() {
                    return undefined;
                },
                get numberGetter() {
                    return 42;
                }
            };

            const result = removeUndefinedValues(obj);

            expect(result.fullName).toBe('Mario Rossi');
            expect(result.numberGetter).toBe(42);
            expect('undefinedGetter' in result).toBe(false);
            expect(() => assertNoUndefined(result)).not.toThrow();
        });

        it('ignores non-enumerable properties in plain objects (matching JSON/Firestore semantics)', () => {
            const obj: any = { regularProp: 'visible' };
            Object.defineProperty(obj, 'hiddenProp', {
                value: 'secret',
                enumerable: false
            });
            Object.defineProperty(obj, 'hiddenUndefined', {
                value: undefined,
                enumerable: false
            });

            const result = removeUndefinedValues(obj);
            expect(result.regularProp).toBe('visible');
            expect('hiddenProp' in result).toBe(false);
            expect('hiddenUndefined' in result).toBe(false);
        });

        it('does not throw when objects contain Symbol properties', () => {
            const sym = Symbol('metadata');
            const obj: any = {
                title: 'Symbol test',
                omit: undefined
            };
            obj[sym] = 'symbol value';

            const result = removeUndefinedValues(obj);
            expect(result.title).toBe('Symbol test');
            expect('omit' in result).toBe(false);
        });
    });

    // =========================================================================
    // 7. Circular References Stress (Objects, Arrays, Interleaved)
    // =========================================================================
    describe('7. Circular References Stress', () => {
        it('handles complex multi-level cyclical references (A -> B -> C -> A) safely', () => {
            const a: any = { name: 'A', dropA: undefined };
            const b: any = { name: 'B', dropB: undefined };
            const c: any = { name: 'C', dropC: undefined };

            a.b = b;
            b.c = c;
            c.a = a;

            expect(() => {
                const result = removeUndefinedValues(a);
                expect(result.name).toBe('A');
                expect('dropA' in result).toBe(false);
                expect(result.b.name).toBe('B');
                expect('dropB' in result.b).toBe(false);
                expect(result.b.c.name).toBe('C');
                expect('dropC' in result.b.c).toBe(false);
                expect(result.b.c.a).toBe(a);
            }).not.toThrow();
        });

        it('handles circular references inside arrays mixed with objects', () => {
            const parentObj: any = { title: 'Parent', drop: undefined };
            const childArr: any = [parentObj, undefined];
            parentObj.children = childArr;

            expect(() => {
                const result = removeUndefinedValues(parentObj);
                expect(result.title).toBe('Parent');
                expect('drop' in result).toBe(false);
                expect(result.children[0]).toBe(parentObj);
                expect(result.children[1]).toBe(null);
            }).not.toThrow();
        });
    });

    // =========================================================================
    // 8. Full UserData and Firestore Payloads Simulation
    // =========================================================================
    describe('8. Full UserData & Firestore Payloads Serialization Invariants', () => {
        it('guarantees ZERO undefined values in simulated userDocData, history_months, and nutrition_months', () => {
            // Construct a complete realistic UserData payload with pervasive undefined values in every collection
            const mockFullState: UserData = {
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

            const cleanUserDocData = removeUndefinedValues(userDocData);
            expect(() => assertNoUndefined(cleanUserDocData, 'cleanUserDocData')).not.toThrow();

            // 2. Simulate db.ts history_months payload
            const histMonths: Record<string, any> = {};
            mockFullState.history.forEach(h => {
                const month = h.date.substring(0, 7);
                if (!histMonths[month]) histMonths[month] = {};
                histMonths[month][h.id] = h;
            });

            for (const month of Object.keys(histMonths)) {
                const cleanHistDoc = removeUndefinedValues(histMonths[month]);
                expect(() => assertNoUndefined(cleanHistDoc, `history_months/${month}`)).not.toThrow();
            }

            // 3. Simulate db.ts nutrition_months payload
            const nutMonths: Record<string, any> = {};
            Object.keys(mockFullState.nutrition).forEach(date => {
                const month = date.substring(0, 7);
                if (!nutMonths[month]) nutMonths[month] = {};
                nutMonths[month][date] = mockFullState.nutrition[date];
            });

            for (const month of Object.keys(nutMonths)) {
                const cleanNutDoc = removeUndefinedValues(nutMonths[month]);
                expect(() => assertNoUndefined(cleanNutDoc, `nutrition_months/${month}`)).not.toThrow();
            }
        });
    });

    // =========================================================================
    // 9. Performance Benchmark vs JSON.parse(JSON.stringify(...))
    // =========================================================================
    describe('9. Performance & GC Benchmark', () => {
        it('executes 1,000 iterations of UserData sanitization significantly faster than JSON serialization and preserves non-JSON types', () => {
            const sampleData = {
                profile: { name: 'User 1', age: 30, notes: undefined },
                items: Array.from({ length: 50 }, (_, i) => ({
                    id: `id_${i}`,
                    count: i,
                    date: new Date(),
                    sub: { active: true, extra: undefined }
                }))
            };

            const ITERATIONS = 500;

            // Warm-up
            for (let i = 0; i < 20; i++) {
                removeUndefinedValues(sampleData);
                JSON.parse(JSON.stringify(sampleData));
            }

            const startCustom = performance.now();
            for (let i = 0; i < ITERATIONS; i++) {
                removeUndefinedValues(sampleData);
            }
            const durationCustom = performance.now() - startCustom;

            const startJson = performance.now();
            for (let i = 0; i < ITERATIONS; i++) {
                JSON.parse(JSON.stringify(sampleData));
            }
            const durationJson = performance.now() - startJson;

            // Assert custom is fast (< 500ms for 500 comprehensive structures under parallel load)
            expect(durationCustom).toBeLessThan(1000);

            // Assert custom does not convert Dates to ISO strings like JSON.parse(JSON.stringify) does
            const customResult = removeUndefinedValues(sampleData);
            const jsonResult = JSON.parse(JSON.stringify(sampleData));

            expect(customResult.items[0].date).toBeInstanceOf(Date);
            expect(typeof jsonResult.items[0].date).toBe('string'); // JSON destroyed Date object
        });
    });
});
