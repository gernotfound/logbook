import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    writes: [] as Array<{ path: string, data?: any, deleted?: boolean }>,
    checkDocSize: vi.fn(),
    checkpointClock: {} as Record<string, number>,
    lastSeq: 0,
    remoteDocument: null as Record<string, unknown> | null,
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
                                lastSeq: harness.lastSeq,
                                leaseUntilMs: Date.now() + 360 * 24 * 60 * 60 * 1000,
                                checkpointAtMs: Date.now(),
                                checkpointClock: harness.checkpointClock,
                            },
                            // Historical slot can be retired while its causal dot
                            // remains necessary until all active replicas acknowledge it.
                            s01: {
                                replicaId: 'retired-s01',
                                generation: 1,
                                status: 'retired',
                                lastSeq: 2,
                                leaseUntilMs: Date.now() - 24 * 60 * 60 * 1000,
                                checkpointAtMs: Date.now() - 360 * 24 * 60 * 60 * 1000,
                                checkpointClock: { s01: 2 },
                            },
                            s02: {
                                replicaId: 'retired-s02', generation: 1, status: 'retired', lastSeq: 1,
                                leaseUntilMs: Date.now() - 24 * 60 * 60 * 1000,
                                checkpointAtMs: Date.now() - 360 * 24 * 60 * 60 * 1000,
                                checkpointClock: { s02: 1 },
                            },
                        },
                        mutation: { slot: 's00', action: 'checkpoint' },
                    }),
                })
                : ({
                exists: () => true,
                data: () => harness.remoteDocument,
            }),
            set: (ref: { path: string }, data: any) => harness.writes.push({ path: ref.path, data: structuredClone(data) }),
            delete: (ref: { path: string }) => harness.writes.push({ path: ref.path, deleted: true }),
        };
        return callback(transaction);
    },
}));

import { applyDocumentChanges } from '../../src/lib/sync/transactionWriter';
import { sealCloudDocument, openCloudDocument } from '../../src/lib/sync/cloudDocumentCipher';
import { applySemanticOperations, type SemanticOperation } from '../../src/lib/sync/semanticProjection';

