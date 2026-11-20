import { describe, expect, it } from 'vitest';
import type { CachedGlobalCatalog, WorkoutSession } from '../../src/types';
import { applyDomainOperations, compileDomainOperations, type DomainOperation } from '../../src/lib/sync/domainOperations';
import { applySemanticOperations } from '../../src/lib/sync/semanticProjection';
import { projectDocuments, type DocumentProjectionScope } from '../../src/lib/sync/documentProjection';
import { base, catalog } from './m8DomainFixture';

describe('Batched history lookup and semantic projection', () => {
    it('preserves moved, deleted and untouched workouts across monthly documents', () => {
        const history: WorkoutSession[] = Array.from({ length: 72 }, (_, index) => ({
            id: `history-${index}`,
            date: index % 2 === 0 ? '2026-08-15' : '2026-07-15',
            exercises: [],
        }));
        const moved = history.slice(0, 24).map(workout => ({ ...workout, date: '2026-09-15' }));
        const deleted = new Set(history.slice(24, 42).map(workout => String(workout.id)));
        const before = base({ history });
        const after = base({ history: [
            ...moved,
            ...history.slice(24).filter(workout => !deleted.has(String(workout.id))),
        ] });
        const batch: DomainOperation[] = [
            ...moved.map(workout => ({ type: 'history.upsert' as const, workout })),
            ...[...deleted].map(id => ({ type: 'history.delete' as const, id })),
        ];
        const operations = compileDomainOperations(before, after, batch, catalog, 'actor-a', 1, { 'actor-a': 1 });
        const replay = applySemanticOperations(projectDocuments(before, catalog), operations).documents;
        const affected = new Set([...moved.map(workout => String(workout.id)), ...deleted]);
        expect(operations.length).toBeGreaterThan(0);
        expect(operations.every(operation => operation.docPath.startsWith('history_months/')
            && affected.has(String(operation.path[0])))).toBe(true);
        for (const workout of moved) {
            const previousMonth = Number(String(workout.id).split('-')[1]) % 2 === 0 ? '2026-08' : '2026-07';
            expect(replay.get(`history_months/${previousMonth}`)?.[String(workout.id)]).toBeUndefined();
            expect(replay.get('history_months/2026-09')?.[String(workout.id)]).toMatchObject({ date: '2026-09-15' });
        }
        for (const id of deleted) {
            const previousMonth = Number(id.split('-')[1]) % 2 === 0 ? '2026-08' : '2026-07';
            expect(replay.get(`history_months/${previousMonth}`)?.[id]).toBeUndefined();
        }
        expect(replay.get('history_months/2026-08')?.['history-42']).toMatchObject({ date: '2026-08-15' });
        expect(replay.get('history_months/2026-07')?.['history-43']).toMatchObject({ date: '2026-07-15' });
    });
});

