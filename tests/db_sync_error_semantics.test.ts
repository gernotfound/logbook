import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('../src/lib/db');

import { runTransaction } from 'firebase/firestore';
import { ConsentedTestDB as DB } from './testUtils';
import { DB as RealDB } from '../src/lib/db';
import { readLocal } from '../src/lib/sync/localRepository';

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
    beforeEach(() => {
        vi.clearAllMocks();
        DB.resetCache();
    });

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

    it('keeps a known transport failure retryable and replays the durable journal', async () => {
        const result = await saveWithTransactionFailure({ code: 'unavailable' });
        expect(result).toMatchObject({ ok: false, status: 'local-pending' });

        const replay = await RealDB.saveUserData(state);
        expect(replay).toMatchObject({ ok: true, status: 'synced' });
        const acknowledged = await readLocal(OWNER);
        expect(acknowledged?.pending).toEqual([]);
        expect(acknowledged?.data.profile?.height).toBe('180');
    });

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
