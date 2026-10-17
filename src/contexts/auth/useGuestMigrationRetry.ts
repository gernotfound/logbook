import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { auth } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { isLegalConsentRequiredError, replicateJournal } from '../../lib/sync/replicateJournal';
import { captureSession, isCurrentSession, userOwner } from '../../lib/sync/session';
import { beginGuestMigrationIntent } from '../../lib/auth/guestMigrationIntent';
import { safeHardReload } from '../../lib/sync/safeReload';
import type { GuestMigrationPolicy } from '../AuthContextDef';

type GuestMigrationStatus = 'idle' | 'pending' | 'failed';
type RetryDependencies = {
    isGuestActiveStrict: () => boolean;
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
    setSyncing: ReturnType<typeof useAppStore.getState>['setSyncing'];
    setGuestMigrationStatus: Dispatch<SetStateAction<GuestMigrationStatus>>;
    clearGuestMigrationSyncRecovery: (uid: string) => void;
};

// Owner fencing stays adjacent to journal replay; the provider owns session
// state and controls bootstrap, consent and the initial guest-to-account merge.
export function useGuestMigrationRetry({
    isGuestActiveStrict, setSaveError, setSyncing,
    setGuestMigrationStatus, clearGuestMigrationSyncRecovery,
}: RetryDependencies) {
    const retryGuestMigration = useCallback(async (policy?: GuestMigrationPolicy) => {
        setSaveError(null);

        if (isGuestActiveStrict()) {
            try {
                const uid = auth.currentUser?.uid;
                if (!uid || !policy) throw new Error('Scegli esplicitamente se trasferire o non trasferire i dati locali.');
                beginGuestMigrationIntent(policy, 'recovery', { uid });
                await safeHardReload();
            } catch (error) {
                setGuestMigrationStatus('failed');
                setSaveError(
                    error instanceof Error && error.message.includes('Scelta di trasferimento')
                        ? 'Scegli esplicitamente se trasferire o non trasferire i dati locali.'
                        : error instanceof Error ? error.message : 'Ricaricamento non sicuro. Riprova.'
                );
            }
            return;
        }

        const initialUid = auth.currentUser?.uid;
        if (!initialUid) {
            setGuestMigrationStatus('failed');
            setSaveError('Sincronizzazione account non completata. Accedi nuovamente e riprova.');
            return;
        }

        const session = captureSession();
        const expectedOwner = userOwner(initialUid);
        const isCurrentRetry = () => session.owner === expectedOwner
            && isCurrentSession(session)
            && auth.currentUser?.uid === initialUid
            && !isGuestActiveStrict();

        if (!isCurrentRetry()) return;

        setGuestMigrationStatus('pending');
        setSyncing(true);
        try {
            const result = await replicateJournal(expectedOwner);
            if (!isCurrentRetry()) return;

            if (result.status === 'synced' || result.status === 'local-pending') {
                clearGuestMigrationSyncRecovery(initialUid);
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
            if (!isCurrentRetry()) return;
            console.error('Retry sincronizzazione account non riuscito:', error);
            setGuestMigrationStatus('failed');
            setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
        } finally {
            if (isCurrentRetry()) setSyncing(false);
        }
    }, [clearGuestMigrationSyncRecovery, isGuestActiveStrict, setGuestMigrationStatus, setSaveError, setSyncing]);

    return retryGuestMigration;
}
