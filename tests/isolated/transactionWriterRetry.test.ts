import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    attempts: [] as Array<Array<{ path: string, data?: any, deleted?: boolean }>>
}));

vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, path: string) => ({ path }),
    runTransaction: async (_db: unknown, callback: (tx: any) => Promise<any>) => {
        const runAttempt = async () => {
            const writes: Array<{ path: string, data?: any, deleted?: boolean }> = [];
            const transaction = {
                get: async (_ref: { path: string }) => ({
                    exists: () => true,
                    data: () => ({
                        profile: { height: '170' },
                        _sync: { protocolVersion: 1, clock: {}, fields: {} }
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
        const ops: SemanticOperation[] = [{
            docPath: '',
            path: ['profile', 'height'],
            value: '171',
            isDelete: false,
            actorId: 'A',
            seq: 1,
            clock: { A: 1 }
        }];

        const outcome = await applyDocumentChanges({} as any, 'user-a', ops, () => true);

        expect(harness.attempts).toHaveLength(2);
        expect(harness.attempts[1]).toEqual(harness.attempts[0]);
        expect(harness.attempts[0]).toHaveLength(1);
        expect(harness.attempts[0][0].data.profile.height).toBe('171');
        expect(harness.attempts[0][0].data._sync.fields['profile/height']).toMatchObject({
            actorId: 'A',
            seq: 1,
            clock: { A: 1 }
        });
        expect(outcome.syncMeta[''].fields['profile/height'].seq).toBe(1);
    });
});
