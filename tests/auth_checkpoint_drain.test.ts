import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { loadAndDrainAuthenticatedData } from '../src/contexts/auth/loadAndDrainAuthenticatedData';

const mocks = {
    load: vi.fn(),
    readLocal: vi.fn(),
    flush: vi.fn(),
    currentUid: vi.fn(),
    isOnline: vi.fn(),
};

const environment = {
    load: mocks.load,
    readLocal: mocks.readLocal,
    flush: mocks.flush,
    currentUid: mocks.currentUid,
    isOnline: mocks.isOnline,
};


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
        mocks.currentUid.mockReturnValue('account-a');
        mocks.isOnline.mockReturnValue(true);
        mocks.load.mockResolvedValue(undefined);
        mocks.flush.mockResolvedValue(undefined);
        mocks.readLocal.mockResolvedValue(undefined);
    });

    it('keeps a missing or empty journal untouched after loading', async () => {
        const args = options();
        await loadAndDrainAuthenticatedData(args, environment);
        expect(mocks.load).toHaveBeenCalledOnce();
        expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({
            user: args.user, setUserData: args.setUserData,
            setSyncing: args.setSyncing, setSaveError: args.setSaveError,
        }));
        expect(mocks.readLocal).toHaveBeenCalledWith('account-a');
        expect(mocks.flush).not.toHaveBeenCalled();

        mocks.readLocal.mockResolvedValueOnce({ replica: {}, pending: [] });
        await loadAndDrainAuthenticatedData(options(), environment);
        expect(mocks.flush).not.toHaveBeenCalled();
    });

    it('delivers a durable pending journal only when a replica checkpoint exists', async () => {
        mocks.readLocal.mockResolvedValueOnce({ replica: null, pending: [{}] })
            .mockResolvedValueOnce(checkpointed);
        await loadAndDrainAuthenticatedData(options(), environment);
        expect(mocks.flush).not.toHaveBeenCalled();
        await loadAndDrainAuthenticatedData(options(), environment);
        expect(mocks.flush).toHaveBeenCalledOnce();
        expect(mocks.load.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.readLocal.mock.invocationCallOrder[0]);
    });

    it('rehydrates once and retries delivery after replica-fenced, without dropping pending operations', async () => {
        const fenced = Object.assign(new Error('replica checkpoint needed'), { code: 'replica-fenced' });
        mocks.readLocal.mockResolvedValue(checkpointed);
        mocks.flush.mockRejectedValueOnce(fenced).mockResolvedValueOnce(undefined);
        await loadAndDrainAuthenticatedData(options(), environment);

        expect(mocks.load).toHaveBeenCalledTimes(2);
        expect(mocks.readLocal).toHaveBeenCalledTimes(2);
        expect(mocks.flush).toHaveBeenCalledTimes(2);
        expect(mocks.flush.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.load.mock.invocationCallOrder[1]);
        expect(mocks.load.mock.invocationCallOrder[1])
            .toBeLessThan(mocks.flush.mock.invocationCallOrder[1]);
    });


    it('does not replay a durable journal if hydration was fenced or could not read cloud', async () => {
        mocks.load.mockResolvedValueOnce('blocked');
        mocks.readLocal.mockResolvedValue(checkpointed);

        await loadAndDrainAuthenticatedData(options(), environment);

        expect(mocks.load).toHaveBeenCalledOnce();
        expect(mocks.readLocal).not.toHaveBeenCalled();
        expect(mocks.flush).not.toHaveBeenCalled();
    });

    it('does not retry an already-fenced journal if the recovery hydration is also blocked', async () => {
        const fenced = Object.assign(new Error('cloud base changed'), { code: 'replica-fenced' });
        mocks.readLocal.mockResolvedValue(checkpointed);
        mocks.flush.mockRejectedValueOnce(fenced);
        mocks.load.mockResolvedValueOnce('ready').mockResolvedValueOnce('blocked');

        await loadAndDrainAuthenticatedData(options(), environment);

        expect(mocks.load).toHaveBeenCalledTimes(2);
        expect(mocks.flush).toHaveBeenCalledTimes(1);
        expect(mocks.readLocal).toHaveBeenCalledTimes(1);
    });

    it('propagates non-replica-fenced delivery errors without a destructive retry', async () => {
        mocks.readLocal.mockResolvedValue(checkpointed);
        mocks.flush.mockRejectedValueOnce(new Error('network unavailable'));
        await expect(loadAndDrainAuthenticatedData(options(), environment)).rejects.toThrow('network unavailable');
        expect(mocks.load).toHaveBeenCalledOnce();
        expect(mocks.flush).toHaveBeenCalledOnce();
    });

    it('never drains a journal after account identity changes during hydration', async () => {
        mocks.load.mockImplementationOnce(async () => {
            mocks.currentUid.mockReturnValue('account-b');
        });
        await loadAndDrainAuthenticatedData(options(), environment);
        expect(mocks.readLocal).not.toHaveBeenCalled();
        expect(mocks.flush).not.toHaveBeenCalled();
    });

    it('does not flush the new account after a stale IndexedDB read', async () => {
        let resolveRead!: (value: unknown) => void;
        mocks.readLocal.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
        const draining = loadAndDrainAuthenticatedData(options(), environment);
        await vi.waitFor(() => expect(mocks.readLocal).toHaveBeenCalledOnce());
        mocks.currentUid.mockReturnValue('account-b');
        resolveRead(checkpointed);
        await draining;
        expect(mocks.flush).not.toHaveBeenCalled();
    });

    it('does not drain an offline journal', async () => {
        mocks.isOnline.mockReturnValue(false);
        await loadAndDrainAuthenticatedData(options(), environment);
        expect(mocks.readLocal).not.toHaveBeenCalled();
        expect(mocks.flush).not.toHaveBeenCalled();
    });
});
