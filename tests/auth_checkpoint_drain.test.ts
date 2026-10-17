import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

const mocks = vi.hoisted(() => ({
    load: vi.fn(),
    readLocal: vi.fn(),
    flush: vi.fn(),
    auth: { currentUser: { uid: 'account-a' } as { uid: string } | null },
}));

vi.mock('../src/contexts/auth/loadAuthenticatedData', () => ({
    loadAuthenticatedData: mocks.load,
}));
vi.mock('../src/lib/sync/localRepository', () => ({
    readLocal: mocks.readLocal,
}));
vi.mock('../src/lib/firebase', () => ({
    auth: mocks.auth,
}));
vi.mock('../src/store/useAppStore', () => ({
    useAppStore: { getState: () => ({ flushPendingSyncs: mocks.flush }) },
}));

import { loadAndDrainAuthenticatedData } from '../src/contexts/auth/loadAndDrainAuthenticatedData';

const options = () => ({
    user: { uid: 'account-a' } as User,
    isGuestActive: () => false,
    setUserData: vi.fn(),
    setSyncing: vi.fn(),
    setSaveError: vi.fn(),
});

const checkpointed = { replica: { actorId: 'replica-a' }, pending: [{ id: 'pending-1' }] };

describe('authenticated checkpoint journal drain', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.auth.currentUser = { uid: 'account-a' };
        mocks.load.mockResolvedValue(undefined);
        mocks.flush.mockResolvedValue(undefined);
        mocks.readLocal.mockResolvedValue(undefined);
    });

    it('keeps a missing or empty journal untouched after loading', async () => {
        const args = options();
        await loadAndDrainAuthenticatedData(args);
        expect(mocks.load).toHaveBeenCalledOnce();
        expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({
            user: args.user, setUserData: args.setUserData,
            setSyncing: args.setSyncing, setSaveError: args.setSaveError,
        }));
        expect(mocks.readLocal).toHaveBeenCalledWith('account-a');
        expect(mocks.flush).not.toHaveBeenCalled();

        mocks.readLocal.mockResolvedValueOnce({ replica: {}, pending: [] });
        await loadAndDrainAuthenticatedData(options());
        expect(mocks.flush).not.toHaveBeenCalled();
    });

    it('delivers a durable pending journal only when a replica checkpoint exists', async () => {
        mocks.readLocal.mockResolvedValueOnce({ replica: null, pending: [{}] })
            .mockResolvedValueOnce(checkpointed);
        await loadAndDrainAuthenticatedData(options());
        expect(mocks.flush).not.toHaveBeenCalled();
        await loadAndDrainAuthenticatedData(options());
        expect(mocks.flush).toHaveBeenCalledOnce();
        expect(mocks.load.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.readLocal.mock.invocationCallOrder[0]);
    });

    it('rehydrates once and retries delivery after replica-fenced, without dropping pending operations', async () => {
        const fenced = Object.assign(new Error('replica checkpoint needed'), { code: 'replica-fenced' });
        mocks.readLocal.mockResolvedValue(checkpointed);
        mocks.flush.mockRejectedValueOnce(fenced).mockResolvedValueOnce(undefined);
        await loadAndDrainAuthenticatedData(options());

        expect(mocks.load).toHaveBeenCalledTimes(2);
        expect(mocks.readLocal).toHaveBeenCalledTimes(2);
        expect(mocks.flush).toHaveBeenCalledTimes(2);
        expect(mocks.flush.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.load.mock.invocationCallOrder[1]);
        expect(mocks.load.mock.invocationCallOrder[1])
            .toBeLessThan(mocks.flush.mock.invocationCallOrder[1]);
    });

    it('propagates non-replica-fenced delivery errors without a destructive retry', async () => {
        mocks.readLocal.mockResolvedValue(checkpointed);
        mocks.flush.mockRejectedValueOnce(new Error('network unavailable'));
        await expect(loadAndDrainAuthenticatedData(options())).rejects.toThrow('network unavailable');
        expect(mocks.load).toHaveBeenCalledOnce();
        expect(mocks.flush).toHaveBeenCalledOnce();
    });

    it('never drains a journal after account identity changes during hydration', async () => {
        mocks.load.mockImplementationOnce(async () => {
            mocks.auth.currentUser = { uid: 'account-b' };
        });
        await loadAndDrainAuthenticatedData(options());
        expect(mocks.readLocal).not.toHaveBeenCalled();
        expect(mocks.flush).not.toHaveBeenCalled();
    });

    it('does not drain an offline journal', async () => {
        const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        try {
            await loadAndDrainAuthenticatedData(options());
            expect(mocks.readLocal).not.toHaveBeenCalled();
            expect(mocks.flush).not.toHaveBeenCalled();
        } finally {
            offline.mockRestore();
        }
    });
});
