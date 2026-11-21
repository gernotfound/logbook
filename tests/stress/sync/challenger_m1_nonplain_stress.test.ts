import { describe, it, expect } from 'vitest';
import { removeUndefinedValuesForFirestore } from '../../../src/lib/utils/object';
import { assertNoUndefined } from './firestoreSanitizationOracle';

describe('Empirical Challenger: removeUndefinedValuesForFirestore & Firestore Serialization Adversarial Stress Suite', () => {

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

            const result = removeUndefinedValuesForFirestore(payload);

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

            const result = removeUndefinedValuesForFirestore(payload);

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

            const result = removeUndefinedValuesForFirestore(rootDict);

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

            const result = removeUndefinedValuesForFirestore(obj);

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

            const result = removeUndefinedValuesForFirestore(obj);
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

            const result = removeUndefinedValuesForFirestore(obj);
            expect(result.title).toBe('Symbol test');
            expect('omit' in result).toBe(false);
        });
    });

    // =========================================================================
    // 7. Circular References Stress (Objects, Arrays, Interleaved)
    // =========================================================================
    describe('7. Circular References Stress', () => {
        it('rejects multi-level cyclical references (A -> B -> C -> A) without mutating the source', () => {
            const a: any = { name: 'A', dropA: undefined };
            const b: any = { name: 'B', dropB: undefined };
            const c: any = { name: 'C', dropC: undefined };

            a.b = b;
            b.c = c;
            c.a = a;

            expect(() => removeUndefinedValuesForFirestore(a)).toThrow('Riferimento circolare');
            expect(a.b.c.a).toBe(a);
            expect(Object.hasOwn(a, 'dropA')).toBe(true);
            expect(Object.hasOwn(b, 'dropB')).toBe(true);
            expect(Object.hasOwn(c, 'dropC')).toBe(true);
        });

        it('rejects object-array cycles without mutating the source', () => {
            const parentObj: any = { title: 'Parent', drop: undefined };
            const childArr: any = [parentObj, undefined];
            parentObj.children = childArr;

            expect(() => removeUndefinedValuesForFirestore(parentObj)).toThrow('Riferimento circolare');
            expect(parentObj.children).toBe(childArr);
            expect(childArr[0]).toBe(parentObj);
            expect(childArr[1]).toBeUndefined();
            expect(Object.hasOwn(parentObj, 'drop')).toBe(true);
        });
    });

    // =========================================================================
    // 8. Full UserData and Firestore Payloads Simulation
    // =========================================================================
});
