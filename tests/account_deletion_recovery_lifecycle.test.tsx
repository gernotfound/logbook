import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    findPending: vi.fn(),
    recoverByDevice: vi.fn(),
    resume: vi.fn(),
    finalize: vi.fn(),
    reportError: vi.fn(),
    showAlert: vi.fn(),
    purge: vi.fn(),
    resetCache: vi.fn(),
    resetStore: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({
    DB: {
        purgeCompletedAccountLocalData: boundary.purge,
        resetCache: boundary.resetCache,
    },
}));

vi.mock('../src/lib/db/db_account', () => {
    class AccountDeletionReceiptNotFoundError extends Error {}
    return {
        AccountDeletionReceiptNotFoundError,
        finalizeCompletedDeletionForUid: boundary.finalize,
        resumeAccountDeletion: boundary.resume,
    };
});

vi.mock('../src/lib/sync/accountGate', () => ({
    listPendingAccountDeletions: boundary.findPending,
}));

vi.mock('../src/lib/deletionDeviceRecovery', () => {
    class DeletionRecoveryFinalizationError extends Error {
        readonly code = 'account-deletion-device-finalization-failed';
    }
    return {
        DeletionRecoveryFinalizationError,
        recoverDeletedAccountOnThisDevice: boundary.recoverByDevice,
    };
});

vi.mock('../src/lib/errorHandler', () => ({
    reportError: boundary.reportError,
}));

vi.mock('../src/store/useDialogStore', () => ({
    useDialogStore: {
        getState: () => ({ showAlert: boundary.showAlert }),
    },
}));

vi.mock('../src/store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({ resetStore: boundary.resetStore }),
    },
}));

import {
    AccountDeletionRecovery,
    DEVICE_RECOVERY_RECHECK_INTERVAL_MS,
} from '../src/components/AccountDeletionRecovery';
import { DeletionRecoveryFinalizationError } from '../src/lib/deletionDeviceRecovery';

function setOnline(value: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

async function settle() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('account deletion recovery foreground lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setOnline(true);
        boundary.findPending.mockReturnValue({ markers: [], corrupt: [] });
        boundary.recoverByDevice.mockResolvedValue({ status: 'none' });
        boundary.resume.mockResolvedValue(undefined);
        boundary.showAlert.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports a routine background App Check failure without interrupting the user', async () => {
        const appCheckError = Object.assign(new Error('limited-use failed'), {
            code: 'app-check-limited-use-unavailable',
            firebaseCode: 'appCheck/recaptcha-error',
        });
        boundary.recoverByDevice.mockRejectedValueOnce(appCheckError);

        render(<AccountDeletionRecovery />);
        await settle();

        expect(boundary.reportError).toHaveBeenCalledWith(appCheckError, {
            source: 'account_deletion_recovery',
        });
        expect(boundary.showAlert).not.toHaveBeenCalled();
    });

    it('still surfaces local-finalization failure after a verified remote deletion', async () => {
        const finalizationError = new DeletionRecoveryFinalizationError('Pulizia locale incompleta');
        boundary.recoverByDevice.mockRejectedValueOnce(finalizationError);

        render(<AccountDeletionRecovery />);
        await settle();

        expect(boundary.reportError).toHaveBeenCalledWith(finalizationError, {
            source: 'account_deletion_recovery',
        });
        expect(boundary.showAlert).toHaveBeenCalledWith('Pulizia locale incompleta');
    });

    it('coalesces focus and visibility events from the same foreground transition', async () => {
        vi.useFakeTimers();
        render(<AccountDeletionRecovery />);
        await settle();
        expect(boundary.recoverByDevice).toHaveBeenCalledTimes(1);

        act(() => {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await settle();
        expect(boundary.recoverByDevice).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(DEVICE_RECOVERY_RECHECK_INTERVAL_MS + 1);
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });
        expect(boundary.recoverByDevice).toHaveBeenCalledTimes(2);
    });

    it('keeps active deletion failures visible to the user', async () => {
        boundary.findPending.mockReturnValue({ markers: [{ owner: 'user:a', uid: 'a', startedAt: 1, receiptToken: 'receipt' }], corrupt: [] });
        const failure = new Error('Cancellazione cloud incompleta');
        boundary.resume.mockRejectedValueOnce(failure);

        render(<AccountDeletionRecovery />);
        await settle();

        expect(boundary.reportError).toHaveBeenCalledWith(failure, {
            source: 'account_deletion_recovery',
        });
        expect(boundary.showAlert).toHaveBeenCalledWith('Cancellazione cloud incompleta');
    });
    it('checks device credentials despite another owner having a pending marker', async () => {
        boundary.findPending.mockReturnValue({
            markers: [{ owner: 'user:b', uid: 'b', startedAt: 2, receiptToken: 'receipt-b' }],
            corrupt: [],
        });
        boundary.resume.mockResolvedValue({ status: 'pending', message: 'B in corso' });

        render(<AccountDeletionRecovery />);
        await settle();

        expect(boundary.resume).toHaveBeenCalledTimes(1);
        expect(boundary.recoverByDevice).toHaveBeenCalledTimes(1);
    });

    it('still checks device credentials if one marker fails to reconcile', async () => {
        boundary.findPending.mockReturnValue({
            markers: [{ owner: 'user:b', uid: 'b', startedAt: 2, receiptToken: 'receipt-b' }],
            corrupt: [],
        });
        const failure = new Error('Errore marker B');
        boundary.resume.mockRejectedValue(failure);
        boundary.recoverByDevice.mockResolvedValue({ status: 'complete' });

        render(<AccountDeletionRecovery />);
        await settle();

        expect(boundary.recoverByDevice).toHaveBeenCalledTimes(1);
        expect(boundary.reportError).toHaveBeenCalledWith(failure, {
            source: 'account_deletion_recovery',
        });
    });

});