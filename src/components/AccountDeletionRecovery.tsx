import { useEffect } from 'react';
import { DB } from '../lib/db';
import { ensureAccountDeletionRecoveryCredential, resumeAccountDeletion, resumeRegisteredAccountDeletion } from '../lib/db/db_account';
import { findPendingAccountDeletion } from '../lib/sync/accountGate';
import { useDialogStore } from '../store/useDialogStore';

/**
 * Reconciles a durable server-deletion receipt after reload/Auth removal.
 * It deliberately never blocks rendering: offline startup must continue from the
 * preserved local envelope and recovery is retried on the next online event.
 */
export function AccountDeletionRecovery() {
    useEffect(() => {
        let disposed = false;
        let running = false;

        const reconcile = async () => {
            if (disposed || running) return;
            if (typeof navigator !== 'undefined' && !navigator.onLine) return;
            running = true;
            try {
                const pendingDeletion = findPendingAccountDeletion();
                // A persisted receipt is already sufficient to resume the job.
                // Do not put preregistration first: refresh tokens may have been
                // revoked already, so an authenticated PUT can legitimately fail.
                if (!pendingDeletion) {
                    try {
                        await ensureAccountDeletionRecoveryCredential();
                    } catch (error) {
                        console.warn('Preregistrazione recovery cancellazione non disponibile:', error);
                    }
                }
                const context = {
                    purgeAllLocalUserData: (owner: string, options?: { preserveDeletionRecovery?: boolean }) =>
                        DB.purgeAllLocalUserData(owner, options),
                    resetCache: () => DB.resetCache(),
                };
                const outcome = pendingDeletion
                    ? await resumeAccountDeletion(context)
                    : await resumeRegisteredAccountDeletion(context);
                if (!disposed && outcome?.status === 'pending') {
                    await useDialogStore.getState().showAlert(outcome.message);
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
        const handleOnline = () => { void reconcile(); };
        window.addEventListener('online', handleOnline);
        return () => {
            disposed = true;
            window.removeEventListener('online', handleOnline);
        };
    }, []);

    return null;
}
