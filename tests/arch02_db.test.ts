import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.unmock('../src/lib/db');
import { DB } from '../src/lib/db';



let mockBatch: any;
import { writeBatch } from 'firebase/firestore';

describe('ARCH-02: DB.saveUserData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        DB.resetCache();
        
        mockBatch = {
            set: vi.fn(),
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(writeBatch).mockReturnValue(mockBatch);
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
