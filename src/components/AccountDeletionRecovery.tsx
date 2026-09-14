import { useEffect } from 'react';
import { DB } from '../lib/db';
import { resumeAccountDeletion } from '../lib/db/db_account';
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
            if (disposed || running || !findPendingAccountDeletion()) return;
            if (typeof navigator !== 'undefined' && !navigator.onLine) return;
            running = true;
            try {
                const outcome = await resumeAccountDeletion({
                    purgeAllLocalUserData: owner => DB.purgeAllLocalUserData(owner),
                    resetCache: () => DB.resetCache(),
                });
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
