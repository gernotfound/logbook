import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
    auth: { currentUser: { uid: 'sync-user' } as { uid: string } | null },
    ensureAppCheck: vi.fn(),
}));

vi.mock('../src/lib/firebase', () => ({
    auth: firebase.auth,
    getDb: vi.fn(() => ({})),
    ensureAppCheck: firebase.ensureAppCheck,
}));

import { DB } from '../src/lib/db';

const state = { profile: {}, history: [], nutrition: {}, library: [], routines: [], customFoods: [], trainingCycles: [], supplements: [], activePains: [] };

describe('DB.saveUserData cloud failure semantics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebase.auth.currentUser = { uid: 'sync-user' };
    });

    it('classifies permission-denied as rejected instead of offline pending', async () => {
        firebase.ensureAppCheck.mockRejectedValueOnce({ code: 'permission-denied' });

        const result = await DB.saveUserData(state);

        expect(result.ok).toBe(false);
        expect(result.status).toBe('rejected');
    });

    it('keeps known transport failures retryable as local-pending', async () => {
        firebase.ensureAppCheck.mockRejectedValueOnce({ code: 'unavailable' });

        const result = await DB.saveUserData(state);

        expect(result.ok).toBe(false);
        expect(result.status).toBe('local-pending');
    });

    it('classifies unknown App Check/import/runtime failures as failed', async () => {
        firebase.ensureAppCheck.mockRejectedValueOnce(new Error('App Check bootstrap failed'));

        const result = await DB.saveUserData(state);

        expect(result.ok).toBe(false);
        expect(result.status).toBe('failed');
    });
});
