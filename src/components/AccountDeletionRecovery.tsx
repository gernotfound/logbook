import { useEffect } from 'react';
import { DB } from '../lib/db';
import {
    AccountDeletionReceiptNotFoundError,
    finalizeCompletedDeletionForUid,
    resumeAccountDeletion,
    type AccountDeletionCompletionContext,
} from '../lib/db/db_account';
import { findPendingAccountDeletion } from '../lib/sync/accountGate';
import { useDialogStore } from '../store/useDialogStore';
import { useAppStore } from '../store/useAppStore';
import {
    DeletionRecoveryFinalizationError,
    recoverDeletedAccountOnThisDevice,
} from '../lib/deletionDeviceRecovery';
import { reportError } from '../lib/errorHandler';

export const DEVICE_RECOVERY_RECHECK_INTERVAL_MS = 5 * 1000;
const DEVICE_RECOVERY_FAILURE_RETRY_MS = 30 * 1000;

const UNKNOWN_RECOVERY_MESSAGE =
    'Impossibile verificare ora la cancellazione account. La copia locale resta conservata; il controllo verrà ripetuto automaticamente.';

/**
 * Reconciles a durable server-deletion receipt after reload/Auth removal.
 * It deliberately never blocks rendering: offline startup must continue from the
 * preserved local envelope and recovery is retried on later lifecycle opportunities.
 */
export function AccountDeletionRecovery() {
    useEffect(() => {
        let disposed = false;
        let running = false;
        let nextDeviceRecoveryAt = 0;

        const completionContext: AccountDeletionCompletionContext = {
            purgeAllLocalUserData: owner => DB.purgeAllLocalUserData(owner),
            resetCache: () => DB.resetCache(),
            resetStore: () => useAppStore.getState().resetStore(),
        };

        const recoverByDevice = async (force: boolean) => {
            const now = Date.now();
            if (!force && now < nextDeviceRecoveryAt) return { status: 'none' as const };

            nextDeviceRecoveryAt = now + DEVICE_RECOVERY_FAILURE_RETRY_MS;
            try {
                const outcome = await recoverDeletedAccountOnThisDevice(
                    uid => finalizeCompletedDeletionForUid(uid, completionContext),
                );
                nextDeviceRecoveryAt = Date.now() + DEVICE_RECOVERY_RECHECK_INTERVAL_MS;
                return outcome;
            } catch (error) {
                nextDeviceRecoveryAt = Date.now() + DEVICE_RECOVERY_FAILURE_RETRY_MS;
                throw error;
            }
        };

        const showPending = async (message: string) => {
            if (!disposed) await useDialogStore.getState().showAlert(message);
        };

        const reconcile = async (forceDeviceRecovery = false) => {
            if (disposed || running) return;
            if (typeof navigator !== 'undefined' && !navigator.onLine) return;

            running = true;
            let pendingDeletion: boolean | null = null;
            try {
                pendingDeletion = Boolean(findPendingAccountDeletion());
                if (!pendingDeletion) {
                    const recovery = await recoverByDevice(forceDeviceRecovery);
                    if (recovery.status === 'pending') await showPending(recovery.message);
                    return;
                }

                try {
                    const outcome = await resumeAccountDeletion(completionContext);
                    if (outcome?.status === 'pending') await showPending(outcome.message);
                } catch (error) {
                    if (!(error instanceof AccountDeletionReceiptNotFoundError)) throw error;
                    const recovery = await recoverByDevice(true);
                    if (recovery.status === 'complete') return;
                    if (recovery.status === 'pending') {
                        await showPending(recovery.message);
                        return;
                    }
                    throw error;
                }
            } catch (error) {
                reportError(error, { source: 'account_deletion_recovery' });
                console.warn('Recovery cancellazione account non completato:', error);

                const shouldSurface = pendingDeletion !== false
                    || error instanceof DeletionRecoveryFinalizationError;
                if (shouldSurface && !disposed) {
                    const message = error instanceof DeletionRecoveryFinalizationError
                        ? error.message
                        : pendingDeletion === true && error instanceof Error
                            ? error.message
                            : UNKNOWN_RECOVERY_MESSAGE;
                    await useDialogStore.getState().showAlert(message);
                }
            } finally {
                running = false;
            }
        };

        void reconcile(true);
        const handleOnline = () => { void reconcile(true); };
        const handleFocus = () => { void reconcile(false); };
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') void reconcile(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            disposed = true;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    return null;
}