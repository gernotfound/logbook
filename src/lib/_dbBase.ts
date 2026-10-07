import { auth } from './firebase';
import type { SyncResult } from '../types';
import { setLastSavedStateStr } from './db/db_core';
import { purgeAllLocalUserData, deleteAccount, type AccountDeletionContext } from './db/db_account';
import { storageOwner } from './sync/session';
import { classifySyncFailure } from './sync/syncFailure';
import { replicateJournal } from './sync/replicateJournal';
import { removeDeletionRecoveryCredential } from './deletionDeviceRecovery';

export const DB = {
    resetCache() {
        setLastSavedStateStr(null);
    },
    async saveUserData(state: Record<string, any>, _revision?: any): Promise<SyncResult> {
        const user = auth.currentUser;
        if (!user) return { ok: true, status: 'synced' };
        try {
            const result = await replicateJournal();
            if (result.ok) setLastSavedStateStr(JSON.stringify(state));
            return result;
        } catch (error) {
            console.error('Errore durante il salvataggio:', error);
            return classifySyncFailure(error);
        }
    },
    async purgeAllLocalUserData(owner?: string) {
        return purgeAllLocalUserData(owner);
    },
    async secureLogOut() {
        console.log("Eseguo il Log Out protetto...");
        const owner = storageOwner();
        const uid = owner.startsWith('user:') ? owner.slice('user:'.length) : null;
        await auth.signOut();
        await this.purgeAllLocalUserData(owner);
        if (uid) removeDeletionRecoveryCredential(uid);
        this.resetCache();
    },
    async deleteAccount(lifecycle: Pick<AccountDeletionContext, 'cancelPendingSyncs' | 'resetStore'>) {
        return deleteAccount({
            purgeAllLocalUserData: owner => this.purgeAllLocalUserData(owner),
            resetCache: () => this.resetCache(),
            ...lifecycle,
        });
    }
};
