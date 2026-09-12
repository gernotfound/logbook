import { useAppStore } from '../src/store/useAppStore';
import { defaultUserDataFallback, UserDataSchema } from '../src/lib/schema';
import { DB } from '../src/lib/db';
import { vi, describe, it } from 'vitest';
import { setLastSavedStateStr } from '../src/lib/db/db_core';

vi.mock('../src/lib/firebase', () => ({
    auth: { currentUser: { uid: 'test-uid' } },
    getDb: vi.fn(),
    ensureAppCheck: vi.fn().mockResolvedValue(true)
}));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(),
    writeBatch: vi.fn().mockReturnValue({ set: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })
}));

describe('AppStore Sync', () => {
    it('should not loop on save', async () => {
        const state = UserDataSchema.parse({});
        setLastSavedStateStr(JSON.stringify(state));

        const store = useAppStore.getState();
        // Set the state, this triggers sync if something is dirty
        store.setUserData(state);
        
        await new Promise(r => setTimeout(r, 1000));
        
        // Let's do it directly through saveUserData
        await DB.saveUserData(state);
    });
});
