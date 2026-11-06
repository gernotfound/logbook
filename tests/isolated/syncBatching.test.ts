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
            { ...operation(paths[0], 1), value: 'last' },
        ];
        const before = structuredClone(input);
        const { operations } = sequenceOperationsForBoundedTransactions(input, 's00', 0, {});
        expect(operations.filter(op => op.seq === 1).map(op => op.value))
            .toEqual([...input.slice(0, -2).map(op => op.value), 'last']);
        expect(operations.filter(op => op.docPath === paths[0]).map(op => op.seq)).toEqual([1, 1, 1]);
        expect(input).toEqual(before);
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

    it('atomically resequences an oversized pending group without acknowledging later work early', () => {
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


    it('rejects invalid document limits at every non-empty batching boundary', () => {
        const input = [operation('doc-1', 1)];
        for (const maxDocuments of [0, -1, 1.5, NaN, Infinity]) {
            expect(() => sequenceOperationsForBoundedTransactions(input, 's00', 0, {}, maxDocuments))
                .toThrow('Limite documenti sync non valido');
            expect(() => resequencePendingOperationsForBoundedTransactions(input, 's00', 1, { s00: 1 }, maxDocuments))
                .toThrow('Limite documenti sync non valido');
            expect(() => boundedPendingTransactionBatch(input, maxDocuments))
                .toThrow('Limite documenti sync non valido');
        }
    });

    it('preserves empty source clocks and rejects mixed actor journals without changes', () => {
        const baseClock = { s00: 3, s01: 5 };
        const emptySequenced = sequenceOperationsForBoundedTransactions([], 's00', 3, baseClock);
        expect(emptySequenced).toEqual({ operations: [], actorSeq: 3, clock: baseClock });
        expect(emptySequenced.clock).not.toBe(baseClock);
        const emptyPending: SemanticOperation[] = [];
        const emptyResult = resequencePendingOperationsForBoundedTransactions(emptyPending, 's00', 3, baseClock);
        expect(emptyResult).toEqual({ operations: [], actorSeq: 3, clock: baseClock, changed: false });
        expect(emptyResult.operations).toBe(emptyPending);
        expect(emptyResult.clock).not.toBe(baseClock);
        expect(boundedPendingTransactionBatch([])).toEqual([]);

        const mixed = [operation('doc-1', 1, 's00'), operation('doc-2', 1, 's01')];
        const before = structuredClone(mixed);
        expect(() => resequencePendingOperationsForBoundedTransactions(mixed, 's00', 1, baseClock))
            .toThrow('Journal locale appartiene a un actor diverso');
        expect(mixed).toEqual(before);
    });

    it('keeps unchanged journals byte-for-byte equivalent and does not fabricate a resequence', () => {
        const input = [operation('doc-later', 5), operation('doc-earlier', 3)];
        const clock = { s00: 5, s01: 2 };
        const result = resequencePendingOperationsForBoundedTransactions(input, 's00', 5, clock);
        expect(result).toEqual({ operations: input, actorSeq: 5, clock, changed: false });
        expect(result.operations).toBe(input);
        expect(result.clock).not.toBe(clock);
    });

    it('orders re-assigned causal groups by original sequence, preserving remote clock coordinates', () => {
        const input = [
            { ...operation('last', 6), clock: { s00: 6, s01: 9 } },
            ...Array.from({ length: MAX_SYNC_DOCUMENTS_PER_TRANSACTION + 1 }, (_, index) => ({
                ...operation('doc-' + index, 5),
                clock: { s00: 5, s01: 9 },
            })),
        ];
        const before = structuredClone(input);
        const result = resequencePendingOperationsForBoundedTransactions(input, 's00', 6, { s00: 6, s01: 9 });
        expect(result.changed).toBe(true);
        expect(result.actorSeq).toBe(7);
        expect(result.clock).toEqual({ s00: 7, s01: 9 });
        expect(result.operations.map(item => ({ seq: item.seq, clock: item.clock }))).toEqual([
            ...Array.from({ length: MAX_SYNC_DOCUMENTS_PER_TRANSACTION }, () => ({
                seq: 5, clock: { s00: 5, s01: 9 },
            })),
            { seq: 6, clock: { s00: 6, s01: 9 } },
            { seq: 7, clock: { s00: 7, s01: 9 } },
        ]);
        expect(result.operations.at(-1)?.docPath).toBe('last');
        expect(input).toEqual(before);
    });


    it('rejects negative, non-integer or exhausted actor sequence coordinates before generating operations', () => {
        const operations = [operation('history_months/2026-01', 1)];
        for (const invalid of [-1, -100, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
            expect(() => sequenceOperationsForBoundedTransactions(
                operations, 's00', invalid, { s00: invalid },
            )).toThrow('Sequenza sync esaurita o non valida');
        }
    });

    it.each([
        { baseSeq: 3, baseClock: { s00: 5, s01: 9 } },
        { baseSeq: 5, baseClock: { s00: 3, s01: 9 } },
    ])('allocates after both the base counter and observed actor frontier: %j', ({ baseSeq, baseClock }) => {
        const input = [operation('nutrition_months/2026-01', 1)];
        const before = structuredClone(input);
        const observedClock = structuredClone(baseClock);
        const result = sequenceOperationsForBoundedTransactions(input, 's00', baseSeq, baseClock);
        expect(result).toEqual({
            actorSeq: 6,
            clock: { s00: 6, s01: 9 },
            operations: [{ ...before[0], seq: 6, clock: { s00: 6, s01: 9 } }],
        });
        expect(input).toEqual(before);
        expect(baseClock).toEqual(observedClock);
    });

});
