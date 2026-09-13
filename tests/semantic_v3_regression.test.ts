import { describe, expect, it } from 'vitest';
import {
    applySemanticOperations,
    diffDocuments,
    parseSyncMeta,
    type SemanticOperation
} from '../src/lib/sync/semanticProjection';
import type { DocumentData } from '../src/lib/sync/documentProjection';

const nutritionPath = 'nutrition_months/2026-09';
const date = '2026-09-13';

function nutritionDocs(day?: Record<string, unknown>) {
    return new Map<string, DocumentData>([[nutritionPath, day ? { [date]: day } : {}]]);
}

describe('Semantic Merge V3 regressions', () => {
    it('merges concurrent creation of different properties on the same new NutritionDay', () => {
        const base = nutritionDocs();
        const desiredA = nutritionDocs({ date, weight: 80 });
        const desiredB = nutritionDocs({
            date,
            meals: [{ id: 'm1', name: 'Mela', quantity: 100, baseQty: 100, kcal: 50, carbs: 12, pro: 0.3, fat: 0.2 }]
        });

        const opsA = diffDocuments(base, desiredA, 'A', 1, { A: 1 });
        const opsB = diffDocuments(base, desiredB, 'B', 1, { B: 1 });
        const ab = applySemanticOperations(base, [...opsA, ...opsB]);
        const ba = applySemanticOperations(base, [...opsB, ...opsA]);

        const dayAB = ab.documents.get(nutritionPath)?.[date] as any;
        const dayBA = ba.documents.get(nutritionPath)?.[date] as any;
        expect(dayAB.weight).toBe(80);
        expect(dayAB.meals).toHaveLength(1);
        expect(dayAB.meals[0].id).toBe('m1');
        expect(dayBA).toEqual(dayAB);
        expect(ba.syncMetas).toEqual(ab.syncMetas);
    });

    it('represents deletion of a monthly entity with a parent tombstone', () => {
        const base = nutritionDocs({ date, weight: 80, meals: [] });
        const desired = nutritionDocs();

        const ops = diffDocuments(base, desired, 'B', 1, { B: 1 });
        expect(ops).toEqual([expect.objectContaining({
            docPath: nutritionPath,
            path: [date],
            isDelete: true
        })]);

        const deleted = applySemanticOperations(base, ops);
        expect(deleted.documents.get(nutritionPath)?.[date]).toBeUndefined();
        expect(deleted.syncMetas[nutritionPath].fields[date]?.deleted).toBe(true);
    });

    it('blocks a concurrent stale child after parent deletion even when its actor would win the tie-break', () => {
        const base = nutritionDocs({ date, weight: 80, meals: [] });
        const deleteOp = diffDocuments(base, nutritionDocs(), 'B', 1, { B: 1 });
        const deleted = applySemanticOperations(base, deleteOp);

        const staleChild: SemanticOperation = {
            docPath: nutritionPath,
            path: [date, 'weight'],
            value: 90,
            isDelete: false,
            actorId: 'Z',
            seq: 1,
            clock: { Z: 1 }
        };
        const result = applySemanticOperations(deleted.documents, [staleChild], deleted.syncMetas);

        expect(result.documents.get(nutritionPath)?.[date]).toBeUndefined();
        expect(result.syncMetas[nutritionPath].clock.Z).toBe(1);
    });

    it('allows causally later recreation after observing the parent tombstone', () => {
        const base = nutritionDocs({ date, weight: 80, meals: [] });
        const deleteOps = diffDocuments(base, nutritionDocs(), 'B', 1, { B: 1 });
        const deleted = applySemanticOperations(base, deleteOps);

        const recreatedDesired = nutritionDocs({ date, weight: 82, meals: [] });
        const recreateOps = diffDocuments(nutritionDocs(), recreatedDesired, 'C', 1, { B: 1, C: 1 });
        const recreated = applySemanticOperations(deleted.documents, recreateOps, deleted.syncMetas);

        expect(recreated.documents.get(nutritionPath)?.[date]).toMatchObject({ date, weight: 82 });
    });

    it('requires a complete protocol-1 SyncMeta shape', () => {
        expect(() => parseSyncMeta({ protocolVersion: 1, clock: {} })).toThrow('fields');
        expect(() => parseSyncMeta({ protocolVersion: 1, fields: {} })).toThrow('clock');
        expect(() => parseSyncMeta({ protocolVersion: 1, clock: {}, fields: {
            'profile/name': { actorId: 'A', seq: 1 }
        } })).toThrow('field clock');
        expect(() => parseSyncMeta({ protocolVersion: 1, clock: { A: 1.5 }, fields: {} })).toThrow('seq');
        expect(() => parseSyncMeta({ protocolVersion: 2, clock: {}, fields: {} })).toThrow('Unsupported protocolVersion');
    });
});
