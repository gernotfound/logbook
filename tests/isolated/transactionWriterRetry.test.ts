import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    attempts: [] as Array<Array<{ path: string, data?: any, deleted?: boolean }>>,
    checkDocSize: vi.fn(),
    now: 1_791_114_651_000,
}));

vi.mock('../../src/lib/checkDocSize', () => ({
    checkDocSize: harness.checkDocSize
}));

vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, path: string) => ({ path }),
    runTransaction: async (_db: unknown, callback: (tx: any) => Promise<any>) => {
        const runAttempt = async () => {
            const writes: Array<{ path: string, data?: any, deleted?: boolean }> = [];
            const transaction = {
                get: async (ref: { path: string }) => ref.path.endsWith('/sync_control/state')
                    ? ({
                        exists: () => true,
                        data: () => ({
                            protocolVersion: 3,
                            replicas: {
                                s00: {
                                    replicaId: 'replica-a',
                                    generation: 1,
                                    status: 'active',
                                    lastSeq: 0,
                                    leaseUntilMs: harness.now + 360 * 24 * 60 * 60 * 1000,
                                    checkpointAtMs: harness.now,
                                    checkpointClock: {},
                                },
                            },
                            mutation: { slot: 's00', action: 'checkpoint' },
                        }),
                    })
                    : ({
                        exists: () => true,
                        data: () => ({
                            profile: { height: '170' },
                            _sync: { protocolVersion: 3, clock: {}, fields: {} }
                        })
                    }),
                set: (ref: { path: string }, data: any) => writes.push({ path: ref.path, data: structuredClone(data) }),
                delete: (ref: { path: string }) => writes.push({ path: ref.path, deleted: true })
            };
            const result = await callback(transaction);
            harness.attempts.push(writes);
            return result;
        };

        // Firestore is allowed to re-run the callback. The first attempt is discarded.
        await runAttempt();
        return runAttempt();
    }
}));

import { applyDocumentChanges } from '../../src/lib/sync/transactionWriter';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection';

describe('transaction writer retry safety', () => {
    it('produces byte-equivalent writes when Firestore re-runs the transaction callback', async () => {
        harness.attempts.length = 0;
        harness.checkDocSize.mockClear();
        const ops: SemanticOperation[] = [{
            docPath: '',
            path: ['profile', 'height'],
            value: '171',
            isDelete: false,
            actorId: 's00',
            seq: 1,
            clock: { s00: 1 }
        }];

        const now = Date.now();
        const outcome = await applyDocumentChanges({} as any, 'user-a', ops, () => true, {
            slot: 's00',
            replicaId: 'replica-a',
            generation: 1,
            checkpointAtMs: now,
            leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        });

        expect(harness.attempts).toHaveLength(2);
        expect(harness.attempts[1]).toEqual(harness.attempts[0]);
        expect(harness.attempts[0]).toHaveLength(2);
        const businessWrite = harness.attempts[0].find(write => write.path === 'users/user-a');
        const controlWrite = harness.attempts[0].find(write => write.path.endsWith('/sync_control/state'));
        expect(businessWrite?.data.profile.height).toBe('171');
        expect(controlWrite?.data.replicas.s00.lastSeq).toBe(1);
        expect(businessWrite?.data._sync.writer).toMatchObject({
            slot: 's00', replicaId: 'replica-a', generation: 1, seq: 1,
        });
        expect(businessWrite?.data._sync.fields['profile/height']).toMatchObject({
            actorId: 's00',
            seq: 1,
            clock: { s00: 1 }
        });
        expect(outcome.syncMeta[''].fields['profile/height'].seq).toBe(1);

        // Size checks happen once per callback attempt, after _sync has been attached.
        expect(harness.checkDocSize).toHaveBeenCalledTimes(2);
        for (const [payload] of harness.checkDocSize.mock.calls) {
            expect(payload._sync.fields['profile/height']).toMatchObject({ actorId: 's00', seq: 1 });
        }
    });
});
