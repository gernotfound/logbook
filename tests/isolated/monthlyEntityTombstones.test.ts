import { describe, expect, it } from 'vitest';
import { enforceMonthlyEntityTombstones } from '../../src/lib/sync/monthlyEntityTombstones';
import type { DocumentData } from '../../src/lib/sync/documentProjection';
import type { SemanticOperation, VectorClock } from '../../src/lib/sync/semanticProjection';

const clock: VectorClock = { replica: 8, peer: 5 };
const edit = (docPath: string, path: string[]): SemanticOperation => ({
    docPath, path, actorId: 'replica', seq: 8, clock, isDelete: false, value: path.join('/'),
});

describe('monthly tombstone assembly invariants', () => {
    it('preserves order and replaces all child operations of removed entities', () => {
        const base = new Map<string, DocumentData>([
            ['history_months/2026-10', { workoutA: { sets: 3 }, workoutB: { sets: 2 } }],
            ['nutrition_months/2026-10', { dayA: { weight: 80 }, dayB: { weight: 81 } }],
            ['', { profile: { name: 'A' } }],
        ]);
        const desired = new Map<string, DocumentData>([
            ['history_months/2026-10', { workoutB: { sets: 4 } }],
            ['nutrition_months/2026-10', { dayB: { weight: 82 } }],
            ['', {}],
        ]);
        const original = [
            edit('history_months/2026-10', ['workoutA', 'sets']),
            edit('', ['profile', 'name']),
            edit('nutrition_months/2026-10', ['dayA', 'weight']),
            edit('history_months/2026-10', ['workoutB', 'sets']),
            edit('history_months/2026-10', ['workoutA']),
            edit('nutrition_months/2026-10', ['dayB', 'weight']),
        ];
        const snapshot = structuredClone(original);
        const actual = enforceMonthlyEntityTombstones(base, desired, original, 'replica', 8, clock);
        expect(actual).toEqual([
            original[1], original[3], original[5],
            { docPath: 'history_months/2026-10', path: ['workoutA'], isDelete: true, actorId: 'replica', seq: 8, clock },
            { docPath: 'nutrition_months/2026-10', path: ['dayA'], isDelete: true, actorId: 'replica', seq: 8, clock },
        ]);
        expect(original).toEqual(snapshot);
    });

    it('preserves surviving operations and emits exactly the expected 24-shard tombstones', () => {
        const base = new Map<string, DocumentData>();
        const desired = new Map<string, DocumentData>();
        const input: SemanticOperation[] = [edit('', ['profile', 'height'])];
        const expectedDeletes: string[] = [];
        for (let month = 1; month <= 12; month++) {
            for (const kind of ['history', 'nutrition']) {
                const path = `${kind}_months/2026-${String(month).padStart(2, '0')}`;
                const source: DocumentData = {};
                const target: DocumentData = {};
                for (let n = 0; n < 65; n++) {
                    const key = 'entity-' + n;
                    source[key] = { amount: n };
                    if (n % 4 === 0) target[key] = { amount: n + 1 };
                    else expectedDeletes.push(`${path}/${key}`);
                    input.push(edit(path, [key, 'amount']), edit(path, [key, 'extra']));
                }
                base.set(path, source);
                desired.set(path, target);
            }
        }
        const snapshot = structuredClone(input);
        const actual = enforceMonthlyEntityTombstones(base, desired, input, 'replica', 8, clock);
        const surviving = input.filter(op =>
            op.docPath === '' || Number(op.path[0].slice('entity-'.length)) % 4 === 0,
        );
        expect(actual.slice(0, surviving.length)).toEqual(surviving);
        const deleted = actual.slice(surviving.length);
        expect(deleted.map(op => `${op.docPath}/${op.path.join('/')}`)).toEqual(expectedDeletes);
        expect(deleted).toHaveLength(24 * 48);
        expect(deleted.every(op => op.isDelete && op.actorId === 'replica'
            && op.seq === 8 && op.path.length === 1)).toBe(true);
        // Causal contents are contractual; clock allocation identity is incidental.
        expect(deleted.map(op => op.clock)).toEqual(expectedDeletes.map(() => ({ replica: 8, peer: 5 })));
        expect(input).toEqual(snapshot);
    });

    it('does not invent tombstones for retained or newly added entities', () => {
        const base = new Map<string, DocumentData>([['nutrition_months/2026-09', { retained: 1 }]]);
        const desired = new Map<string, DocumentData>([['nutrition_months/2026-09', { retained: 2, newDay: 3 }]]);
        const operations = [edit('nutrition_months/2026-09', ['retained']), edit('nutrition_months/2026-09', ['newDay'])];
        expect(enforceMonthlyEntityTombstones(base, desired, operations, 'replica', 8, clock)).toEqual(operations);
    });
});
