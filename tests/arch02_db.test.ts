import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTransaction } from 'firebase/firestore';
import { ConsentedTestDB as DB } from './testUtils';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { readLocal } from '../src/lib/sync/localRepository';
import { lockAllVaults } from '../src/lib/sync/secureArchiveSession';

const OWNER = 'user:test-user-id';
const state = {
    profile: { height: '180' },
    history: [],
    nutrition: {},
    library: [],
    routines: [],
    customFoods: [],
    supplements: [],
    activePains: [],
};

describe('ARCH-02: DB.saveUserData', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        DB.resetCache();
        await prepareUnlockedTestArchive(OWNER);
    });

    afterEach(() => lockAllVaults());

    it.each([
        ['permission-denied', 'rejected'],
        ['unavailable', 'local-pending'],
    ] as const)('preserves the local journal when a %s transaction returns %s', async (code, status) => {
        // Cloud persistence uses runTransaction. A writeBatch mock can pass
        // through the test adapter without exercising the production boundary.
        vi.mocked(runTransaction).mockRejectedValueOnce({ code });

        const result = await DB.saveUserData(state);

        expect(runTransaction).toHaveBeenCalled();
        expect(result).toMatchObject({ ok: false, status });

        const durable = await readLocal(OWNER);
        expect(durable?.data.profile?.height).toBe('180');
        expect(durable?.pending.length).toBeGreaterThan(0);
        expect(durable?.pending.every(operation =>
            operation.actorId === durable.actorId && operation.seq <= durable.actorSeq,
        )).toBe(true);
    });
});