const cloudKey = new Uint8Array(32).fill(18);
describe('M4 transaction write-boundary compaction', () => {
    beforeEach(() => {
        harness.checkpointClock = {};
        harness.lastSeq = 0;
        harness.remoteDocument = sealCloudDocument(cloudKey, 'user-a', 'nutrition_months/2026-09', {}, {
            protocolVersion: 3,
            clock: { s01: 2 },
            fields: {
                '2026-09-14': { actorId: 's01', seq: 2, clock: { s01: 2 }, deleted: true },
                '2026-09-14/weight': { actorId: 's01', seq: 1, clock: { s01: 1 } },
            },
            writer: { slot: 's00', replicaId: 'replica-s00', generation: 1, seq: 0 },
        });
        harness.checkDocSize.mockClear();
    });
    it('persists the terminal tombstone while removing a causally summarized descendant stamp', async () => {
        harness.checkDocSize.mockClear();
        harness.checkpointClock = {};
        harness.lastSeq = 0;
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
        }, cloudKey);

        expect(harness.writes).toHaveLength(2);
        expect(harness.writes.find(write => write.path.includes('nutrition_months'))!.deleted).not.toBe(true);
        const written = harness.writes.find(write => write.path.includes('nutrition_months'))!.data;
        expect(written._sync.fields).toEqual({});
        const read = openCloudDocument(cloudKey, 'user-a', 'nutrition_months/2026-09', written);
        expect(read.sync.fields['2026-09-14']).toMatchObject({
            actorId: 's01',
            seq: 2,
            deleted: true,
            clock: { s01: 2 },
            deleteClock: { s01: 2 },
        });
        expect(read.sync.clock).toEqual({ s01: 2, s00: 1 });
        expect(read.sync.fields['2026-09-14/weight']).toBeUndefined();

        expect(outcome.syncMeta['']).toBeUndefined();
        expect(outcome.syncMeta['nutrition_months/2026-09'].fields['2026-09-14']).toMatchObject({
            deleted: true,
            clock: { s01: 2 },
            deleteClock: { s01: 2 },
        });
        expect(outcome.syncMeta['nutrition_months/2026-09'].clock).toEqual({ s01: 2, s00: 1 });
        expect(outcome.syncMeta['nutrition_months/2026-09'].fields['2026-09-14/weight']).toBeUndefined();
        expect(harness.checkDocSize).toHaveBeenCalledTimes(1);
    });

    it('persists a fenced empty shell after stable-frontier retirement instead of issuing an un-attributed delete', async () => {
        harness.checkDocSize.mockClear();
        harness.checkpointClock = { s01: 2, s00: 1 };
        harness.lastSeq = 1;

        const duplicateBlockedOperation: SemanticOperation = {
            docPath: 'nutrition_months/2026-09',
            path: ['2026-09-14', 'weight'],
            value: 80,
            isDelete: false,
            actorId: 's00',
            seq: 1,
            clock: { s00: 1 },
        };

        const now = Date.now();
        const outcome = await applyDocumentChanges({} as any, 'user-a', [duplicateBlockedOperation], () => true, {
            slot: 's00',
            replicaId: 'replica-s00',
            generation: 1,
            checkpointAtMs: now,
            leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        }, cloudKey);

        const documentWrite = harness.writes.find(write => write.path.includes('nutrition_months'))!;
        expect(documentWrite.deleted).not.toBe(true);
        expect(documentWrite.data).toMatchObject({
            _schemaVersion: 1,
            _sync: {
                protocolVersion: 3,
                clock: { s01: 2, s00: 1 },
                fields: {},
                writer: { slot: 's00', replicaId: 'replica-s00', generation: 1, seq: 1 },
            },
        });
        expect(Object.keys(documentWrite.data).sort()).toEqual(['_schemaVersion', '_sealed', '_sync']);
        expect(openCloudDocument(cloudKey, 'user-a', 'nutrition_months/2026-09', documentWrite.data).sync.fields).toEqual({});
        expect(outcome.syncMeta['nutrition_months/2026-09'].fields).toEqual({});
        expect(harness.writes.some(write => write.deleted)).toBe(false);
    });

    it('persists every descendant delete event and returns that same barrier to acknowledgement', async () => {
        const path = 'nutrition_months/2026-09';
        harness.checkpointClock = { s00: 1, s01: 1 };
        harness.lastSeq = 1;
        harness.remoteDocument = sealCloudDocument(cloudKey, 'user-a', path, {}, {
            protocolVersion: 3,
            clock: { s00: 1, s01: 1, s02: 1 },
            fields: {
                '2026-09-14': {
                    actorId: 's00', seq: 1, clock: { s00: 1, s01: 1 },
                    deleted: true, deleteClock: { s00: 1, s01: 1 },
                },
                '2026-09-14/meals': {
                    actorId: 's01', seq: 1, clock: { s01: 1 },
                    deleted: true, deleteClock: { s01: 1, s02: 1 },
                },
            },
            writer: { slot: 's00', replicaId: 'replica-s00', generation: 1, seq: 1 },
        });
        const operation: SemanticOperation = {
            docPath: path, path: ['2026-09-14', 'meals'], value: [], isDelete: false,
            actorId: 's00', seq: 2, clock: { s00: 2, s01: 1 },
        };
        const now = Date.now();
        const outcome = await applyDocumentChanges({} as any, 'user-a', [operation], () => true, {
            slot: 's00', replicaId: 'replica-s00', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        }, cloudKey);

        expect(outcome.documents.get(path)).toEqual({});
        expect(harness.writes).toHaveLength(2);
        const written = harness.writes.find(write => write.path.endsWith(path))!;
        expect(written.deleted).not.toBe(true);
        expect(written.data._sync.fields).toEqual({});
        const restored = openCloudDocument(cloudKey, 'user-a', path, written.data);
        expect(restored.sync).toEqual(outcome.syncMeta[path]);
        expect(restored.sync.fields['2026-09-14/meals']).toMatchObject({
            clock: { s01: 1 }, deleted: true, deleteClock: { s01: 1, s02: 1 },
        });
        expect(restored.sync.fields['2026-09-14']).toBeDefined();
        expect(restored.sync.clock).toEqual({ s00: 2, s01: 1, s02: 1 });
        expect(restored.sync.writer?.seq).toBe(2);

        const unobservedDeleteReplay: SemanticOperation = {
            docPath: path, path: ['2026-09-14', 'meals'], value: [], isDelete: false,
            actorId: 's03', seq: 1, clock: { s00: 1, s01: 1, s03: 1 },
        };
        const replay = applySemanticOperations(
            outcome.documents, [unobservedDeleteReplay], { [path]: restored.sync },
        );
        expect(replay.documents).toEqual(outcome.documents);
        expect(replay.syncMetas[path].fields['2026-09-14/meals'].deleteClock)
            .toEqual({ s01: 1, s02: 1 });
    });

});
