import { describe, expect, it } from 'vitest';
import { enforceMonthlyEntityTombstones } from '../../src/lib/sync/monthlyEntityTombstones';
import type { DocumentData } from '../../src/lib/sync/documentProjection';
import type { SemanticOperation, VectorClock } from '../../src/lib/sync/semanticProjection';

const clock: VectorClock = { replica: 8, peer: 5 };
const edit = (docPath: string, path: string[]): SemanticOperation => ({
    docPath, path, actorId: 'replica', seq: 8, clock, isDelete: false, value: path.join('/'),
});

// Identical to the previous production implementation: a trusted reference oracle.
function previous(
    base: Map<string, DocumentData>, desired: Map<string, DocumentData>, input: SemanticOperation[],
): SemanticOperation[] {
    let result = [...input];
    const paths = new Set([...base.keys(), ...desired.keys()]);
    for (const docPath of paths) {
        if (!docPath.startsWith('history_months/') && !docPath.startsWith('nutrition_months/')) continue;
        const source = base.get(docPath) ?? {};
        const target = desired.get(docPath) ?? {};
        for (const id of Object.keys(source)) {
            if (Object.hasOwn(target, id)) continue;
            result = result.filter(op => !(op.docPath === docPath && op.path[0] === id));
            result.push({ docPath, path: [id], isDelete: true, actorId: 'replica', seq: 8, clock });
        }
    }
    return result;
}

describe('monthly tombstone assembly equivalence', () => {
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
        expect(actual).toEqual(previous(base, desired, original));
        expect(actual.slice(0, 3)).toEqual([original[1], original[3], original[5]]);
        expect(actual.slice(3).map(op => op.path)).toEqual([['workoutA'], ['dayA']]);
        expect(original).toEqual(snapshot);
    });

    it('matches the prior implementation on 24 shards and thousands of mixed operations', () => {
        const base = new Map<string, DocumentData>();
        const desired = new Map<string, DocumentData>();
        const input: SemanticOperation[] = [edit('', ['profile', 'height'])];
        for (let month = 1; month <= 12; month++) {
            for (const kind of ['history', 'nutrition']) {
                const path = `${kind}_months/2026-${String(month).padStart(2, '0')}`;
                const source: DocumentData = {};
                const target: DocumentData = {};
                for (let n = 0; n < 65; n++) {
                    const key = 'entity-' + n;
                    source[key] = { amount: n };
                    if (n % 4 === 0) target[key] = { amount: n + 1 };
                    input.push(edit(path, [key, 'amount']), edit(path, [key, 'extra']));
                }
                base.set(path, source);
                desired.set(path, target);
            }
        }
        const snapshot = structuredClone(input);
        const actual = enforceMonthlyEntityTombstones(base, desired, input, 'replica', 8, clock);
        expect(actual).toEqual(previous(base, desired, input));
        expect(actual.filter(op => op.isDelete)).toHaveLength(24 * 48);
        expect(input).toEqual(snapshot);
    });

    it('does not invent tombstones for retained or newly added entities', () => {
        const base = new Map<string, DocumentData>([['nutrition_months/2026-09', { retained: 1 }]]);
        const desired = new Map<string, DocumentData>([['nutrition_months/2026-09', { retained: 2, newDay: 3 }]]);
        const operations = [edit('nutrition_months/2026-09', ['retained']), edit('nutrition_months/2026-09', ['newDay'])];
        expect(enforceMonthlyEntityTombstones(base, desired, operations, 'replica', 8, clock)).toEqual(operations);
    });
});
