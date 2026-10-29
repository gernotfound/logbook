import { describe, expect, it } from 'vitest';
import {
    diffDocuments,
    applySemanticOperations,
    parseSyncMeta,
    getMergePolicy,
    resolveIdentity,
} from '../src/lib/sync/semanticProjection';
import type { DocumentData } from '../src/lib/sync/documentProjection';
import { removeUndefinedValues } from '../src/lib/utils/object';

describe('Semantic sync reference invariants', () => {
    it('preserves prototype-named workout IDs and causal tombstones as own properties', () => {
        const path = 'history_months/2026-09';
        const workout = { id: '__proto__', date: '2026-09-13', exercises: [] };
        const input = Object.fromEntries([['__proto__', workout]]);
        const clean = removeUndefinedValues(input);
        expect(Object.keys(clean)).toEqual(['__proto__']);
        expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);

        const desired = new Map<string, DocumentData>([[path, input]]);
        const operations = diffDocuments(new Map(), desired, 's00', 1, { s00: 1 });
        expect(operations.length).toBeGreaterThan(0);
        expect(operations.every(op => op.path[0] === '__proto__')).toBe(true);

        const create = {
            docPath: path, path: ['__proto__'], value: workout,
            isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        };
        const created = applySemanticOperations(new Map([[path, {}]]), [create]);
        const cloud = created.documents.get(path)!;
        expect(Object.hasOwn(cloud, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(cloud)).toBe(Object.prototype);
        expect(cloud['__proto__']).toEqual(workout);
        const metadata = created.syncMetas[path];
        expect(Object.hasOwn(metadata.fields, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(metadata.fields)).toBe(Object.prototype);
        expect(Object.hasOwn(parseSyncMeta(metadata).fields, '__proto__')).toBe(true);

        const deleted = applySemanticOperations(created.documents, [{
            docPath: path, path: ['__proto__'], isDelete: true,
            actorId: 's00', seq: 2, clock: { s00: 2 },
        }], created.syncMetas);
        expect(Object.hasOwn(deleted.documents.get(path)!, '__proto__')).toBe(false);
        expect(Object.hasOwn(deleted.syncMetas[path].fields, '__proto__')).toBe(true);
        expect(deleted.syncMetas[path].fields['__proto__'].deleted).toBe(true);
        const replay = applySemanticOperations(deleted.documents, [create], deleted.syncMetas);
        expect(Object.hasOwn(replay.documents.get(path)!, '__proto__')).toBe(false);
    });

    it('does not traverse inherited constructors when applying nested semantic paths', () => {
        const op = {
            docPath: '', path: ['constructor', 'prototype', 'polluted'],
            value: true, isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        };
        const result = applySemanticOperations(new Map([['', {}]]), [op]);
        expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
        const document = result.documents.get('')!;
        expect(Object.hasOwn(document, 'constructor')).toBe(true);
        expect(document.constructor).toEqual({ prototype: { polluted: true } });
        expect(Object.getPrototypeOf(document)).toBe(Object.prototype);
    });

    it('diffs profile at property level instead of replacing the whole profile', () => {
        const base = new Map<string, DocumentData>([
            ['', { profile: { height: '170', gender: 'M' } }],
        ]);
        const desired = new Map<string, DocumentData>([
            ['', { profile: { height: '180', gender: 'M' } }],
        ]);

        const ops = diffDocuments(base, desired, 'A', 1, { A: 1 });

        expect(getMergePolicy('', ['profile'])).toBe('property');
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({
            docPath: '',
            path: ['profile', 'height'],
            value: '180',
            isDelete: false,
        });
    });

    it('uses routineId as the identity inside trainingCycles[].routines', () => {
        expect(resolveIdentity(
            ['trainingCycles', 'cycle-1', 'routines'],
            { routineId: 'routine-2', frequencyPerWeek: 2 }
        )).toBe('routine-2');
    });

    it('does not generate causal operations for derived daily nutrition totals', () => {
        const base = new Map<string, DocumentData>([
            ['nutrition_months/2026-09', {
                '2026-09-13': {
                    date: '2026-09-13',
                    kcal: 100,
                    carbs: 10,
                    pro: 5,
                    fat: 3,
                    meals: [],
                },
            }],
        ]);
        const desired = new Map<string, DocumentData>([
            ['nutrition_months/2026-09', {
                '2026-09-13': {
                    date: '2026-09-13',
                    kcal: 999,
                    carbs: 99,
                    pro: 55,
                    fat: 33,
                    meals: [],
                },
            }],
        ]);

        const ops = diffDocuments(base, desired, 'A', 1, { A: 1 });

        expect(ops).toEqual([]);
    });

    it('keeps persisted meal macros causal because they are source data for daily totals', () => {
        const base = new Map<string, DocumentData>([
            ['nutrition_months/2026-09', {
                '2026-09-13': {
                    date: '2026-09-13',
                    kcal: 100,
                    carbs: 10,
                    pro: 5,
                    fat: 3,
                    meals: [{
                        id: 'meal-1',
                        name: 'Riso',
                        meal: 'pranzo',
                        quantity: 100,
                        baseQty: 100,
                        kcal: 100,
                        carbs: 10,
                        pro: 5,
                        fat: 3,
                    }],
                },
            }],
        ]);
        const desired = new Map<string, DocumentData>([
            ['nutrition_months/2026-09', {
                '2026-09-13': {
                    date: '2026-09-13',
                    kcal: 120,
                    carbs: 10,
                    pro: 5,
                    fat: 3,
                    meals: [{
                        id: 'meal-1',
                        name: 'Riso',
                        meal: 'pranzo',
                        quantity: 100,
                        baseQty: 100,
                        kcal: 120,
                        carbs: 10,
                        pro: 5,
                        fat: 3,
                    }],
                },
            }],
        ]);

        const ops = diffDocuments(base, desired, 'A', 1, { A: 1 });

        expect(ops).toHaveLength(1);
        expect(ops[0].path).toEqual(['2026-09-13', 'meals', 'meal-1', 'kcal']);
        expect(ops[0].value).toBe(120);
    });
    it('does not alias journal values into newly inserted keyed records', () => {
        const base = new Map<string, DocumentData>([['', { routines: [] }]]);
        const desired = new Map<string, DocumentData>([['', {
            routines: [{ id: 'routine-1', name: 'Before', exercises: [] }],
        }]]);
        const ops = diffDocuments(base, desired, 's00', 1, { s00: 1 });
        const originalJournal = structuredClone(ops);

        const result = applySemanticOperations(base, ops);
        const routine = (result.documents.get('')!.routines as Array<{
            id: string; name: string; exercises: unknown[];
        }>)[0];
        expect(routine.name).toBe('Before');
        routine.name = 'After';
        routine.exercises.push({ id: 'exercise-1' });

        expect(ops).toEqual(originalJournal);
        expect(desired.get('')!.routines).toEqual([{ id: 'routine-1', name: 'Before', exercises: [] }]);
    });

    it('does not alias nested payloads when an existing keyed record is updated', () => {
        const base = new Map<string, DocumentData>([['', {
            routines: [{ id: 'routine-1', name: 'Before', options: { sessions: 1 } }],
        }]]);
        const replacement = { id: 'routine-1', name: 'After', options: { sessions: 2 } };
        const op = {
            docPath: '', path: ['routines', 'routine-1'], value: replacement,
            isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        };

        const result = applySemanticOperations(base, [op]);
        const routine = (result.documents.get('')!.routines as Array<{
            options: { sessions: number };
        }>)[0];
        expect(routine.options.sessions).toBe(2);
        routine.options.sessions = 3;

        expect(op.value.options.sessions).toBe(2);
        expect((base.get('')!.routines as Array<{ options: { sessions: number } }>)[0].options.sessions).toBe(1);
    });

    it('preserves parent operation values when a later child winner is applied', () => {
        const parent = {
            docPath: '', path: ['profile'], value: { height: '170' },
            isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        };
        const child = {
            docPath: '', path: ['profile', 'height'], value: '180',
            isDelete: false, actorId: 's00', seq: 2, clock: { s00: 2 },
        };
        const operations = [parent, child];
        const originalJournal = structuredClone(operations);

        const result = applySemanticOperations(new Map([['', {}]]), operations);
        expect((result.documents.get('')!.profile as { height: string }).height).toBe('180');
        expect(operations).toEqual(originalJournal);
    });

    it('recalculates nutrition totals without modifying the durable semantic payload', () => {
        const day = {
            date: '2026-09-13',
            meals: [{ id: 'meal-1', name: 'Meal', quantity: 100, baseQty: 100, kcal: 50, carbs: 12, pro: 2, fat: 1 }],
        };
        const originalDay = structuredClone(day);
        const op = {
            docPath: 'nutrition_months/2026-09', path: ['2026-09-13'],
            value: day, isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        };

        const result = applySemanticOperations(new Map([[op.docPath, {}]]), [op]);
        const mergedDay = result.documents.get(op.docPath)!['2026-09-13'] as {
            kcal: number; carbs: number; meals: typeof day.meals;
        };
        expect(mergedDay.kcal).toBe(50);
        expect(mergedDay.carbs).toBe(12);
        expect(op.value).toEqual(originalDay);
        mergedDay.meals[0].kcal = 999;
        expect(op.value).toEqual(originalDay);
    });

    it('snapshots keyed inserts and causal clocks independently from source projections', () => {
        const routine = {
            id: 'routine-1', name: 'Original',
            exercises: [{ exId: 'bench-1', sets: [] }],
        };
        const desired = new Map<string, DocumentData>([['', { routines: [routine] }]]);
        const clock = { s00: 1 };
        const ops = diffDocuments(new Map([['', { routines: [] }]]), desired, 's00', 1, clock);
        const insertion = ops.find(op => op.path.join('/') === 'routines/routine-1');
        expect(insertion?.value).toEqual(routine);
        expect(ops.some(op => op.path.includes('$order'))).toBe(true);

        routine.name = 'Later change';
        routine.exercises[0].exId = 'later-exercise';
        clock.s00 = 99;

        expect(insertion?.value).toEqual({
            id: 'routine-1', name: 'Original',
            exercises: [{ exId: 'bench-1', sets: [] }],
        });
        expect(ops.every(op => op.clock.s00 === 1)).toBe(true);

        const replay = applySemanticOperations(new Map([['', { routines: [] }]]), ops);
        expect(replay.documents.get('')!.routines).toEqual([{
            id: 'routine-1', name: 'Original',
            exercises: [{ exId: 'bench-1', sets: [] }],
        }]);

        ((insertion!.value as typeof routine).exercises[0]).exId = 'journal-change';
        expect(routine.exercises[0].exId).toBe('later-exercise');
    });

    it('snapshots the atomic active-session payload before the source changes', () => {
        const workout = {
            id: 'workout-1', date: '2026-09-13',
            exercises: [{ id: 'exercise-1', name: 'Original' }],
        };
        const desired = new Map<string, DocumentData>([['', { activeWorkout: workout }]]);
        const ops = diffDocuments(new Map([['', { activeWorkout: null }]]), desired, 's00', 1, { s00: 1 });
        expect(ops).toHaveLength(1);
        expect(ops[0].path).toEqual(['activeWorkout']);

        workout.exercises[0].name = 'Later change';
        expect(ops[0].value).toEqual({
            id: 'workout-1', date: '2026-09-13',
            exercises: [{ id: 'exercise-1', name: 'Original' }],
        });
        (ops[0].value as typeof workout).exercises[0].name = 'Journal change';
        expect(workout.exercises[0].name).toBe('Later change');
    });

    it('snapshots the explicit atomic fallback for an invalid keyed collection', () => {
        const routines = [
            { id: 'routine-1', name: 'First' },
            { id: 'routine-1', name: 'Duplicate' },
        ];
        const desired = new Map<string, DocumentData>([['', { routines }]]);
        const ops = diffDocuments(new Map([['', { routines: [] }]]), desired, 's00', 1, { s00: 1 });
        expect(ops).toHaveLength(1);
        expect(ops[0].path).toEqual(['routines']);
        expect(ops[0].value).toEqual(routines);

        routines[0].name = 'Later change';
        expect(ops[0].value).toEqual([
            { id: 'routine-1', name: 'First' },
            { id: 'routine-1', name: 'Duplicate' },
        ]);
    });

});
