import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    attempts: [] as Array<Array<{ path: string, data?: any, deleted?: boolean }>>,
    checkDocSize: vi.fn(),
    now: 1_791_114_651_000,
    remoteDocument: null as Record<string, unknown> | null,
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
                        data: () => harness.remoteDocument ?? ({
                            profile: { height: '170' },
                            _schemaVersion: 1,
                            _sync: {
                                protocolVersion: 3,
                                clock: {},
                                fields: {},
                                writer: { slot: 's00', replicaId: 'replica-a', generation: 1, seq: 0 },
                            },
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
import { openCloudDocument, sealCloudDocument, CloudCiphertextError } from '../../src/lib/sync/cloudDocumentCipher';

describe('transaction writer retry safety', () => {
    afterEach(() => { harness.remoteDocument = null; });
    it('keeps authenticated causal semantics and one batch identity across transaction retries', async () => {
        const key = new Uint8Array(32).fill(18);
        harness.remoteDocument = sealCloudDocument(key, 'user-a', '', { profile: { height: '170' } }, {
            protocolVersion: 3, clock: {}, fields: {},
            writer: { slot: 's00', replicaId: 'replica-a', generation: 1, seq: 0 },
        });
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
        }, key);

        expect(harness.attempts).toHaveLength(2);
        expect(harness.attempts[0]).toHaveLength(2);
        const openAttempt = (index: number) => {
            const writes = harness.attempts[index];
            const sealed = writes.find(write => write.path === 'users/user-a')?.data;
            const control = writes.find(write => write.path.endsWith('/sync_control/state'))?.data;
            return { opened: openCloudDocument(key, 'user-a', '', sealed), control };
        };
        expect(openAttempt(1)).toEqual(openAttempt(0));
        const businessWrite = harness.attempts[0].find(write => write.path === 'users/user-a');
        const controlWrite = harness.attempts[0].find(write => write.path.endsWith('/sync_control/state'));
        expect(businessWrite?.data).not.toHaveProperty('profile');
        expect(openCloudDocument(key, 'user-a', '', businessWrite?.data).business.profile.height).toBe('171');
        expect(controlWrite?.data.replicas.s00.lastSeq).toBe(1);
        expect(controlWrite?.data.mutation.batchId).toMatch(/^sync-advance_/);
        expect(businessWrite?.data._sync.writer).toMatchObject({
            slot: 's00', replicaId: 'replica-a', generation: 1, seq: 1,
        });
        expect(openCloudDocument(key, 'user-a', '', businessWrite?.data).sync.fields['profile/height']).toMatchObject({
            actorId: 's00',
            seq: 1,
            clock: { s00: 1 }
        });
        expect(outcome.syncMeta[''].fields['profile/height'].seq).toBe(1);

        // Each encrypted attempt is checked for final encoded Firestore size.
        expect(harness.checkDocSize).toHaveBeenCalledTimes(2);
        for (const [payload] of harness.checkDocSize.mock.calls) {
            expect(payload._sealed.ciphertext).toBeTruthy();
            expect(payload._sync.fields).toEqual({});
            expect(payload).not.toHaveProperty('profile');
        }
    });
    it('encrypts business and causal fields on BOTH Firestore transaction retries without leaking plaintext', async () => {
        const key = crypto.getRandomValues(new Uint8Array(32));
        harness.remoteDocument = sealCloudDocument(key, 'user-a', '', { profile: { height: '170' } }, {
            protocolVersion: 3, clock: {}, fields: {},
            writer: { slot: 's00', replicaId: 'replica-a', generation: 1, seq: 0 },
        });
        harness.attempts.length = 0;
        harness.checkDocSize.mockClear();
        const ops: SemanticOperation[] = [{
            docPath: '', path: ['profile', 'height'], value: 'secret medical note',
            isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        }];
        try {
            const now = Date.now();
            const result = await applyDocumentChanges({} as any, 'user-a', ops, () => true, {
                slot: 's00', replicaId: 'replica-a', generation: 1,
                checkpointAtMs: now, leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
            }, key);
            expect(harness.attempts).toHaveLength(2);
            const decoded = harness.attempts.map(writes => {
                const business = writes.find(write => write.path === 'users/user-a')?.data;
                const control = writes.find(write => write.path.endsWith('/sync_control/state'))?.data;
                expect(business).toBeDefined();
                expect(business).not.toHaveProperty('profile');
                expect(business._sync.fields).toEqual({});
                expect(JSON.stringify(business)).not.toContain('secret medical note');
                expect(control.mutation.batchId).toMatch(/^sync-advance_/);
                return { read: openCloudDocument(key, 'user-a', '', business), control };
            });
            expect(decoded[0].read).toEqual(decoded[1].read);
            expect(decoded[0].control).toEqual(decoded[1].control);
            expect(decoded[0].read.business.profile).toEqual({ height: 'secret medical note' });
            expect(decoded[0].read.sync.fields['profile/height'].seq).toBe(1);
            expect(result.syncMeta[''].fields['profile/height'].seq).toBe(1);
            // Each retry may produce fresh AEAD bytes without breaking the
            // Firestore batchId or causal idempotency. Size measured post-seal.
            expect(harness.checkDocSize).toHaveBeenCalledTimes(2);
            for (const [payload] of harness.checkDocSize.mock.calls) {
                expect(payload._sealed.ciphertext).toBeTruthy();
                expect(payload).not.toHaveProperty('profile');
            }
        } finally {
            harness.remoteDocument = null;
        }
    });

    it('refuses a plaintext or corrupted remote doc when an account ADK is supplied', async () => {
        const key = crypto.getRandomValues(new Uint8Array(32));
        const ops: SemanticOperation[] = [{
            docPath: '', path: ['profile', 'height'], value: 'new',
            isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
        }];
        const now = Date.now();
        const replica = {
            slot: 's00', replicaId: 'replica-a', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        };
        try {
            harness.remoteDocument = {
                profile: { height: 'plaintext' }, _schemaVersion: 1,
                _sync: { protocolVersion: 3, clock: {}, fields: {},
                    writer: { slot: 's00', replicaId: 'replica-a', generation: 1, seq: 0 } },
            };
            harness.attempts.length = 0;
            await expect(applyDocumentChanges({} as any, 'user-a', ops, () => true, replica, key))
                .rejects.toBeInstanceOf(CloudCiphertextError);
            expect(harness.attempts).toHaveLength(0);
            const sealed = sealCloudDocument(key, 'user-a', '', { profile: { height: 'encrypted' } }, {
                protocolVersion: 3, clock: {}, fields: {},
                writer: { slot: 's00', replicaId: 'replica-a', generation: 1, seq: 0 },
            });
            harness.remoteDocument = { ...sealed, _sealed: { ...sealed._sealed, nonce: 'WRONG' } };
            await expect(applyDocumentChanges({} as any, 'user-a', ops, () => true, replica, key))
                .rejects.toBeInstanceOf(CloudCiphertextError);
            expect(harness.attempts).toHaveLength(0);
        } finally {
            harness.remoteDocument = null;
        }
    });

});
