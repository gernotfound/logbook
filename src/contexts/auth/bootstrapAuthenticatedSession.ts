import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import type { UserData } from '../../types';
import { isAccountDeletionPending } from '../../lib/sync/accountGate';
import { refreshHealthConsent } from '../../lib/healthConsent';
import { userOwner } from '../../lib/sync/session';
import { ensureLocalVaultReady } from '../../lib/sync/secureArchiveUnlockFlow';
import { useAppStore } from '../../store/useAppStore';
import { guardAuthenticatedBootstrap } from './guardAuthenticatedBootstrap';
import { resumePersistedGuestMigration } from './resumePersistedGuestMigration';
import { startInitialGuestMigration } from './startInitialGuestMigration';

type GuestMigrationStatus = 'idle' | 'pending' | 'failed';
type BootstrapDependencies = {
    awaitingRedirectKey: string;
    guestKey: string;
    isGuestActiveStrict: () => boolean;
    readGuestMigrationRecoveryStrict: (uid: string) => boolean;
    isGuestRef: RefObject<boolean>;
    migrationDataRef: RefObject<UserData | null>;
    setIsGuest: Dispatch<SetStateAction<boolean>>;
    setCurrentUser: Dispatch<SetStateAction<User | null>>;
    setEmailVerificationRequired: Dispatch<SetStateAction<boolean>>;
    setGuestMigrationStatus: Dispatch<SetStateAction<GuestMigrationStatus>>;
    setLoading: Dispatch<SetStateAction<boolean>>;
    setUserData: ReturnType<typeof useAppStore.getState>['setUserData'];
    setSyncing: ReturnType<typeof useAppStore.getState>['setSyncing'];
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
    markGuestMigrationSyncRecovery: (uid: string) => string;
    clearGuestMigrationSyncRecovery: (uid: string, expectedId: string) => void;
    loadData: (user: User) => Promise<void>;
};

// The caller owns the Firebase Auth generation. Preserve the original ordering:
// owner gate -> deletion receipt -> account vault -> trusted consent -> data.
// No hydration or guest migration is authorized before consent is active.
export async function bootstrapAuthenticatedSession(
    user: User,
    isCurrentRun: () => boolean,
    {
        awaitingRedirectKey, guestKey, isGuestActiveStrict,
        readGuestMigrationRecoveryStrict, isGuestRef, migrationDataRef,
        setIsGuest, setCurrentUser, setEmailVerificationRequired,
        setGuestMigrationStatus, setLoading, setUserData, setSyncing,
        setSaveError, markGuestMigrationSyncRecovery,
        clearGuestMigrationSyncRecovery, loadData,
    }: BootstrapDependencies,
): Promise<void> {
    if (user && guardAuthenticatedBootstrap(user, {
        awaitingRedirectKey,
        isGuestActiveStrict, setCurrentUser, setEmailVerificationRequired,
        setGuestMigrationStatus, setLoading,
    })) return;
    // A deletion receipt is independently recoverable even while the
    // ciphertext is locked. Do not require the secret of an account
    // already deleted on the server just to finalize its local purge.
    if (user && isAccountDeletionPending(userOwner(user.uid))) {
        useAppStore.getState().cancelPendingSyncs();
        useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null });
        setCurrentUser(user);
        setLoading(false);
        return;
    }
    // Consent refresh itself performs a durable IndexedDB consent-epoch
    // update. Unlock BEFORE it, not merely before later hydration/sync.
    if (user) {
        await ensureLocalVaultReady(userOwner(user.uid));
        if (!isCurrentRun()) return;
    }
    // Expose identity only after the local archive can be safely read.
    if (user) setEmailVerificationRequired(false);
    setCurrentUser(user);
    if (user) {
        // Hydration/migration and all cloud business writes must wait for
        // this check; an offline/failed check remains fail-closed.
        const consentStatus = await refreshHealthConsent(user);
        if (!isCurrentRun()) return;
        if (consentStatus !== 'active') {
            // No regular hydration/migration/replica registration after a
            // withdrawal, even when a local cached envelope exists.
            useAppStore.getState().cancelPendingSyncs();
            setLoading(false);
            return;
        }
    }

    if (user) {
        const wasGuest = isGuestActiveStrict();
        setEmailVerificationRequired(false);
        const hasRecovery = readGuestMigrationRecoveryStrict(user.uid);

        if (hasRecovery) {
            setLoading(false);
            const handled = await resumePersistedGuestMigration(user, isCurrentRun, {
                guestKey,
                isGuestRef, migrationDataRef, setIsGuest,
                setGuestMigrationStatus, setSyncing, setSaveError,
                clearGuestMigrationSyncRecovery,
            });
            if (!isCurrentRun()) return;
            if (handled) return;
        }

        if (wasGuest) {
            let guestAlreadyRetired: boolean;
            try {
                guestAlreadyRetired = await startInitialGuestMigration(user, isCurrentRun, {
                    guestKey, isGuestRef, migrationDataRef, setIsGuest,
                    setGuestMigrationStatus, setLoading, setUserData, setSyncing, setSaveError,
                    markGuestMigrationSyncRecovery, clearGuestMigrationSyncRecovery,
                });
            } catch (error) {
                if (!isCurrentRun()) return;
                console.error('Coordinamento migrazione guest non riuscito:', error);
                setGuestMigrationStatus('failed');
                setSaveError('Impossibile coordinare il trasferimento dei dati locali. Archivio conservato: riprova.');
                setLoading(false);
                return;
            }
            if (guestAlreadyRetired && isCurrentRun()) {
                // Another tab finished or revoked this guest generation while
                // our bootstrap waited for the lifecycle lock. Its decision
                // does not authorize importing our stale in-memory guest view.
                // Keep all device records intact and require a safe reload.
                isGuestRef.current = false;
                setIsGuest(false);
                setGuestMigrationStatus('failed');
                setSaveError('La sessione locale è cambiata in un’altra scheda. I dati sul dispositivo sono conservati: riprova per aggiornare la sessione in sicurezza.');
                setLoading(false);
            }
        } else {
            setGuestMigrationStatus('idle');
            await loadData(user);
            if (isCurrentRun()) setLoading(false);
        }
    }
}
