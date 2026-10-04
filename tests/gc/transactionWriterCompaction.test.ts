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
            get: async (ref: { path: string }) => ref.path.endsWith('/sync_control/state')
                ? ({
                    exists: () => true,
                    data: () => ({
                        protocolVersion: 3,
                        replicas: {
                            s00: {
                                replicaId: 'replica-s00',
                                generation: 1,
                                status: 'active',
                                lastSeq: 0,
                                leaseUntilMs: Date.now() + 360 * 24 * 60 * 60 * 1000,
                                checkpointAtMs: Date.now(),
                                checkpointClock: {},
                            },
                        },
                        mutation: { slot: 's00', action: 'checkpoint' },
                    }),
                })
                : ({
                exists: () => true,
                data: () => ({
                    _schemaVersion: 1,
                    _sync: {
                        protocolVersion: 1,
                        clock: { legacy: 2 },
                        fields: {
                            '2026-09-14': { actorId: 'legacy', seq: 2, clock: { legacy: 2 }, deleted: true },
                            '2026-09-14/weight': { actorId: 'legacy', seq: 1, clock: { legacy: 1 } },
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
            actorId: 's00',
            seq: 1,
            clock: { s00: 1 },
        };

        const now = Date.now();
        const outcome = await applyDocumentChanges({} as any, 'user-a', [operation], () => true, {
            slot: 's00',
            replicaId: 'replica-s00',
            generation: 1,
            checkpointAtMs: now,
            leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        });

        expect(harness.writes).toHaveLength(2);
        expect(harness.writes.find(write => write.path.includes('nutrition_months'))!.deleted).not.toBe(true);
        expect(harness.writes.find(write => write.path.includes('nutrition_months'))!.data._sync.fields['2026-09-14']).toMatchObject({
            actorId: 'legacy',
            seq: 2,
            deleted: true,
            clock: { legacy: 2 },
            deleteClock: { legacy: 2 },
        });
        expect(harness.writes.find(write => write.path.includes('nutrition_months'))!.data._sync.clock).toEqual({ legacy: 2, s00: 1 });
        expect(harness.writes.find(write => write.path.includes('nutrition_months'))!.data._sync.fields['2026-09-14/weight']).toBeUndefined();

        expect(outcome.syncMeta['']).toBeUndefined();
        expect(outcome.syncMeta['nutrition_months/2026-09'].fields['2026-09-14']).toMatchObject({
            deleted: true,
            clock: { legacy: 2 },
            deleteClock: { legacy: 2 },
        });
        expect(outcome.syncMeta['nutrition_months/2026-09'].clock).toEqual({ legacy: 2, s00: 1 });
        expect(outcome.syncMeta['nutrition_months/2026-09'].fields['2026-09-14/weight']).toBeUndefined();
        expect(harness.checkDocSize).toHaveBeenCalledTimes(1);
    });
});
