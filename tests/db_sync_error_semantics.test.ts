import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import { writeBatch } from 'firebase/firestore';

let mockBatch: {
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
};

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

describe('DB.saveUserData cloud failure semantics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        DB.resetCache();
        mockBatch = {
            set: vi.fn(),
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(writeBatch).mockReturnValue(mockBatch as never);
    });

    it('classifies permission-denied as rejected instead of offline pending', async () => {
        mockBatch.commit.mockRejectedValueOnce({ code: 'permission-denied' });

        const result = await DB.saveUserData(state);

        expect(result.ok).toBe(false);
        expect(result.status).toBe('rejected');
    });

    it('keeps known transport failures retryable as local-pending', async () => {
        mockBatch.commit.mockRejectedValueOnce({ code: 'unavailable' });

        const result = await DB.saveUserData(state);

        expect(result.ok).toBe(false);
        expect(result.status).toBe('local-pending');
    });

    it('classifies unknown cloud/runtime failures as failed', async () => {
        mockBatch.commit.mockRejectedValueOnce(new Error('unexpected cloud runtime failure'));

        const result = await DB.saveUserData(state);

        expect(result.ok).toBe(false);
        expect(result.status).toBe('failed');
    });
});
