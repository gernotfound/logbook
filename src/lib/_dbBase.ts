import { auth } from './firebase';
import type { SyncResult } from '../types';
import { assertOrdinaryPurgeAllowed, assertNoOutdatedConsentJournal, purgeAllLocalUserData, purgeCompletedAccountLocalData, deleteAccount, type AccountDeletionContext } from './db/db_account';
import { storageOwner } from './sync/session';
import { isAccountDeletionPending } from './sync/accountGate';
import { classifySyncFailure } from './sync/syncFailure';
import { replicateJournal } from './sync/replicateJournal';
import { removeDeletionRecoveryCredential } from './deletionDeviceRecovery';

export const DB = {
    // Kept as a compatibility hook for account lifecycle and legacy callers;
    // cloud sync no longer stores a redundant serialized user-state snapshot.
    resetCache() {
        return;
    },
    async saveUserData(_state: Record<string, any>, _revision?: any): Promise<SyncResult> {
        const user = auth.currentUser;
        if (!user) return { ok: true, status: 'synced' };
        try {
            const result = await replicateJournal();
            return result;
        } catch (error) {
            console.error('Errore durante il salvataggio:', error);
            return classifySyncFailure(error);
        }
    },
    async purgeAllLocalUserData(owner?: string) {
        return purgeAllLocalUserData(owner);
    },
    async purgeCompletedAccountLocalData(owner: string) {
        return purgeCompletedAccountLocalData(owner);
    },
    async secureLogOut() {
        console.log("Eseguo il Log Out protetto...");
        const owner = storageOwner();
        const uid = owner.startsWith('user:') ? owner.slice('user:'.length) : null;
        if (isAccountDeletionPending(owner)) {
            throw new Error('Cancellazione account in sospeso: non è possibile uscire eliminando i dati locali.');
        }
        // Check BEFORE invalidating Firebase Auth. Otherwise the pending
        // withdrawal cannot be resubmitted after the local purge.
        assertOrdinaryPurgeAllowed(owner);
        await assertNoOutdatedConsentJournal(owner);
        assertOrdinaryPurgeAllowed(owner);
        await auth.signOut();
        await this.purgeAllLocalUserData(owner);
        if (uid) removeDeletionRecoveryCredential(uid);
        this.resetCache();
    },
    async deleteAccount(lifecycle: Pick<AccountDeletionContext, 'cancelPendingSyncs' | 'resetStore'>) {
        return deleteAccount({
            purgeAllLocalUserData: owner => purgeCompletedAccountLocalData(owner),
            resetCache: () => this.resetCache(),
            ...lifecycle,
        });
    }
};
