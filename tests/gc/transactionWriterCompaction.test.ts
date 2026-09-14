import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    writes: [] as Array<{ path: string, data?: any, deleted?: boolean }>,
    checkDocSize: vi.fn(),
}));

vi.mock('../../src/lib/checkDocSize', () => ({ checkDocSize: harness.checkDocSize }));

vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, path: string) => ({ path }),
    runTransaction: async (_db: unknown, callback: (tx: any) => Promise<any>) => {
        harness.writes.length = 0;
        const transaction = {
            get: async (_ref: { path: string }) => ({
                exists: () => true,
                data: () => ({
                    _schemaVersion: 1,
                    _sync: {
                        protocolVersion: 1,
                        clock: { A: 2 },
                        fields: {
                            '2026-09-14': { actorId: 'A', seq: 2, clock: { A: 2 }, deleted: true },
                            '2026-09-14/weight': { actorId: 'A', seq: 1, clock: { A: 1 } },
                        },
                    },
                }),
            }),
            set: (ref: { path: string }, data: any) => harness.writes.push({ path: ref.path, data: structuredClone(data) }),
            delete: (ref: { path: string }) => harness.writes.push({ path: ref.path, deleted: true }),
        };
        return callback(transaction);
    },
}));

import { applyDocumentChanges } from '../../src/lib/sync/transactionWriter';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection';

describe('M4 transaction write-boundary compaction', () => {
    it('persists the terminal tombstone while removing a causally summarized descendant stamp', async () => {
        harness.checkDocSize.mockClear();
        const operation: SemanticOperation = {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-14', 'weight'],
            value: 80,
            isDelete: false,
            actorId: 'B',
            seq: 1,
            clock: { B: 1 },
        };

        const outcome = await applyDocumentChanges({} as any, 'user-a', [operation], () => true);

        expect(harness.writes).toHaveLength(1);
        expect(harness.writes[0].deleted).not.toBe(true);
        expect(harness.writes[0].data._sync.fields['2026-09-14']).toMatchObject({
            actorId: 'A',
            seq: 2,
            deleted: true,
            clock: { A: 2, B: 1 },
        });
        expect(harness.writes[0].data._sync.fields['2026-09-14/weight']).toBeUndefined();

        expect(outcome.syncMeta[''].fields).toBeUndefined();
        expect(outcome.syncMeta['nutrition_months/2026-09'].fields['2026-09-14']).toMatchObject({
            deleted: true,
            clock: { A: 2, B: 1 },
        });
        expect(outcome.syncMeta['nutrition_months/2026-09'].fields['2026-09-14/weight']).toBeUndefined();
        expect(harness.checkDocSize).toHaveBeenCalledTimes(1);
    });
});
