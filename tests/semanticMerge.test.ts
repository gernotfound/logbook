import { describe, it, expect } from 'vitest';
import { type SemanticOperation, type VectorClock, diffDocuments, applySemanticOperations, stampWins } from '../src/lib/sync/semanticProjection';
import { type DocumentData } from '../src/lib/sync/documentProjection';

describe('Semantic Merge & Diffing V3', () => {
    it('generates atomic and ordered-keyed ops correctly', () => {
        const base = new Map<string, DocumentData>([
            ['', { profile: { name: 'A' }, routines: [{ id: '1', name: 'R1' }] }]
        ]);
        const desired = new Map<string, DocumentData>([
            ['', { profile: { name: 'B' }, routines: [{ id: '1', name: 'R1 Mod' }, { id: '2', name: 'R2' }] }]
        ]);

        const ops = diffDocuments(base, desired, 'actor1', 1, { 'actor1': 1 });
        
        expect(ops).toHaveLength(3); // profile, routine 1 mod, routine 2 add
        const profileOp = ops.find(o => o.property === 'profile');
        expect(profileOp?.value).toEqual({ name: 'B' });
        expect(profileOp?.itemId).toBeUndefined();

        const r1Op = ops.find(o => o.property === 'routines' && o.itemId === '1');
        expect(r1Op?.value).toEqual({ id: '1', name: 'R1 Mod', $order: 0 });
    });

    it('resolves concurrent deletes (Delete Wins)', () => {
        // Device A deletes R1
        const opDel: SemanticOperation = {
            actorId: 'A', seq: 1, clock: { A: 1 },
            docPath: '', property: 'routines', itemId: '1',
            value: null, isDelete: true
        };
        // Device B modifies R1 (concurrent)
        const opMod: SemanticOperation = {
            actorId: 'B', seq: 1, clock: { B: 1 },
            docPath: '', property: 'routines', itemId: '1',
            value: { id: '1', name: 'R1 Mod' }, isDelete: false
        };

        expect(stampWins(opDel, opMod)).toBe(true);
        expect(stampWins(opMod, opDel)).toBe(false);
    });

    it('resolves causal overwrite of delete (Create after Delete)', () => {
        const opDel: SemanticOperation = {
            actorId: 'A', seq: 1, clock: { A: 1 },
            docPath: '', property: 'routines', itemId: '1',
            value: null, isDelete: true
        };
        // Device B saw A's delete, and creates a new R1
        const opCreate: SemanticOperation = {
            actorId: 'B', seq: 1, clock: { A: 1, B: 1 },
            docPath: '', property: 'routines', itemId: '1',
            value: { id: '1', name: 'R1 Recreated' }, isDelete: false
        };

        // opCreate dominates opDel
        expect(stampWins(opCreate, opDel)).toBe(true);
        expect(stampWins(opDel, opCreate)).toBe(false);
    });

    it('applies ops commutatively (A->B == B->A)', () => {
        const base = new Map<string, DocumentData>();
        base.set('', { profile: { name: 'State Base' } });

        const opA: SemanticOperation = {
            docPath: '', property: 'profile', value: { name: 'State A' }, isDelete: false,
            actorId: 'client-A', seq: 1, clock: { 'client-A': 1 }
        };
        const opB: SemanticOperation = {
            docPath: '', property: 'profile', value: { name: 'State B' }, isDelete: false,
            actorId: 'client-B', seq: 2, clock: { 'client-A': 1, 'client-B': 2 }
        };

        const res1 = applySemanticOperations(base, [opA, opB]);
        const res2 = applySemanticOperations(base, [opB, opA]);

        expect(res1.documents.get('')?.profile).toEqual({ name: 'State B' });
        expect(res2.documents.get('')?.profile).toEqual({ name: 'State B' });
        expect(res1.documents).toEqual(res2.documents);
        expect(res1.syncMetas).toEqual(res2.syncMetas);
    });
});
