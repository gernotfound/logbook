import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import type { UserData } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { draftRegistry } from '../../lib/utils/draftRegistry';
import { bindGuestMigrationIntentToUser, clearGuestMigrationIntent } from '../../lib/auth/guestMigrationIntent';
import { removeBrowserValue } from '../../lib/sync/browserStorage';
import { isLegalConsentRequiredError } from '../../lib/sync/replicateJournal';
import { migrateGuestAccount } from './migrateGuestAccount';
import { withGuestLifecycleLock } from '../../lib/sync/guestLifecycleLock';
import { readBrowserValueStrict } from '../../lib/sync/browserStorage';
import type { GuestMigrationPolicy } from '../AuthContextDef';

type GuestMigrationStatus = 'idle' | 'pending' | 'failed';
type InitialMigrationDependencies = {
    guestKey: string;
    isGuestRef: RefObject<boolean>;
    migrationDataRef: RefObject<UserData | null>;
    setIsGuest: Dispatch<SetStateAction<boolean>>;
    setGuestMigrationStatus: Dispatch<SetStateAction<GuestMigrationStatus>>;
    setLoading: Dispatch<SetStateAction<boolean>>;
    setUserData: ReturnType<typeof useAppStore.getState>['setUserData'];
    setSyncing: ReturnType<typeof useAppStore.getState>['setSyncing'];
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
    markGuestMigrationSyncRecovery: (uid: string) => void;
    clearGuestMigrationSyncRecovery: (uid: string) => void;
};

// The caller has verified identity, unlocked the account vault and refreshed
// server consent before starting this owner-changing lifecycle.
export async function startInitialGuestMigration(
    user: User, isCurrentRun: () => boolean, {
        guestKey, isGuestRef, migrationDataRef, setIsGuest,
        setGuestMigrationStatus, setLoading, setUserData, setSyncing,
        setSaveError, markGuestMigrationSyncRecovery, clearGuestMigrationSyncRecovery,
    }: InitialMigrationDependencies,
): Promise<void> {
    return withGuestLifecycleLock(async () => {
    // The reservation is immutable while this tab is transferring ownership.
    // A second tab observing the Firebase sign-in may not race the same guest
    // archive through a different choice or consume a completed handoff.
    if (readBrowserValueStrict(guestKey) !== 'true') return;
    if (!isCurrentRun()) return;
    setGuestMigrationStatus('pending');
    setLoading(false);
    draftRegistry.flushAll();
    const guestData = migrationDataRef.current || useAppStore.getState().userData;
    let policy: GuestMigrationPolicy;
    let intentId: string;
    try {
        const intent = await bindGuestMigrationIntentToUser(user);
        policy = intent.policy;
        intentId = intent.id;
    } catch (error) {
        if (!isCurrentRun()) return;
        console.error('Intento migrazione guest non determinabile:', error);
        setGuestMigrationStatus('failed');
        setSaveError('Non è possibile determinare il tentativo di trasferimento. Avvia di nuovo l’accesso e scegli come gestire i dati locali.');
        return;
    }
    try {
        const migrationResult = await migrateGuestAccount({
            user,
            guestData,
            policy,
            setUserData,
            setSyncing,
            isCurrent: isCurrentRun,
            onLocalReady: async () => {
                // Persist recovery before changing owner. If any critical
                // storage transition fails, migration remains recoverable.
                markGuestMigrationSyncRecovery(user.uid);
                removeBrowserValue(guestKey);
                await clearGuestMigrationIntent(intentId);
                isGuestRef.current = false;
                setIsGuest(false);
                migrationDataRef.current = null;
            },
        });
        if (!isCurrentRun()) return;
        if (migrationResult.status === 'rejected' || migrationResult.status === 'failed') {
            setGuestMigrationStatus('failed');
            setSaveError('I dati sono salvati su questo dispositivo, ma la sincronizzazione dell’account non è stata completata. Riprova.');
        } else {
            clearGuestMigrationSyncRecovery(user.uid);
            setGuestMigrationStatus('idle');
            if (migrationResult.status === 'local-pending') {
                setSaveError(isLegalConsentRequiredError(migrationResult.error)
                    ? 'Account preparato sul dispositivo. Accetta Termini e consenso salute per sincronizzare i progressi.'
                    : '📶 Offline: account preparato sul dispositivo. La sincronizzazione riprenderà quando torni online.');
            }
        }
    } catch (error) {
        if (!isCurrentRun()) return;
        console.error('Preparazione account da modalità locale non completata:', error);
        setGuestMigrationStatus('failed');
        setSaveError('Preparazione account non completata. I dati locali sono conservati e possono essere recuperati. Riprova.');
    }
    });
}
