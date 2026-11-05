import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    findPending: vi.fn(),
    isPending: vi.fn(),
    recoverByDevice: vi.fn(),
    resume: vi.fn(),
    finalize: vi.fn(),
    showAlert: vi.fn(),
    purge: vi.fn(),
    resetStore: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({
    DB: {
        purgeCompletedAccountLocalData: boundary.purge,
    },
}));

vi.mock('../src/lib/db/db_account', () => {
    class AccountDeletionReceiptNotFoundError extends Error {
        constructor(readonly uid?: string) { super('Ricevuta non riconosciuta'); }
    }
    return {
        AccountDeletionReceiptNotFoundError,
        finalizeCompletedDeletionForUid: boundary.finalize,
        resumeAccountDeletion: boundary.resume,
    };
});

vi.mock('../src/lib/sync/accountGate', () => ({
    listPendingAccountDeletions: boundary.findPending,
    isAccountDeletionPending: boundary.isPending,
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
import { DeletionDeviceOperationError } from '../src/lib/deletionRecoveryDiagnostics';
import { AccountDeletionReceiptNotFoundError } from '../src/lib/db/db_account';

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
        boundary.isPending.mockReturnValue(true);
        boundary.recoverByDevice.mockResolvedValue({ status: 'none' });
        boundary.resume.mockResolvedValue(undefined);
        boundary.showAlert.mockResolvedValue(undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    const recoveryWarnings = (): string[] => vi.mocked(console.warn).mock.calls
        .filter(call => call[0] === 'Diagnostica tecnica recupero account:')
        .map(call => String(call[1]));

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not classify an isolated routine timeout as an account deletion failure', async () => {
        const timeout = new DeletionDeviceOperationError('routine-check', 'app-check', 'timeout');
        boundary.recoverByDevice.mockRejectedValueOnce(timeout);

        render(<AccountDeletionRecovery />);
        await settle();

        expect(recoveryWarnings()).toHaveLength(0);
        expect(boundary.showAlert).not.toHaveBeenCalled();
    });

    it('alerts when configured recovery cannot run despite saved device credentials', async () => {
        boundary.recoverByDevice.mockRejectedValueOnce(
            new DeletionDeviceOperationError('routine-check', 'http', 'configuration'),
        );

        render(<AccountDeletionRecovery />);
        await settle();

        expect(recoveryWarnings()).toContain(expect.stringContaining('kind=configuration'));
        expect(boundary.showAlert).toHaveBeenCalledWith(
            expect.stringContaining('Impossibile verificare ora la cancellazione account'),
        );
    });

    it('still surfaces local-finalization failure after a verified remote deletion', async () => {
        const finalizationError = new DeletionRecoveryFinalizationError('Pulizia locale incompleta');
        boundary.recoverByDevice.mockRejectedValueOnce(finalizationError);

        render(<AccountDeletionRecovery />);
        await settle();

        expect(recoveryWarnings().some(message => message.includes('operation=local-finalization'))).toBe(true);
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

        expect(recoveryWarnings().some(message => message.includes('operation=pending-deletion'))).toBe(true);
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
        expect(recoveryWarnings().some(message => message.includes('operation=pending-deletion'))).toBe(true);
    });

    it.each([
        ['network timeout', new DeletionDeviceOperationError('routine-check', 'response-body', 'timeout')],
        ['temporary App Check provider failure', new DeletionDeviceOperationError('routine-check', 'app-check', 'provider')],
    ])('aggregates repeated %s failures, then resets after a successful check', async (_scenario, failure) => {
        boundary.recoverByDevice.mockRejectedValueOnce(failure)
            .mockRejectedValueOnce(failure)
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce({ status: 'none' })
            .mockRejectedValueOnce(failure);

        render(<AccountDeletionRecovery />);
        await settle();
        expect(recoveryWarnings()).toHaveLength(0);

        window.dispatchEvent(new Event('online'));
        await settle();
        expect(recoveryWarnings()).toHaveLength(0);

        window.dispatchEvent(new Event('online'));
        await settle();
        expect(recoveryWarnings()).toHaveLength(1);
        expect(recoveryWarnings().at(-1)).toContain('consecutive=3');

        window.dispatchEvent(new Event('online'));
        await settle();
        window.dispatchEvent(new Event('online'));
        await settle();
        expect(recoveryWarnings()).toHaveLength(1);
        expect(boundary.showAlert).not.toHaveBeenCalled();
    });

    it('does not lose a confirmed-cloud local-finalization failure behind another marker failure', async () => {
        boundary.findPending.mockReturnValue({
            markers: [{ owner: 'user:b', uid: 'b', startedAt: 2, receiptToken: 'receipt-b' }],
            corrupt: [],
        });
        boundary.resume.mockRejectedValueOnce(new Error('B failed'));
        boundary.recoverByDevice.mockRejectedValueOnce(new DeletionRecoveryFinalizationError('Pulizia A incompleta'));

        render(<AccountDeletionRecovery />);
        await settle();

        expect(recoveryWarnings()).toHaveLength(2);
        expect(recoveryWarnings().some(message => message.includes('operation=local-finalization'))).toBe(true);
        expect(boundary.showAlert).toHaveBeenNthCalledWith(1, 'Pulizia A incompleta');
        expect(boundary.showAlert).toHaveBeenNthCalledWith(2, 'B failed');
    });

    it('surfaces a failed cloud deletion returned by a valid device proof', async () => {
        boundary.recoverByDevice.mockRejectedValueOnce(
            new DeletionDeviceOperationError('routine-check', 'server-status', 'remote-failed'),
        );

        render(<AccountDeletionRecovery />);
        await settle();

        expect(recoveryWarnings().some(message => message.includes('kind=remote-failed'))).toBe(true);
        expect(boundary.showAlert).toHaveBeenCalledWith(
            expect.stringContaining('cancellazione cloud non è stata completata'),
        );
    });

    it('preserves a receipt-not-found warning when another owner completes', async () => {
        boundary.findPending.mockReturnValue({
            markers: [{ owner: 'user:a', uid: 'a', startedAt: 1, receiptToken: 'receipt-a' }],
            corrupt: [],
        });
        boundary.resume.mockRejectedValueOnce(new AccountDeletionReceiptNotFoundError('a'));
        boundary.recoverByDevice.mockResolvedValueOnce({ status: 'complete' });
        boundary.isPending.mockReturnValue(true);

        render(<AccountDeletionRecovery />);
        await settle();

        expect(recoveryWarnings().some(message => message.includes('operation=pending-deletion'))).toBe(true);
        expect(boundary.showAlert).toHaveBeenCalledWith('Ricevuta non riconosciuta');
    });

    it('does not warn about an old receipt when that same owner was fully finalized', async () => {
        boundary.findPending.mockReturnValue({
            markers: [{ owner: 'user:a', uid: 'a', startedAt: 1, receiptToken: 'receipt-a' }],
            corrupt: [],
        });
        boundary.resume.mockRejectedValueOnce(new AccountDeletionReceiptNotFoundError('a'));
        boundary.recoverByDevice.mockResolvedValueOnce({ status: 'complete' });
        boundary.isPending.mockReturnValue(false);

        render(<AccountDeletionRecovery />);
        await settle();

        expect(boundary.showAlert).not.toHaveBeenCalled();
        expect(recoveryWarnings()).toHaveLength(0);
    });

    it('reports failed local cleanup via a pending marker as a critical finalization error', async () => {
        boundary.findPending.mockReturnValue({
            markers: [{ owner: 'user:a', uid: 'a', startedAt: 1, receiptToken: 'receipt-a' }],
            corrupt: [],
        });
        const failure = Object.assign(new Error('Pulizia locale incompleta'), {
            code: 'account-deletion-local-finalization-failed',
        });
        boundary.resume.mockRejectedValueOnce(failure);

        render(<AccountDeletionRecovery />);
        await settle();

        expect(recoveryWarnings().some(message => message.includes('operation=local-finalization'))).toBe(true);
        expect(boundary.showAlert).toHaveBeenCalledWith('Pulizia locale incompleta');
    });

});