import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import { useAppStore } from '../../store/useAppStore';
import { isLegalConsentRequiredError, replicateJournal } from '../../lib/sync/replicateJournal';
import { captureSession, isCurrentSession, userOwner } from '../../lib/sync/session';
import { markTabSnapshotClean } from '../../lib/sync/tabSnapshotCausality';
import { getInitialLocalWorkout } from '../../store/slices/createWorkoutSlice';
import { recoverWorkoutDeviceIntent } from '../../lib/sync/workoutDeviceIntent';
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
        setIsGuest, setGuestMigrationStatus, setSyncing,
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

            if (guestStillActive) {
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
            // Recovery publishes an existing durable owner envelope, not a new
            // user edit. setUserData() would attempt a semantic snapshot commit
            // from the old guest UI or trip the cross-owner persistence guard.
            try {
                const session = captureSession();
                if (session.owner !== userOwner(user.uid) || !isCurrentSession(session)) return true;
                // The same owner-scoped recovery precedes ordinary authenticated
                // hydration. Never expose an unapplied device write-ahead intent.
                await recoverWorkoutDeviceIntent(session.owner, () => isCurrentRun() && isCurrentSession(session));
                if (!isCurrentRun() || !isCurrentSession(session)) return true;
                const { readLocal } = await import('../../lib/sync/localRepository');
                const updatedEnvelope = await readLocal(user.uid);
                if (!updatedEnvelope) throw new Error('Archivio account scomparso durante il recupero workout.');
                if (!isCurrentRun() || !isCurrentSession(session)) return true;
                const recovered = updatedEnvelope.data;
                const workout = getInitialLocalWorkout(
                    session.owner, recovered.activeWorkout ?? null, recovered.history,
                    updatedEnvelope.lastClosedWorkoutId, updatedEnvelope.closedWorkoutIds,
                );
                if (!isCurrentRun() || !isCurrentSession(session)) return true;
                useAppStore.setState({
                    userData: recovered, dataOwner: session.owner, localWorkout: workout,
                    cloudIntegrityBlocked: Boolean(updatedEnvelope.cloudIntegrityFence),
                    syncHealth: updatedEnvelope.cloudIntegrityFence ? 'failed'
                        : updatedEnvelope.pending.length ? 'local-pending' : 'synced',
                });
                markTabSnapshotClean(session, recovered);
            } catch (error) {
                if (!isCurrentRun()) return true;
                console.error('Recovery account: pubblicazione dati locali non sicura:', error);
                setGuestMigrationStatus('failed');
                setSaveError('Recupero dell’archivio autenticato non completato. Dati preservati: riprova.');
                return true;
            }

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
