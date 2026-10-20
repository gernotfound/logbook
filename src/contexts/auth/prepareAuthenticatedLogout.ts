import { auth } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { userOwner } from '../../lib/sync/session';
import { classifySyncFailure } from '../../lib/sync/syncFailure';
import { SyncTimeoutError } from '../../lib/db/db_core';

const LOGOUT_SYNC_CHECK_TIMEOUT_MS = 5000;

// The provider keeps the lifecycle lock, owner/delete gates and the only
// secureLogOut call. This preflight cannot purge an archive or sign out.
export async function prepareAuthenticatedLogout(
    initialUid: string | undefined,
    setSyncing: ReturnType<typeof useAppStore.getState>['setSyncing'],
): Promise<boolean | null> {
    // The preflight belongs to the account which initiated logout.
    if (!initialUid || auth.currentUser?.uid !== initialUid) return null;
    let discardUnsynced = false;
    setSyncing(true);
    // Firestore's write queue is separate from the durable IndexedDB journal.
    // Refresh the latter after any async boundary that can change this decision.
    const readDurablePending = async (): Promise<boolean | null> => {
        try {
            const { readLocal } = await import('../../lib/sync/localRepository');
            const envelope = await readLocal(userOwner(initialUid));
            if (auth.currentUser?.uid !== initialUid) return null;
            if (envelope?.cloudIntegrityFence) {
                await useDialogStore.getState().showAlert('Logout sospeso: lo snapshot cloud non è ancora verificato. La copia locale è preservata; riconnetti e completa il recupero prima di uscire.');
                return null;
            }
            return (envelope?.pending.length ?? 0) > 0;
        } catch {
            await useDialogStore.getState().showAlert('Non posso verificare i dati locali prima del logout. Archivio preservato: riprova dopo aver riaperto TheLogBook.');
            return null;
        }
    };
    let durablePending = await readDurablePending();
    if (durablePending === null) {
        setSyncing(false);
        return null;
    }
    const state = useAppStore.getState();
    let isSafe = state.syncHealth === 'synced' && !state.localWorkout && !state.userData?.pendingConflicts && !durablePending;
    let pendingWriteStatus: 'local-pending' | 'rejected' | 'failed' | null = null;

    if (!isSafe) {
        try {
            const { waitForPendingWrites } = await import('firebase/firestore');
            const { getDb } = await import('../../lib/firebase');

            const timeoutPromise = new Promise((_, reject) => setTimeout(
                () => reject(new SyncTimeoutError('Controllo sincronizzazione logout scaduto')),
                LOGOUT_SYNC_CHECK_TIMEOUT_MS
            ));
            await Promise.race([waitForPendingWrites(getDb()), timeoutPromise]);
        } catch (error) {
            const failure = classifySyncFailure(error);
            pendingWriteStatus = failure.status;
            if (failure.status !== 'local-pending') {
                console.warn('Controllo scritture pendenti durante logout fallito:', error);
            }
        }

        if (auth.currentUser?.uid !== initialUid) {
            setSyncing(false);
            return null;
        }

        const refreshedPending = await readDurablePending();
        if (refreshedPending === null) {
            setSyncing(false);
            return null;
        }
        durablePending = refreshedPending;
        const finalState = useAppStore.getState();
        isSafe = finalState.syncHealth === 'synced' && !finalState.localWorkout && !finalState.userData?.pendingConflicts && !durablePending && pendingWriteStatus === null;
    }
    setSyncing(false);

    if (!isSafe) {
        const finalState = useAppStore.getState();
        let reason: 'conflict' | 'offline' | 'rejected' | 'failed' = 'offline';

        if (finalState.userData?.pendingConflicts) {
            reason = 'conflict';
        } else if (finalState.syncHealth === 'rejected' || pendingWriteStatus === 'rejected') {
            reason = 'rejected';
        } else if (finalState.syncHealth === 'failed' || pendingWriteStatus === 'failed') {
            reason = 'failed';
        }

        const action = await useDialogStore.getState().showUnsyncedDataLogout(reason);

        if (auth.currentUser?.uid !== initialUid) {
            return null;
        }

        if (action === 'export') {
            const { Exporter } = await import('../../lib/export');
            const currentState = useAppStore.getState().userData;
            if (currentState) {
                Exporter.exportEmergencyJSON(currentState);
            }
            return null;
        }

        if (action === 'cancel' || action === 'wait') {
            return null;
        } else if (action === 'safe-exit') {
            // A new edit can reach IndexedDB while the dialog is visible.
            const latestPending = await readDurablePending();
            if (latestPending !== false || pendingWriteStatus !== null) return null;
            const finalCheck = useAppStore.getState();
            if (finalCheck.syncHealth !== 'synced' || finalCheck.localWorkout || finalCheck.userData?.pendingConflicts) {
                return null;
            }
        } else if (action === 'force-exit') {
            discardUnsynced = true;
        } else {
            return null;
        }
    }
    return discardUnsynced;
}
