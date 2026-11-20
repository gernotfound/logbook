import { describe, expect, it } from 'vitest';
import type { WorkoutSession } from '../../src/types';
import { applyDomainOperations, type DomainOperation } from '../../src/lib/sync/domainOperations';
import { projectDocuments } from '../../src/lib/sync/documentProjection';
import {
    CURRENT_BACKUP_SCHEMA,
    CURRENT_DATA_SCHEMA,
    CURRENT_LOCAL_ENVELOPE,
    CURRENT_SYNC_PROTOCOL,
} from '../../src/lib/schemaEvolution';
import { base, catalog, compile } from './m8DomainFixture';

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

describe('Domain reducer input isolation across operations', () => {
    it('does not mutate frozen nested source data for unrelated or compound writes', () => {
        const session: WorkoutSession = {
            id: 'w-1', date: '2026-09-15', exercises: [{
                id: 'session-ex-1', exId: 'e-1', sessionNote: '', sets: [],
            }],
        };
        const before = deepFreeze(base({
            profile: { height: '170' },
            nutrition: {
                '2026-09-15': {
                    date: '2026-09-15', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [],
                    steps: 100,
                },
            },
            history: [session],
            library: [{ id: 'e-1', name: 'Esercizio', setsCount: 3, sets: [] }],
            routines: [{ id: 'r-1', name: 'Routine', exercises: [{ exId: 'e-1', setsCount: 3 }] }],
            catalogOverrides: { exercises: {}, foods: {} },
        }));
        const snapshot = structuredClone(before);
        const cases: DomainOperation[] = [
            { type: 'profile.patch', patch: { height: '171' } },
            { type: 'nutrition-day.patch', date: '2026-09-15', patch: { weight: '80' } },
            { type: 'nutrition-day.delete', date: '2026-09-15' },
            { type: 'activity-steps.set', date: '2026-09-15', steps: 4567 },
            { type: 'activity-steps.clear', date: '2026-09-15' },
            { type: 'nutrition-meal.upsert', date: '2026-09-15', meal: {
                id: 'meal-1', name: 'Pasto', meal: 'Pranzo', baseQty: 100, quantity: 100,
                kcal: 120, carbs: 12, pro: 8, fat: 4,
            } },
            { type: 'routine-exercise.upsert', routineId: 'r-1', exercise: { exId: 'e-1', setsCount: 4 } },
            { type: 'routine-exercise.reorder', routineId: 'r-1', exIds: ['e-1'] },
            { type: 'exercise.delete', id: 'e-1' },
            { type: 'history.upsert', workout: { ...session, date: '2026-10-15' } },
            { type: 'history.delete', id: 'w-1' },
            { type: 'catalog.exercise.patch', id: 'e-1', patch: { name: 'Mio nome' } },
            { type: 'catalog.exercise.visibility', id: 'e-1', hidden: true },
            { type: 'active-workout.set', workout: session },
            { type: 'workout.complete', workout: session, expectedActiveWorkoutId: 'w-1', activePains: [] },
        ];
        for (const operation of cases) {
            const result = applyDomainOperations(before, operation);
            expect(result).not.toBe(before);
            expect(result).toEqual(UserDataSchema.parse(result));
            expect(result.history).not.toBe(before.history);
            expect(result.nutrition).not.toBe(before.nutrition);
            expect(before).toEqual(snapshot);
        }
    });

    it('does not leak partial edits from a failed frozen multi-operation batch', () => {
        const before = deepFreeze(base({
            nutrition: { '2026-09-15': {
                date: '2026-09-15', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [],
            } },
            history: [{ id: 'w-original', date: '2026-09-15', exercises: [] }],
        }));
        const snapshot = structuredClone(before);
        expect(() => applyDomainOperations(before, [
            { type: 'activity-steps.set', date: '2026-09-15', steps: 3000 },
            { type: 'history.upsert', workout: { id: 'w-new', date: '2026-10-15', exercises: [] } },
            { type: 'activity-steps.set', date: '2026-09-15', steps: -1 },
        ])).toThrow('Passi: valore non valido');
        expect(before).toEqual(snapshot);
    });
});

