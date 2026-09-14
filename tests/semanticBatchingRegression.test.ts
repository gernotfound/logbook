import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../src/lib/sync/documentProjection';
import { applySemanticOperations, type SemanticOperation } from '../src/lib/sync/semanticProjection';

const base = () => new Map<string, DocumentData>([
    ['', { profile: { height: '180' } }],
]);

const opA: SemanticOperation = {
    docPath: '',
    path: ['profile', 'height'],
    value: '181',
    isDelete: false,
    actorId: 'A',
    seq: 1,
    clock: { A: 1 },
};

const opB: SemanticOperation = {
    docPath: '',
    path: ['profile', 'height'],
    value: '182',
    isDelete: false,
    actorId: 'B',
    seq: 1,
    clock: { B: 1 },
};

describe('Semantic merge batching regression', () => {
    it('produces the same business and causal state whether concurrent contenders arrive together or separately', () => {
        const batched = applySemanticOperations(base(), [opA, opB]);

        const firstA = applySemanticOperations(base(), [opA]);
        const splitAB = applySemanticOperations(firstA.documents, [opB], firstA.syncMetas);

        const firstB = applySemanticOperations(base(), [opB]);
        const splitBA = applySemanticOperations(firstB.documents, [opA], firstB.syncMetas);

        expect(splitAB.documents).toEqual(batched.documents);
        expect(splitBA.documents).toEqual(batched.documents);
        expect(splitAB.syncMetas).toEqual(batched.syncMetas);
        expect(splitBA.syncMetas).toEqual(batched.syncMetas);
        expect(batched.syncMetas[''].fields['profile/height'].clock).toEqual({ A: 1, B: 1 });
    });
});
