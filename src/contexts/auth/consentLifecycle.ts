import type { User } from 'firebase/auth';
import { auth, getDb, waitForPendingWrites } from '../../lib/firebase';
import { isAccountDeletionPending } from '../../lib/sync/accountGate';
import { refreshHealthConsent, isHealthConsentWritable, suspendHealthConsentCloudAccess } from '../../lib/healthConsent';
import { useAppStore } from '../../store/useAppStore';
import { isVaultUnlocked } from '../../lib/sync/secureArchiveSession';
import { captureSession, isCurrentSession, userOwner } from '../../lib/sync/session';

type ConsentLifecycleDependencies = {
    isMounted: () => boolean;
    isGuestActiveStrict: () => boolean;
    loadData: (user: User) => Promise<void>;
    setLoading: (loading: boolean) => void;
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
};

// Event handlers are scoped to one AuthProvider effect lifecycle. The provider
// still owns listener registration/cleanup and authenticated bootstrap.
export function createAuthConsentLifecycleHandlers({
    isMounted, isGuestActiveStrict, loadData, setLoading, setSaveError,
}: ConsentLifecycleDependencies) {
        let isReloading = false;
        let reactivationRequest = 0;
        const handleConsentReactivated = (event: Event) => {
            const uid = (event as CustomEvent<{uid:string}>).detail?.uid;
            const current = auth.currentUser;
            if (!isMounted() || !current || current.uid !== uid || isGuestActiveStrict()
                || !isHealthConsentWritable(userOwner(uid))) return;
            const session = captureSession();
            if (session.owner !== userOwner(uid)) return;
            const request = ++reactivationRequest;
            const stillCurrent = () => isMounted() && auth.currentUser?.uid === uid
                && isCurrentSession(session) && request === reactivationRequest;
            setLoading(true);
            loadData(current).catch(error => {
                if (!stillCurrent()) return;
                console.error('Hydration dopo nuovo consenso non riuscita:', error);
                setSaveError('Nuovo consenso registrato, ma i dati non sono ancora disponibili. Riprova dopo aver verificato la connessione.');
            }).finally(() => {
                if (stillCurrent()) setLoading(false);
            });
        };
        window.addEventListener('logbook:health-consent-reactivated', handleConsentReactivated);

        const handleVisibilityChange = async (event?: Event) => {
            if (isGuestActiveStrict() || isReloading) return;
            // The "online" event must check consent even if this tab is hidden.
            if (event?.type !== 'online' && document.visibilityState !== 'visible') return;
            const user = auth.currentUser;
            if (!user || user.emailVerified === false || !navigator.onLine
                || !isVaultUnlocked(userOwner(user.uid))
                || isAccountDeletionPending(userOwner(user.uid))) return;

            isReloading = true;
            const uid = user.uid;
            try {
                // A cached offline approval only authorizes local actions. On
                // reconnect/foreground check the server BEFORE cloud hydration
                // or delivering a journal that accumulated while disconnected.
                const status = await refreshHealthConsent(user);
                if (!isMounted() || auth.currentUser?.uid !== uid || isGuestActiveStrict()) return;
                if (status !== 'active') {
                    useAppStore.getState().cancelPendingSyncs();
                    return;
                }
                if (useAppStore.getState().syncing) return;
                await Promise.race([
                    waitForPendingWrites(getDb()),
                    new Promise(resolve => setTimeout(resolve, 1500))
                ]);
                if (!isMounted() || auth.currentUser?.uid !== uid
                    || !isHealthConsentWritable(userOwner(uid))) return;
                await loadData(user);
            } catch (error) {
                console.warn('Verifica consenso/aggiornamento dopo riconnessione non riusciti:', error);
            } finally {
                isReloading = false;
            }
        };
        const handleOffline = () => {
            const uid = auth.currentUser?.uid;
            if (uid) suspendHealthConsentCloudAccess(uid);
        };
        return { handleConsentReactivated, handleVisibilityChange, handleOffline };
}
