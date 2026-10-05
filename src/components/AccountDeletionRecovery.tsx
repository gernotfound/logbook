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
import { recoverDeletedAccountOnThisDevice } from '../lib/deletionDeviceRecovery';

/**
 * Reconciles a durable server-deletion receipt after reload/Auth removal.
 * It deliberately never blocks rendering: offline startup must continue from the
 * preserved local envelope and recovery is retried on later lifecycle opportunities.
 */
export function AccountDeletionRecovery() {
    useEffect(() => {
        let disposed = false;
        let running = false;

        const completionContext: AccountDeletionCompletionContext = {
            purgeAllLocalUserData: owner => DB.purgeAllLocalUserData(owner),
            resetCache: () => DB.resetCache(),
            resetStore: () => useAppStore.getState().resetStore(),
        };

        const recoverByDevice = () => recoverDeletedAccountOnThisDevice(
            uid => finalizeCompletedDeletionForUid(uid, completionContext),
        );

        const showPending = async (message: string) => {
            if (!disposed) await useDialogStore.getState().showAlert(message);
        };

        const reconcile = async () => {
            if (disposed || running) return;
            if (typeof navigator !== 'undefined' && !navigator.onLine) return;
            running = true;
            try {
                if (!findPendingAccountDeletion()) {
                    const recovery = await recoverByDevice();
                    if (recovery.status === 'pending') await showPending(recovery.message);
                    return;
                }

                try {
                    const outcome = await resumeAccountDeletion(completionContext);
                    if (outcome?.status === 'pending') await showPending(outcome.message);
                } catch (error) {
                    if (!(error instanceof AccountDeletionReceiptNotFoundError)) throw error;
                    const recovery = await recoverByDevice();
                    if (recovery.status === 'complete') return;
                    if (recovery.status === 'pending') {
                        await showPending(recovery.message);
                        return;
                    }
                    throw error;
                }
            } catch (error) {
                if (!disposed) {
                    const message = error instanceof Error
                        ? error.message
                        : 'Impossibile verificare la cancellazione account. Copia locale conservata.';
                    await useDialogStore.getState().showAlert(message);
                }
            } finally {
                running = false;
            }
        };

        void reconcile();
        const handleRetry = () => { void reconcile(); };
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') void reconcile();
        };
        window.addEventListener('online', handleRetry);
        window.addEventListener('focus', handleRetry);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            disposed = true;
            window.removeEventListener('online', handleRetry);
            window.removeEventListener('focus', handleRetry);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    return null;
}
