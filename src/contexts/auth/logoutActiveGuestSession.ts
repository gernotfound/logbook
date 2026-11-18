import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { GUEST_KEY } from './useGuestLogin';
import {
    captureSession, GUEST_SESSION_KEY, isActiveGuestSession,
    isCurrentSession, revokeGuestSession,
} from '../../lib/sync/session';
import { withGuestLifecycleLock } from '../../lib/sync/guestLifecycleLock';
import { removeBrowserValue } from '../../lib/sync/browserStorage';

type GuestMigrationStatus = 'idle' | 'pending' | 'failed';
type GuestLogoutDependencies = {
    skipConfirm?: boolean;
    isGuestRef: RefObject<boolean>;
    setIsGuest: Dispatch<SetStateAction<boolean>>;
    setGuestMigrationStatus: Dispatch<SetStateAction<GuestMigrationStatus>>;
    purgeGuest: () => Promise<unknown>;
};

/**
 * Guest logout is independent of the account identity provider. The initial
 * guest generation is captured before confirmation; a cross-tab replacement
 * must fail the same lock-protected check before revocation or deletion.
 * The caller provides the purge operation, not an OAuth/Firebase session.
 */
export async function logoutActiveGuestSession({
    skipConfirm, isGuestRef, setIsGuest, setGuestMigrationStatus, purgeGuest,
}: GuestLogoutDependencies): Promise<void> {
    if (!isActiveGuestSession()) return;
    const requestedSession = captureSession();
    if (!skipConfirm) {
        const confirmed = await useDialogStore.getState().showConfirm(
            "Sei in modalità locale. Se esci, i tuoi dati su questo dispositivo andranno persi definitivamente e non potranno essere recuperati.\n\nSei sicuro di voler continuare?"
        );
        if (!confirmed) return;
    }

    const purgeOutcome = await Promise.resolve().then(() => withGuestLifecycleLock(async () => {
        // A new guest generation may have replaced the one that confirmed.
        if (!isCurrentSession(requestedSession)) return { purgeError: undefined };
        revokeGuestSession();
        useDialogStore.getState().cancelAll();
        useAppStore.getState().cancelPendingSyncs();
        let purgeError: unknown;
        try {
            await purgeGuest();
            removeBrowserValue(GUEST_KEY);
            removeBrowserValue(GUEST_SESSION_KEY);
        } catch (error) {
            purgeError = error;
        }
        isGuestRef.current = false;
        setIsGuest(false);
        setGuestMigrationStatus('idle');
        useAppStore.getState().resetStore({ force: true });
        return { purgeError };
    })).then(
        result => ({ ok: true as const, result }),
        () => ({ ok: false as const }),
    );
    if (!purgeOutcome.ok) {
        await useDialogStore.getState().showAlert(
            'Impossibile coordinare la chiusura della modalità locale. Nessuna nuova cancellazione viene avviata senza la protezione tra schede.'
        );
        return;
    }
    if (purgeOutcome.result.purgeError) {
        await useDialogStore.getState().showAlert(
            'Uscita dalla modalità locale, ma pulizia del dispositivo incompleta. I dati rimasti non sono accessibili dalla vecchia sessione; riprova dopo aver riaperto LogBook.'
        );
    }
}