describe('M8 Domain Operations V4', () => {
    it('rejects prototype-sensitive patch keys instead of changing object inheritance', () => {
        const before = base({ profile: { height: '170' } });
        for (const key of ['__proto__', 'constructor', 'prototype']) {
            const patch = JSON.parse(JSON.stringify({ [key]: { forged: true } }));
            expect(() => applyDomainOperations(before, { type: 'profile.patch', patch }))
                .toThrow('Chiave patch non valida');
        }
        expect(before.profile?.height).toBe('170');
        expect(Object.getPrototypeOf(before.profile)).toBe(Object.prototype);
    });

    it('preserves source data and batch isolation when a later operation fails', () => {
        const before = base({ nutrition: {} });
        const original = structuredClone(before);
        const after = applyDomainOperations(before, [
            { type: 'activity-steps.set', date: '2026-09-15', steps: 4500 },
            { type: 'activity-steps.set', date: '2026-09-16', steps: 6200 },
        ]);

        expect(after).not.toBe(before);
        expect(before).toEqual(original);
        expect(after.nutrition?.['2026-09-15']?.steps).toBe(4500);
        expect(after.nutrition?.['2026-09-16']?.steps).toBe(6200);

        expect(() => applyDomainOperations(before, [
            { type: 'activity-steps.set', date: '2026-09-15', steps: 9999 },
            { type: 'activity-steps.set', date: '2026-09-16', steps: -1 },
        ])).toThrow('Passi: valore non valido');
        expect(before).toEqual(original);
    });

    it('rejects non-representable meal totals without publishing a partially applied domain batch', () => {
        const before = base({ profile: { height: '170' } });
        const original = structuredClone(before);
        expect(() => applyDomainOperations(before, [
            { type: 'profile.patch', patch: { height: '180' } },
            { type: 'nutrition-meal.upsert', date: '2026-09-15', meal: {
                id: 'overflow', name: 'Overflow', meal: 'Pranzo', baseQty: 1, quantity: 2,
                kcal: Number.MAX_VALUE, carbs: 0, pro: 0, fat: 0,
            } },
        ])).toThrow('Totali nutrizionali non rappresentabili');
        expect(before).toEqual(original);
    });

    it('keeps all persisted version dimensions unchanged', () => {
        expect(CURRENT_DATA_SCHEMA).toBe(1);
        expect(CURRENT_SYNC_PROTOCOL).toBe(3);
        expect(CURRENT_LOCAL_ENVELOPE).toBe(5);
        expect(CURRENT_BACKUP_SCHEMA).toBe(3);
    });

    it('compiles and replays a prototype-named workout identity without dropping its monthly shard entry', () => {
        const before = base({ history: [] });
        const workout: WorkoutSession = {
            id: '__proto__', date: '2026-09-15', exercises: [], routineName: 'Sicuro',
        };
        const { after, operations, replay } = compile(before, { type: 'history.upsert', workout });
        expect(after.history?.find(item => item.id === '__proto__')).toBeDefined();
        expect(operations.length).toBeGreaterThan(0);
        expect(operations.every(op => op.docPath === 'history_months/2026-09' && op.path[0] === '__proto__')).toBe(true);
        const month = replay.get('history_months/2026-09')!;
        expect(Object.hasOwn(month, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(month)).toBe(Object.prototype);
        expect(month['__proto__']).toMatchObject({ id: '__proto__', date: '2026-09-15' });
    });

    it('fails closed for catalog keys that Zod record maps cannot persist, without dropping other reserved-name overrides', () => {
        const before = base({ catalogOverrides: { exercises: {}, foods: {} } });
        expect(() => applyDomainOperations(before, {
            type: 'catalog.exercise.patch', id: '__proto__', patch: { name: 'Non conservabile' },
        })).toThrow('identificativo non rappresentabile');
        expect(() => applyDomainOperations(before, {
            type: 'catalog.food.patch', id: '__proto__', patch: { name: 'Non conservabile' },
        })).toThrow('identificativo non rappresentabile');

        const after = applyDomainOperations(before, [
            { type: 'catalog.exercise.patch', id: 'constructor', patch: { name: 'Esercizio personale' } },
            { type: 'catalog.food.patch', id: 'toString', patch: { name: 'Alimento personale' } },
        ]);
        const exercises = after.catalogOverrides?.exercises ?? {};
        const foods = after.catalogOverrides?.foods ?? {};
        expect(Object.hasOwn(exercises, 'constructor')).toBe(true);
        expect(exercises['constructor']).toEqual({ name: 'Esercizio personale' });
        expect(Object.getPrototypeOf(exercises)).toBe(Object.prototype);
        expect(Object.hasOwn(foods, 'toString')).toBe(true);
        expect(foods['toString']).toEqual({ name: 'Alimento personale' });
        expect(Object.getPrototypeOf(foods)).toBe(Object.prototype);
        const persisted = projectDocuments(after, catalog).get('')!;
        expect(Object.hasOwn((persisted.catalogOverrides as Record<string, Record<string, unknown>>).exercises, 'constructor')).toBe(true);
        expect(({} as Record<string, unknown>).name).toBeUndefined();
        expect(before.catalogOverrides?.exercises).toEqual({});
    });
});
