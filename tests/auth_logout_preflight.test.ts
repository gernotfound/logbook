import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForPendingWrites } from 'firebase/firestore';
import { auth } from '../src/lib/firebase';
import * as localRepository from '../src/lib/sync/localRepository';
import { useDialogStore } from '../src/store/useDialogStore';
import { useAppStore } from '../src/store/useAppStore';
import { prepareAuthenticatedLogout } from '../src/contexts/auth/prepareAuthenticatedLogout';

const ownerUid = 'logout-preflight-owner';

describe('authenticated logout preflight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (auth as any).currentUser = { uid: ownerUid };
        useAppStore.getState().resetStore({ force: true });
        useAppStore.setState({ syncHealth: 'synced', userData: null, localWorkout: null });
    });
    afterEach(() => vi.restoreAllMocks());

    it('blocks logout if the durable journal is unreadable', async () => {
        vi.spyOn(localRepository, 'readLocal').mockRejectedValueOnce(new Error('IndexedDB read failure'));
        const setSyncing = vi.fn();

        const result = await prepareAuthenticatedLogout(ownerUid, setSyncing);

        expect(result).toBeNull();
        expect(setSyncing).toHaveBeenNthCalledWith(1, true);
        expect(setSyncing).toHaveBeenLastCalledWith(false);
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
            expect.stringContaining('Archivio preservato'),
        );
        expect(useDialogStore.getState().showUnsyncedDataLogout).not.toHaveBeenCalled();
    });

    it('permits normal logout only when memory and durable journal are clean', async () => {
        vi.spyOn(localRepository, 'readLocal').mockResolvedValueOnce({ pending: [] } as any);
        const setSyncing = vi.fn();

        const result = await prepareAuthenticatedLogout(ownerUid, setSyncing);

        expect(result).toBe(false);
        expect(setSyncing).toHaveBeenLastCalledWith(false);
        expect(waitForPendingWrites).not.toHaveBeenCalled();
        expect(useDialogStore.getState().showUnsyncedDataLogout).not.toHaveBeenCalled();
    });

    it('aborts stale preflight after an account switch during cloud write wait', async () => {
        vi.spyOn(localRepository, 'readLocal').mockResolvedValueOnce({ pending: [{}] } as any);
        let releaseWrite!: () => void;
        vi.mocked(waitForPendingWrites).mockImplementationOnce(
            () => new Promise<void>(resolve => { releaseWrite = resolve; }),
        );
        const setSyncing = vi.fn();

        const pending = prepareAuthenticatedLogout(ownerUid, setSyncing);
        await vi.waitFor(() => expect(waitForPendingWrites).toHaveBeenCalledTimes(1));
        (auth as any).currentUser = { uid: 'other-account' };
        releaseWrite();

        expect(await pending).toBeNull();
        expect(setSyncing).toHaveBeenLastCalledWith(false);
        expect(useDialogStore.getState().showUnsyncedDataLogout).not.toHaveBeenCalled();
    });

    it('requires explicit force-exit choice when the journal has pending work', async () => {
        vi.spyOn(localRepository, 'readLocal').mockResolvedValueOnce({ pending: [{}] } as any);
        vi.mocked(waitForPendingWrites).mockRejectedValueOnce(
            Object.assign(new Error('permission denied'), { code: 'permission-denied' }),
        );
        vi.mocked(useDialogStore.getState().showUnsyncedDataLogout).mockResolvedValueOnce('force-exit');
        const setSyncing = vi.fn();

        const result = await prepareAuthenticatedLogout(ownerUid, setSyncing);

        expect(result).toBe(true);
        expect(useDialogStore.getState().showUnsyncedDataLogout).toHaveBeenCalledWith('rejected');
    });

    it('does not authorize logout when the unsynced dialog chooses to wait', async () => {
        vi.spyOn(localRepository, 'readLocal').mockResolvedValueOnce({ pending: [{}] } as any);
        vi.mocked(waitForPendingWrites).mockRejectedValueOnce(
            Object.assign(new Error('offline'), { code: 'unavailable' }),
        );
        vi.mocked(useDialogStore.getState().showUnsyncedDataLogout).mockResolvedValueOnce('wait');
        const setSyncing = vi.fn();

        expect(await prepareAuthenticatedLogout(ownerUid, setSyncing)).toBeNull();
        expect(useDialogStore.getState().showUnsyncedDataLogout).toHaveBeenCalledWith('offline');
    });
});
