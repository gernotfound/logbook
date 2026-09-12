import { describe, it, expect, vi } from 'vitest';
import { DB } from '../src/lib/db';
import { defaultUserDataFallback } from '../src/lib/schema';
import { dbState, setLastSavedStateStr } from '../src/lib/db/db_core';

vi.mock('../src/lib/firebase', () => ({
    auth: { currentUser: { uid: 'test-uid' } },
    getDb: vi.fn(),
    ensureAppCheck: vi.fn().mockResolvedValue(true)
}));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(),
    writeBatch: vi.fn().mockReturnValue({ set: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })
}));

describe('DB Sync Loop', () => {
    it('should not detect unequal fields for the same state', async () => {
        const state = { ...defaultUserDataFallback, activeWorkout: undefined };
        // Simulate successful save
        setLastSavedStateStr(JSON.stringify(state));
        
        const consoleSpy = vi.spyOn(console, 'log');
        await DB.saveUserData(state);
        
        // Assert no writes happened
        expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Sincronizzazione DB completata.'));
        expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('UNEQUAL FIELDS:'));
    });
});
