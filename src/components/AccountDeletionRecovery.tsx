import { useEffect } from 'react';
import { DB } from '../lib/db';
import {
    AccountDeletionReceiptNotFoundError,
    finalizeCompletedDeletionForUid,
    resumeAccountDeletion,
    type AccountDeletionCompletionContext,
} from '../lib/db/db_account';
import { listPendingAccountDeletions } from '../lib/sync/accountGate';
import { useDialogStore } from '../store/useDialogStore';
import { useAppStore } from '../store/useAppStore';
import {
    DeletionRecoveryFinalizationError,
    recoverDeletedAccountOnThisDevice,
} from '../lib/deletionDeviceRecovery';
import { reportError } from '../lib/errorHandler';
import { RecoveryDiagnosticTracker } from '../lib/deletionRecoveryDiagnostics';

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
        const diagnostics = new RecoveryDiagnosticTracker();
        const lastAlertAt = new Map<string, number>();

        const completionContext: AccountDeletionCompletionContext = {
            purgeAllLocalUserData: owner => DB.purgeCompletedAccountLocalData(owner),
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

        const showPending = (message: string, category: string) => {
            // Lifecycle events may repeat the same incomplete recovery; do not
            // continually interrupt the user. The server/local safety gates remain active.
            const now = Date.now();
            if (now - (lastAlertAt.get(category) ?? -Infinity) < 60_000) return;
            lastAlertAt.set(category, now);
            if (!disposed) void useDialogStore.getState().showAlert(message).catch(error => {
                reportError(error, { source: 'account_deletion_recovery_dialog' });
            });
        };

        const recordFailure = (operation: 'routine-check' | 'pending-deletion' | 'local-finalization', error: unknown) =>
            diagnostics.recordFailure(operation, error, (summary, source) => {
                reportError(summary, { source });
                console.warn('Diagnostica tecnica recupero account:', summary.message);
            });

        const reconcile = async (forceDeviceRecovery = false) => {
            if (disposed || running) return;
            if (typeof navigator !== 'undefined' && !navigator.onLine) return;

            running = true;
            try {
                let pendingDeletion = false;
                let markerError: unknown;
                try {
                    const snapshot = listPendingAccountDeletions();
                    pendingDeletion = snapshot.markers.length > 0 || snapshot.corrupt.length > 0;
                    if (pendingDeletion) {
                        const outcome = await resumeAccountDeletion(completionContext);
                        diagnostics.recordSuccess('pending-deletion');
                        if (outcome?.status === 'pending') showPending(outcome.message, 'pending-deletion');
                    } else {
                        diagnostics.recordSuccess('pending-deletion');
                    }
                } catch (error) {
                    markerError = error;
                }

                // A device can prove that a different owner's deletion completed.
                // Always attempt it even if another marker is corrupt or failed.
                let deviceError: unknown;
                let deviceOutcome: Awaited<ReturnType<typeof recoverDeletedAccountOnThisDevice>> = { status: 'none' };
                try {
                    deviceOutcome = await recoverByDevice(forceDeviceRecovery || markerError instanceof AccountDeletionReceiptNotFoundError);
                    diagnostics.recordSuccess('routine-check');
                    if (deviceOutcome.status === 'pending') showPending(deviceOutcome.message, 'local-finalization-pending');
                } catch (error) {
                    deviceError = error;
                }

                if (markerError && !(markerError instanceof AccountDeletionReceiptNotFoundError && deviceOutcome.status !== 'none')) {
                    recordFailure('pending-deletion', markerError);
                    const message = markerError instanceof Error && pendingDeletion
                        ? markerError.message : UNKNOWN_RECOVERY_MESSAGE;
                    showPending(message, 'pending-deletion-error');
                }

                if (deviceError) {
                    const operation = deviceError instanceof DeletionRecoveryFinalizationError
                        ? 'local-finalization' : 'routine-check';
                    const failure = recordFailure(operation, deviceError);
                    if (deviceError instanceof DeletionRecoveryFinalizationError) {
                        showPending(deviceError.message, 'local-finalization-error');
                    } else if (failure.kind === 'remote-failed' || failure.kind === 'integrity'
                        || failure.kind === 'invalid-response' || (pendingDeletion && !markerError && !failure.transient)) {
                        showPending(UNKNOWN_RECOVERY_MESSAGE, 'device-recovery-error');
                    }
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