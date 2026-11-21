import { describe, it, expect } from 'vitest';
import { removeUndefinedValuesForFirestore } from '../../../src/lib/utils/object';
import { assertNoUndefined } from './firestoreSanitizationOracle';

describe('Empirical Challenger: removeUndefinedValuesForFirestore & Firestore Serialization Adversarial Stress Suite', () => {

    it('independent serialization oracle detects nested undefined values even in null-prototype dictionaries', () => {
        expect(() => assertNoUndefined({ nested: [{ missing: undefined }] }))
            .toThrow('[FIRESTORE VIOLATION] Encountered \'undefined\' in object at path: root.nested[0].missing');
        const dictionary = Object.assign(Object.create(null), { child: { missing: undefined } });
        expect(() => assertNoUndefined(dictionary))
            .toThrow('[FIRESTORE VIOLATION] Encountered \'undefined\' in object at path: root.child.missing');
    });

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

            const cleaned = removeUndefinedValuesForFirestore(root);

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

            const cleaned = removeUndefinedValuesForFirestore(current);
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

            const result = removeUndefinedValuesForFirestore(input);

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
            expect(removeUndefinedValuesForFirestore(null)).toBe(null);
            expect(removeUndefinedValuesForFirestore(undefined)).toBe(undefined);
            expect(removeUndefinedValuesForFirestore(0)).toBe(0);
            expect(removeUndefinedValuesForFirestore('')).toBe('');
            expect(removeUndefinedValuesForFirestore(false)).toBe(false);
            expect(removeUndefinedValuesForFirestore(100)).toBe(100);
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
            expect(() => assertNoUndefined(sparseArr)).toThrow('[FIRESTORE VIOLATION]');

            const result = removeUndefinedValuesForFirestore(sparseArr);

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
            const result = removeUndefinedValuesForFirestore(arr);

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

            const result = removeUndefinedValuesForFirestore(largeArray);

            expect(result.length).toBe(5000);
            expect(result[0]).toEqual({ id: 'item_0', index: 0 });
            expect(result[1]).toBe(null);
            expect(result[2]).toBe(2);
            expect(() => assertNoUndefined(result)).not.toThrow();
        });
    });

    // =========================================================================
    // 4. Non-Plain Objects & Mock Firestore Instances
    // =========================================================================
});
