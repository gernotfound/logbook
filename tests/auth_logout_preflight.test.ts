import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForPendingWrites } from 'firebase/firestore';
import { auth } from '../src/lib/firebase';
import * as localRepository from '../src/lib/sync/localRepository';
import { useDialogStore } from '../src/store/useDialogStore';
import { useAppStore } from '../src/store/useAppStore';
import { prepareAuthenticatedLogout } from '../src/contexts/auth/prepareAuthenticatedLogout';
import { invalidateSession } from '../src/lib/sync/session';

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

    it('blocks logout despite an empty journal if a cloud integrity fence is durable', async () => {
        vi.spyOn(localRepository, 'readLocal').mockResolvedValueOnce({ pending: [], cloudIntegrityFence: 'unsafe-cloud' } as any);
        expect(await prepareAuthenticatedLogout(ownerUid, vi.fn())).toBeNull();
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(expect.stringContaining('snapshot cloud'));
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

    it('rejects an old preflight after sign-out and re-login to the same UID during the cloud wait', async () => {
        vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{}] } as any);
        let release!: () => void;
        vi.mocked(waitForPendingWrites).mockImplementationOnce(
            () => new Promise<void>(resolve => { release = resolve; }),
        );
        const setSyncing = vi.fn();
        const preflight = prepareAuthenticatedLogout(ownerUid, setSyncing);
        await vi.waitFor(() => expect(waitForPendingWrites).toHaveBeenCalledOnce());

        invalidateSession();
        (auth as any).currentUser = { uid: ownerUid };
        release();

        expect(await preflight).toBeNull();
        // An expired request must not clear the successor session's syncing flag.
        expect(setSyncing).toHaveBeenCalledExactlyOnceWith(true);
        expect(useDialogStore.getState().showUnsyncedDataLogout).not.toHaveBeenCalled();
    });

    it('does not accept force-exit confirmation made by an expired same-UID session', async () => {
        vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{}] } as any);
        vi.mocked(waitForPendingWrites).mockRejectedValueOnce(
            Object.assign(new Error('network unavailable'), { code: 'unavailable' }),
        );
        let confirm!: (choice: 'force-exit') => void;
        vi.mocked(useDialogStore.getState().showUnsyncedDataLogout).mockImplementationOnce(
            () => new Promise(resolve => { confirm = resolve; }),
        );
        const preflight = prepareAuthenticatedLogout(ownerUid, vi.fn());
        await vi.waitFor(() => expect(useDialogStore.getState().showUnsyncedDataLogout).toHaveBeenCalledOnce());
        invalidateSession();
        (auth as any).currentUser = { uid: ownerUid };
        confirm('force-exit');

        expect(await preflight).toBeNull();
    });

    it('requires explicit force-exit choice when the journal has pending work', async () => {
        vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{}] } as any);
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
        vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{}] } as any);
        vi.mocked(waitForPendingWrites).mockRejectedValueOnce(
            Object.assign(new Error('offline'), { code: 'unavailable' }),
        );
        vi.mocked(useDialogStore.getState().showUnsyncedDataLogout).mockResolvedValueOnce('wait');
        const setSyncing = vi.fn();

        expect(await prepareAuthenticatedLogout(ownerUid, setSyncing)).toBeNull();
        expect(useDialogStore.getState().showUnsyncedDataLogout).toHaveBeenCalledWith('offline');
    });

    it('recognizes a journal drained while pending server writes settle', async () => {
        const read = vi.spyOn(localRepository, 'readLocal')
            .mockResolvedValueOnce({ pending: [{}] } as any)
            .mockResolvedValueOnce({ pending: [] } as any);
        vi.mocked(waitForPendingWrites).mockImplementationOnce(async () => {
            useAppStore.setState({ syncHealth: 'synced' });
        });

        expect(await prepareAuthenticatedLogout(ownerUid, vi.fn())).toBe(false);
        expect(read).toHaveBeenCalledTimes(2);
        expect(useDialogStore.getState().showUnsyncedDataLogout).not.toHaveBeenCalled();
    });

    it('aborts if the cloud-integrity fence appears while pending writes settle', async () => {
        vi.spyOn(localRepository, 'readLocal')
            .mockResolvedValueOnce({ pending: [{}] } as any)
            .mockResolvedValueOnce({ pending: [], cloudIntegrityFence: 'cloud-evidence-failed' } as any);
        expect(await prepareAuthenticatedLogout(ownerUid, vi.fn())).toBeNull();
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(expect.stringContaining('snapshot cloud'));
        expect(useDialogStore.getState().showUnsyncedDataLogout).not.toHaveBeenCalled();
    });

    it('fails closed when the durable re-read after cloud waiting becomes unreadable', async () => {
        vi.spyOn(localRepository, 'readLocal')
            .mockResolvedValueOnce({ pending: [{}] } as any)
            .mockRejectedValueOnce(new Error('IndexedDB became unavailable'));
        expect(await prepareAuthenticatedLogout(ownerUid, vi.fn())).toBeNull();
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(expect.stringContaining('Archivio preservato'));
        expect(useDialogStore.getState().showUnsyncedDataLogout).not.toHaveBeenCalled();
    });

    it('never authorizes safe-exit when a new journal item arrives during the dialog', async () => {
        useAppStore.setState({ syncHealth: 'local-pending' });
        const read = vi.spyOn(localRepository, 'readLocal')
            .mockResolvedValueOnce({ pending: [] } as any)
            .mockResolvedValueOnce({ pending: [] } as any)
            .mockResolvedValueOnce({ pending: [{}] } as any);
        vi.mocked(useDialogStore.getState().showUnsyncedDataLogout).mockImplementationOnce(async () => {
            useAppStore.setState({ syncHealth: 'synced' });
            return 'safe-exit';
        });

        expect(await prepareAuthenticatedLogout(ownerUid, vi.fn())).toBeNull();
        expect(read).toHaveBeenCalledTimes(3);
        expect(useDialogStore.getState().showUnsyncedDataLogout).toHaveBeenCalledWith('offline');
    });
});