describe('Domain Operations projection scope regressions', () => {
    const withGlobalCatalog: CachedGlobalCatalog = {
        ...catalog,
        exercises: [
            { id: 'g1', name: 'Global one', setsCount: 3 },
            { id: 'g2', name: 'Global two', setsCount: 3 },
        ],
        foods: [
            { id: 7, name: 'Global food', kcal: 100, carbs: 10, pro: 10, fat: 2 },
        ],
    };
    const before = base({
        library: [
            { id: 'g1', name: 'Renamed global one', setsCount: 3, sets: [], isDefault: true },
            { id: 'custom', name: 'Custom', setsCount: 3, sets: [], isDefault: false },
        ],
        customFoods: [{ id: 7, name: 'Global food', kcal: 100, carbs: 10, pro: 10, fat: 2, isCustom: false }],
        catalogOverrides: { exercises: { g1: { name: 'Stale override' }, g2: { notes: 'Keep me' } }, hiddenExerciseIds: ['g1', 'g2'], foods: { '7': { name: 'Stale' } } },
        history: [
            { id: 'w1', date: '2026-09-30', exercises: [] },
            { id: '__proto__', date: '2026-10-01', exercises: [] },
        ],
        nutrition: {
            '2026-09-30': { date: '2026-09-30', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] },
            '2026-10-01': { date: '2026-10-01', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] },
        },
    });

    it('matches a full projection filtered to root and monthly domain-operation scope', () => {
        const scopes: DocumentProjectionScope[] = [
            { rootKeys: new Set(['routines', 'profile']), monthly: new Map() },
            { rootKeys: new Set(['library', 'customFoods', 'catalogOverrides']), monthly: new Map() },
            { rootKeys: new Set(), monthly: new Map([
                ['history_months/2026-09', new Set(['w1'])],
                ['history_months/2026-10', new Set(['__proto__', 'missing'])],
            ]) },
            { rootKeys: new Set(['activeWorkout']), monthly: new Map([
                ['nutrition_months/2026-10', new Set(['2026-10-01', '2026-10-02'])],
            ]) },
        ];
        for (const scope of scopes) {
            const full = projectDocuments(before, withGlobalCatalog);
            const expected = new Map<string, Record<string, unknown>>();
            if (scope.rootKeys.size) {
                expected.set('', Object.fromEntries([...scope.rootKeys]
                    .filter(key => Object.hasOwn(full.get('') ?? {}, key))
                    .map(key => [key, full.get('')![key]])));
            }
            for (const [path, ids] of scope.monthly) {
                expected.set(path, Object.fromEntries([...ids]
                    .filter(id => Object.hasOwn(full.get(path) ?? {}, id))
                    .map(id => [id, full.get(path)![id]])));
            }
            expect(projectDocuments(before, withGlobalCatalog, scope)).toEqual(expected);
        }
    });

    it('keeps a nutrition-only projection independent from unrelated history shards', () => {
        const scope: DocumentProjectionScope = {
            rootKeys: new Set(),
            monthly: new Map([['nutrition_months/2026-10', new Set(['2026-10-01'])]]),
        };
        const projection = projectDocuments(before, withGlobalCatalog, scope);
        const full = projectDocuments(before, withGlobalCatalog);
        expect([...projection.keys()]).toEqual(['nutrition_months/2026-10']);
        expect(projection.get('nutrition_months/2026-10')).toEqual({
            '2026-10-01': full.get('nutrition_months/2026-10')!['2026-10-01'],
        });
    });

    it('preserves month transfer tombstones and does not emit unrelated paths', () => {
        const operation: DomainOperation = {
            type: 'history.upsert',
            workout: { id: 'w1', date: '2026-10-02', exercises: [] },
        };
        const after = applyDomainOperations(before, operation);
        const operations = compileDomainOperations(before, after, operation, withGlobalCatalog, 's00', 1, { s00: 1 });
        expect(operations.some(op => op.docPath === 'history_months/2026-09' && op.isDelete && op.path[0] === 'w1')).toBe(true);
        expect(operations.some(op => op.docPath === 'history_months/2026-10' && !op.isDelete && op.path[0] === 'w1')).toBe(true);
        expect(operations.every(op => op.path[0] === 'w1')).toBe(true);
    });

    it('rejects missing, foreign, and repeated reorder IDs while accepting a permutation', () => {
        const initial = base({ supplements: [
            { id: 's1', name: 'A', unit: 'g' },
            { id: 's2', name: 'B', unit: 'g' },
            { id: 's3', name: 'C', unit: 'g' },
        ] });
        expect(() => applyDomainOperations(initial, { type: 'supplement.reorder', ids: ['s1', 's2'] })).toThrow(/esattamente/i);
        expect(() => applyDomainOperations(initial, { type: 'supplement.reorder', ids: ['s1', 's2', 'other'] })).toThrow(/esattamente/i);
        expect(() => applyDomainOperations(initial, { type: 'supplement.reorder', ids: ['s1', 's1', 's2'] })).toThrow(/duplicato/i);
        expect(applyDomainOperations(initial, { type: 'supplement.reorder', ids: ['s3', 's1', 's2'] }).supplements?.map(s => s.id)).toEqual(['s3', 's1', 's2']);
    });

    it('fails closed for unknown runtime operation types in reducer and compiler', () => {
        const unknown = { type: 'future.operation' } as unknown as DomainOperation;
        expect(() => applyDomainOperations(before, unknown)).toThrow(/non supportata/);
        expect(() => compileDomainOperations(before, before, unknown, withGlobalCatalog, 's00', 1, { s00: 1 })).toThrow(/non supportata/);
    });
});
