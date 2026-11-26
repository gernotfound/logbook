import type { SyncResult } from '../types';
import { captureSession, isCurrentSession, storageOwner } from './sync/session';
import { classifySyncFailure } from './sync/syncFailure';
import type { DB as LegacyDB } from './_dbBase';
import type { loadCloudPayload } from './cloudPayloadLegacy';

// Keep the public DB contract while deferring Firebase-only operations to
// account paths. Guest writes are checked against the local journal itself.
export const DB = {
    async saveUserData(state: Record<string, any>, revision?: any): Promise<SyncResult> {
        try {
            const session = captureSession();
            if (session.owner === 'guest') {
                const { evaluateGuestJournal } = await import('./sync/guestJournalStatus');
                return evaluateGuestJournal(session);
            }
            const { DB: legacy } = await import('./_dbBase');
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata prima del salvataggio');
            return legacy.saveUserData(state, revision);
        } catch (error) {
            console.error('Errore durante il salvataggio:', error);
            return classifySyncFailure(error);
        }
    },
    async purgeAllLocalUserData(owner?: string): Promise<void> {
        const target = owner ?? storageOwner();
        if (target === 'guest') {
            const { purgeGuestLocalData } = await import('./db/guestLocalPurge');
            return purgeGuestLocalData();
        }
        const { DB: legacy } = await import('./_dbBase');
        return legacy.purgeAllLocalUserData(target);
    },
    async purgeCompletedAccountLocalData(owner: string): Promise<void> {
        const { DB: legacy } = await import('./_dbBase');
        return legacy.purgeCompletedAccountLocalData(owner);
    },
    async secureLogOut(options?: Parameters<typeof LegacyDB.secureLogOut>[0]): Promise<void> {
        const { DB: legacy } = await import('./_dbBase');
        return legacy.secureLogOut(options);
    },
    async deleteAccount(lifecycle: Parameters<typeof LegacyDB.deleteAccount>[0]): ReturnType<typeof LegacyDB.deleteAccount> {
        const { DB: legacy } = await import('./_dbBase');
        return legacy.deleteAccount(lifecycle);
    },
    async loadCloudPayload(options?: Parameters<typeof loadCloudPayload>[0]): ReturnType<typeof loadCloudPayload> {
        const legacy = await import('./cloudPayloadLegacy');
        return legacy.loadCloudPayload(options);
    },
};
