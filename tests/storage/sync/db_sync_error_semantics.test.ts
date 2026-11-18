import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.unmock('../../../src/lib/db');

import { runTransaction } from 'firebase/firestore';
import { ConsentedTestDB as DB } from '../../testUtils';
import { DB as RealDB } from '../../../src/lib/db';
import { readLocal } from '../../../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { mockFirebaseAuth } from '../../setup';
import { rememberAuthenticatedOwner, clearAuthenticatedOwnerHint } from '../../../src/lib/sync/authOwnerHint';
import { storageOwner } from '../../../src/lib/sync/session';

const OWNER = 'user:test-user-id';
const state = {
    profile: { height: '180' },
    history: [],
    nutrition: {},
    library: [],
    routines: [],
    customFoods: [],
    trainingCycles: [],
    supplements: [],
    activePains: [],
};

describe('DB.saveUserData cloud transaction failure semantics', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await prepareUnlockedTestArchive(OWNER);
        DB.resetCache();
    });
    afterEach(() => lockAllVaults());

    async function saveWithTransactionFailure(error: unknown) {
        // Production writes use runTransaction. Inject at that exact transport
        // boundary rather than depending on the mock adapter's writeBatch internals.
        vi.mocked(runTransaction).mockRejectedValueOnce(error);
        const result = await DB.saveUserData(state);
        expect(runTransaction).toHaveBeenCalled();
        const retained = await readLocal(OWNER);
        expect(retained?.pending.length).toBeGreaterThan(0);
        expect(retained?.pending.every(operation =>
            operation.actorId === retained.actorId && operation.seq <= retained.actorSeq,
        )).toBe(true);
        return result;
    }

    it('classifies permission-denied as rejected while preserving the local journal', async () => {
        const result = await saveWithTransactionFailure({ code: 'permission-denied' });
        expect(result).toMatchObject({ ok: false, status: 'rejected' });
    });


    it('never reports a cloud ACK when Firebase is signed out but the account journal remains durable', async () => {
        // The local journal was committed under the account before Auth was lost.
        const failed = await saveWithTransactionFailure({ code: 'unavailable' });
        expect(failed).toMatchObject({ ok: false, status: 'local-pending' });
        const original = await readLocal(OWNER);
        expect(original?.pending.length).toBeGreaterThan(0);

        const signedIn = mockFirebaseAuth.currentUser;
        rememberAuthenticatedOwner('test-user-id');
        try {
            mockFirebaseAuth.currentUser = null;
            expect(storageOwner()).toBe(OWNER);

            // A verified Kinde session may exist separately, but the legacy
            // Firestore writer must not fake completion without its provider.
            const replay = await RealDB.saveUserData(state);
            expect(replay).toMatchObject({ ok: false });
            expect(replay.status).not.toBe('synced');
            expect(runTransaction).toHaveBeenCalledTimes(1);
            const retained = await readLocal(OWNER);
            expect(retained?.pending).toEqual(original?.pending);
            expect(retained?.actorSeq).toBe(original?.actorSeq);
        } finally {
            mockFirebaseAuth.currentUser = signedIn;
            clearAuthenticatedOwnerHint(OWNER);
        }
    });

    it('keeps a known transport failure retryable and replays the durable journal', async () => {
        const result = await saveWithTransactionFailure({ code: 'unavailable' });
        expect(result).toMatchObject({ ok: false, status: 'local-pending' });

        const replay = await RealDB.saveUserData(state);
        expect(replay).toMatchObject({ ok: true, status: 'synced' });
        const acknowledged = await readLocal(OWNER);
        expect(acknowledged?.pending).toEqual([]);
        expect(acknowledged?.data.profile?.height).toBe('180');
    });

    it.each(['resource-exhausted', 'firestore/resource-exhausted', 'quota-exceeded'])(
        'preserves the durable journal on cloud quota %s and can sync after recovery',
        async code => {
            const result = await saveWithTransactionFailure({ code });
            expect(result).toMatchObject({ ok: false, status: 'local-pending' });
            const replay = await RealDB.saveUserData(state);
            expect(replay).toMatchObject({ ok: true, status: 'synced' });
            const acknowledged = await readLocal(OWNER);
            expect(acknowledged?.pending).toEqual([]);
            expect(acknowledged?.data.profile?.height).toBe('180');
        },
    );

    it('does not serialize the caller snapshot when the journal is already durable', async () => {
        await DB.saveUserData(state);
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const result = await RealDB.saveUserData(circular);
        expect(result).toMatchObject({ ok: true, status: 'synced' });
    });

    it('classifies unknown transaction/runtime failures as failed without deleting pending operations', async () => {
        const result = await saveWithTransactionFailure(new Error('unexpected cloud runtime failure'));
        expect(result).toMatchObject({ ok: false, status: 'failed' });
    });
});
