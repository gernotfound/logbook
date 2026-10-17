import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import { useAppStore } from '../../store/useAppStore';
import { isLegalConsentRequiredError, replicateJournal } from '../../lib/sync/replicateJournal';
import { userOwner } from '../../lib/sync/session';
import { removeBrowserValue } from '../../lib/sync/browserStorage';
import { clearGuestMigrationIntent } from '../../lib/auth/guestMigrationIntent';
import type { UserData } from '../../types';

type GuestMigrationStatus = 'idle' | 'pending' | 'failed';
type RecoveryDependencies = {
    guestKey: string;
    isGuestActiveStrict: () => boolean;
    isGuestRef: RefObject<boolean>;
    migrationDataRef: RefObject<UserData | null>;
    setIsGuest: Dispatch<SetStateAction<boolean>>;
    setGuestMigrationStatus: Dispatch<SetStateAction<GuestMigrationStatus>>;
    setUserData: ReturnType<typeof useAppStore.getState>['setUserData'];
    setSyncing: ReturnType<typeof useAppStore.getState>['setSyncing'];
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
    clearGuestMigrationSyncRecovery: (uid: string) => void;
};

// Called only after authenticated vault unlock and consent verification.
// The caller owns the current Auth generation and rejects stale continuations.
export async function resumePersistedGuestMigration(
    user: User, isCurrentRun: () => boolean, dependencies: RecoveryDependencies,
): Promise<boolean> {
    const {
        guestKey, isGuestActiveStrict, isGuestRef, migrationDataRef,
        setIsGuest, setGuestMigrationStatus, setUserData, setSyncing,
        setSaveError, clearGuestMigrationSyncRecovery,
    } = dependencies;
            if (!isCurrentRun()) return true;
            setGuestMigrationStatus('pending');

            let authenticatedEnvelope: Awaited<ReturnType<typeof import('../../lib/sync/localRepository')['readLocal']>>;
            try {
                const { readLocal } = await import('../../lib/sync/localRepository');
                if (!isCurrentRun()) return true;
                authenticatedEnvelope = await readLocal(user.uid);
            } catch (error) {
                if (!isCurrentRun()) return true;
                console.error('Recovery migrazione account non riuscita durante la lettura locale:', error);
                setGuestMigrationStatus('failed');
                setSaveError('Recovery account non completata. I dati locali sono stati lasciati intatti. Riprova.');
                return true;
            }

            if (!isCurrentRun()) return true;

            const guestStillActive = isGuestActiveStrict();
            if (!authenticatedEnvelope) {
                if (guestStillActive) {
                    clearGuestMigrationSyncRecovery(user.uid);
                    return false;
                }

                setGuestMigrationStatus('failed');
                setSaveError('Recovery account non completata: copia locale autenticata non disponibile. I dati non sono stati dichiarati sincronizzati.');
                return true;
            }

            setUserData(authenticatedEnvelope.data);

            if (guestStillActive) {
                useAppStore.getState().setLocalWorkout(authenticatedEnvelope.data.activeWorkout || null);
                try {
                    if (!isCurrentRun()) return true;
                    removeBrowserValue(guestKey);
                    try { clearGuestMigrationIntent(); } catch { /* recovery may predate the intent protocol */ }
                    isGuestRef.current = false;
                    setIsGuest(false);
                    migrationDataRef.current = null;
                } catch (error) {
                    if (!isCurrentRun()) return true;
                    console.error('Recovery migrazione account non riuscita durante il cambio owner:', error);
                    setGuestMigrationStatus('failed');
                    setSaveError('Recovery account non completata. La copia locale autenticata è conservata; riprova.');
                    return true;
                }
            }

            if (!isCurrentRun()) return true;
            setSyncing(true);
            try {
                const result = await replicateJournal(userOwner(user.uid));
                if (!isCurrentRun()) return true;

                if (result.status === 'synced' || result.status === 'local-pending') {
                    clearGuestMigrationSyncRecovery(user.uid);
                    setGuestMigrationStatus('idle');
                    if (result.status === 'local-pending') {
                        setSaveError(isLegalConsentRequiredError(result.error)
                            ? 'I dati sono salvati sul dispositivo. Accetta Termini e consenso salute per sincronizzarli con l’account.'
                            : '📶 Offline: i dati sono salvati sul dispositivo e verranno sincronizzati quando torni online.');
                    }
                } else {
                    setGuestMigrationStatus('failed');
                    setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
                }
            } catch (error) {
                if (!isCurrentRun()) return true;
                console.error('Recovery sincronizzazione account non riuscita:', error);
                setGuestMigrationStatus('failed');
                setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
            } finally {
                if (isCurrentRun()) setSyncing(false);
            }

            return true;
}
