import { describe, expect, it } from 'vitest';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection';
import {
    distinctDocumentCount,
    boundedPendingTransactionBatch,
    MAX_SYNC_DOCUMENTS_PER_TRANSACTION,
    resequencePendingOperationsForBoundedTransactions,
    sequenceOperationsForBoundedTransactions,
} from '../../src/lib/sync/syncBatching';

const operation = (docPath: string, seq: number, actorId = 's00'): SemanticOperation => ({
    docPath,
    path: ['value'],
    isDelete: false,
    value: docPath,
    actorId,
    seq,
    clock: { [actorId]: seq },
});

describe('bounded causal sync batching', () => {
    it('splits a new multi-document change into complete causal groups below the transaction ceiling', () => {
        const input = Array.from({ length: MAX_SYNC_DOCUMENTS_PER_TRANSACTION + 2 }, (_, index) =>
            operation(`history_months/2026-${String(index + 1).padStart(2, '0')}`, 1),
        );

        const result = sequenceOperationsForBoundedTransactions(input, 's00', 0, {});

        expect(result.actorSeq).toBe(2);
        expect(result.clock).toEqual({ s00: 2 });

        const first = result.operations.filter(item => item.seq === 1);
        const second = result.operations.filter(item => item.seq === 2);
        expect(distinctDocumentCount(first)).toBe(MAX_SYNC_DOCUMENTS_PER_TRANSACTION);
        expect(distinctDocumentCount(second)).toBe(2);
        expect(first.every(item => item.clock.s00 === 1)).toBe(true);
        expect(second.every(item => item.clock.s00 === 2)).toBe(true);
    });

    it('never splits operations that target the same Firestore document', () => {
        const input = Array.from({ length: 50 }, (_, index): SemanticOperation => ({
            ...operation('history_months/2026-09', 4),
            path: ['workout-' + index],
        }));

        const result = sequenceOperationsForBoundedTransactions(input, 's00', 3, { s00: 3 });

        expect(result.actorSeq).toBe(4);
        expect(new Set(result.operations.map(item => item.seq))).toEqual(new Set([4]));
        expect(distinctDocumentCount(result.operations)).toBe(1);
    });

    it('atomically resequences an oversized legacy pending group without acknowledging later work early', () => {
        const oversized = Array.from({ length: MAX_SYNC_DOCUMENTS_PER_TRANSACTION + 1 }, (_, index) =>
            operation(`history_months/2025-${String(index + 1).padStart(2, '0')}`, 5),
        );
        const later = [operation('nutrition_months/2026-01', 6)];

        const result = resequencePendingOperationsForBoundedTransactions(
            [...oversized, ...later],
            's00',
            6,
            { s00: 6, s01: 3 },
        );

        expect(result.changed).toBe(true);
        expect(result.actorSeq).toBe(7);
        expect(result.clock).toEqual({ s00: 7, s01: 3 });

        const seq5 = result.operations.filter(item => item.seq === 5);
        const seq6 = result.operations.filter(item => item.seq === 6);
        const seq7 = result.operations.filter(item => item.seq === 7);
        expect(distinctDocumentCount(seq5)).toBe(MAX_SYNC_DOCUMENTS_PER_TRANSACTION);
        expect(distinctDocumentCount(seq6)).toBe(1);
        expect(seq7).toHaveLength(1);
        expect(seq7[0].docPath).toBe('nutrition_months/2026-01');
    });

    it('coalesces complete consecutive sequences while the transaction stays within the document ceiling', () => {
        const pending = [
            operation('history_months/2026-09', 3),
            { ...operation('users-root-placeholder', 3), path: ['profile', 'name'] },
            operation('nutrition_months/2026-09', 4),
            { ...operation('users-root-placeholder', 5), path: ['profile', 'height'] },
        ];

        const batch = boundedPendingTransactionBatch(pending);

        expect(batch).toHaveLength(4);
        expect(new Set(batch.map(item => item.seq))).toEqual(new Set([3, 4, 5]));
        expect(distinctDocumentCount(batch)).toBe(3);
    });

    it('stops before a later complete sequence would exceed the document ceiling', () => {
        const firstSequence = Array.from({ length: MAX_SYNC_DOCUMENTS_PER_TRANSACTION }, (_, index) =>
            operation(`history_months/2026-${String(index + 1).padStart(2, '0')}`, 3),
        );
        const laterSequence = [operation('nutrition_months/2026-12', 4)];

        const batch = boundedPendingTransactionBatch([...firstSequence, ...laterSequence]);

        expect(batch).toHaveLength(MAX_SYNC_DOCUMENTS_PER_TRANSACTION);
        expect(batch.every(item => item.seq === 3)).toBe(true);
        expect(distinctDocumentCount(batch)).toBe(MAX_SYNC_DOCUMENTS_PER_TRANSACTION);
    });
});
