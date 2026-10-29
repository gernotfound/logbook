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
    it('preserves interleaved original operation order inside one bounded group', () => {
        const input = [
            { ...operation('A', 1), value: 'A1' },
            { ...operation('B', 1), value: 'B1' },
            { ...operation('A', 1), value: 'A2' },
        ];
        const sequenced = sequenceOperationsForBoundedTransactions(input, 's00', 0, {});
        expect(sequenced.operations.map(op => op.value)).toEqual(['A1', 'B1', 'A2']);
        expect(sequenced.operations.every(op => op.seq === 1)).toBe(true);
    });

    it('preserves relative order inside each split group and keeps document operations atomic', () => {
        const paths = Array.from({ length: MAX_SYNC_DOCUMENTS_PER_TRANSACTION + 1 }, (_, i) => String(i));
        const input = [
            { ...operation(paths[0], 1), value: 'first' },
            { ...operation(paths[1], 1), value: 'second' },
            { ...operation(paths[0], 1), value: 'third' },
            ...paths.slice(2).map(path => operation(path, 1)),
        ];
        const { operations } = sequenceOperationsForBoundedTransactions(input, 's00', 0, {});
        expect(operations.filter(op => op.seq === 1).map(op => op.value))
            .toEqual(input.slice(0, -1).map(op => op.value));
        expect(distinctDocumentCount(operations.filter(op => op.seq === 1))).toBe(MAX_SYNC_DOCUMENTS_PER_TRANSACTION);
        expect(distinctDocumentCount(operations.filter(op => op.seq === 2))).toBe(1);
    });

    it('rejects unsafe sequence increments before producing a journal', () => {
        const limit = Number.MAX_SAFE_INTEGER;
        expect(() => sequenceOperationsForBoundedTransactions(
            [operation('a', 1)], 's00', limit, { s00: limit },
        )).toThrow('Sequenza sync esaurita');
        const pending = Array.from({ length: MAX_SYNC_DOCUMENTS_PER_TRANSACTION + 1 },
            (_, i) => operation(String(i), limit));
        expect(() => resequencePendingOperationsForBoundedTransactions(
            pending, 's00', limit, { s00: limit },
        )).toThrow('Sequenza sync esaurita');
        expect(pending.every(op => op.seq === limit)).toBe(true);
    });

    it('treats inherited actor coordinates as missing', () => {
        const result = sequenceOperationsForBoundedTransactions(
            [operation('a', 1, 'toString')], 'toString', 0, {},
        );
        expect(result.actorSeq).toBe(1);
        expect(Object.hasOwn(result.clock, 'toString')).toBe(true);
        expect(result.clock.toString).toBe(1);
    });

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
    it('matches the reference causal selection for interleaved and repeated sequences', () => {
        // Exact pre-refactor oracle: scan the entire pending array per sequence.
        const reference = (pending: SemanticOperation[], maxDocuments: number) => {
            const sequences = [...new Set(pending.map(item => item.seq))].sort((a, b) => a - b);
            const selected: SemanticOperation[] = [];
            const paths = new Set<string>();
            for (const sequence of sequences) {
                const group = pending.filter(item => item.seq === sequence);
                const groupPaths = new Set(group.map(item => item.docPath));
                const count = new Set([...paths, ...groupPaths]).size;
                if (selected.length && count > maxDocuments) break;
                if (!selected.length && count > maxDocuments) {
                    throw new Error(`Gruppo causale troppo grande: ${count} documenti, massimo ${maxDocuments}.`);
                }
                selected.push(...group);
                for (const path of groupPaths) paths.add(path);
            }
            return selected;
        };

        // Thousands of operations with non-contiguous sequence IDs and duplicate
        // document paths; unique values expose accidental intra-sequence reordering.
        const pairs: Array<[number, string]> = [
            [9, 'history/0'], [3, 'history/0'], [7, 'history/1'], [3, 'history/1'],
            [11, 'history/2'], [7, 'history/2'], [9, 'history/3'], [11, 'history/4'],
        ];
        const pending = Array.from({ length: 2048 }, (_, i) => {
            const [seq, path] = pairs[i % pairs.length];
            return { ...operation(path, seq), value: `edit-${i}` };
        });
        const originalValues = pending.map(item => item.value);
        for (const maxDocuments of [2, 3, 4, 5, 8]) {
            const expected = reference(pending, maxDocuments);
            const actual = boundedPendingTransactionBatch(pending, maxDocuments);
            expect(actual).toEqual(expected);
            expect(actual.map(item => item.value)).toEqual(expected.map(item => item.value));
            expect(distinctDocumentCount(actual)).toBeLessThanOrEqual(maxDocuments);
        }
        expect(() => boundedPendingTransactionBatch(pending, 1)).toThrow(
            'Gruppo causale troppo grande: 2 documenti, massimo 1.',
        );
        expect(pending.map(item => item.value)).toEqual(originalValues);
    });

    it('preserves sequence atomicity across deterministic mixed-order journal samples', () => {
        // Deterministic PRNG makes varied paths/order reproducible in CI.
        let seed = 42;
        const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
        for (let sample = 0; sample < 30; sample++) {
            const pending = Array.from({ length: 100 }, (_, index) => {
                const seq = 1 + Math.floor(next() * 12);
                const doc = 'nutrition/' + Math.floor(next() * 9);
                return { ...operation(doc, seq), value: 'sample-' + sample + '-' + index };
            });
            const reference = [...new Set(pending.map(op => op.seq))].sort((a, b) => a - b);
            const expected: SemanticOperation[] = [];
            const documents = new Set<string>();
            for (const seq of reference) {
                const group = pending.filter(op => op.seq === seq);
                const nextDocuments = new Set([...documents, ...group.map(op => op.docPath)]);
                if (expected.length && nextDocuments.size > 8) break;
                if (!expected.length && nextDocuments.size > 8) {
                    expect(() => boundedPendingTransactionBatch(pending)).toThrow('Gruppo causale troppo grande');
                    break;
                }
                expected.push(...group);
                for (const op of group) documents.add(op.docPath);
            }
            if (expected.length) expect(boundedPendingTransactionBatch(pending)).toEqual(expected);
        }
    });

});
