import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.unmock('../src/lib/db');
import { DB } from '../src/lib/db';

vi.mock('../src/lib/firebase', () => ({
    auth: { currentUser: { uid: 'user_123', getIdToken: vi.fn().mockResolvedValue('token') } },
    getDb: vi.fn().mockReturnValue({}),
    ensureAppCheck: vi.fn().mockResolvedValue(undefined),
}));

let mockBatch: any;
vi.mock('firebase/firestore', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        doc: vi.fn(),
        writeBatch: vi.fn(() => mockBatch),
    };
});

vi.mock('idb-keyval', () => ({
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(undefined)
}));

describe('ARCH-02: DB.saveUserData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        DB.resetCache();
        
        mockBatch = {
            set: vi.fn(),
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined),
        };
    });

    it('should return { ok: false, status: "rejected" } on permission-denied', async () => {
        mockBatch.commit.mockRejectedValue({ code: 'permission-denied' });
        
        const result = await DB.saveUserData({ profile: { height: '180' }, history: [], library: [], routines: [], customFoods: [], supplements: [], activePains: [] });
        
        expect(result).toBeDefined();
        expect(result?.ok).toBe(false);
        expect(result?.status).toBe('rejected');
    });

    it('should handle offline scenario by returning local-pending', async () => {
        mockBatch.commit.mockRejectedValue({ code: 'unavailable' });
        
        const result = await DB.saveUserData({ profile: { height: '180' }, history: [], library: [], routines: [], customFoods: [], supplements: [], activePains: [] });
        
        expect(result).toBeDefined();
        expect(result?.ok).toBe(false);
        expect(result?.status).toBe('local-pending');
    });
});
