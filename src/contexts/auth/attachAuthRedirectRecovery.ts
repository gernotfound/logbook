import type { RefObject } from 'react';
import type { UserCredential } from 'firebase/auth';
import { auth, getRedirectResult } from '../../lib/firebase';
import { readAuthRedirectAttempt, readAuthRedirectMarker, tryRemoveAuthRedirectMarker } from '../../lib/auth/authRedirectMarker';
import { safeHardReload } from '../../lib/sync/safeReload';
import { confirmGuestMigrationCredential, readGuestMigrationTabReceipt, rejectGuestMigrationAuthWaiters } from '../../lib/auth/guestMigrationIntent';

type RedirectRecoveryEnvironment = {
    visibility: () => DocumentVisibilityState;
    listen: (callback: () => void) => () => void;
    read: (key: string) => string | null;
    readAttempt?: () => string | null;
    remove: (key: string, expectedAttempt?: string | null) => boolean;
    reload: () => Promise<void>;
    getRedirect: () => Promise<unknown>;
};

const browserEnvironment: RedirectRecoveryEnvironment = {
    visibility: () => document.visibilityState,
    listen: callback => {
        document.addEventListener('visibilitychange', callback);
        return () => document.removeEventListener('visibilitychange', callback);
    },
    read: readAuthRedirectMarker,
    readAttempt: readAuthRedirectAttempt,
    remove: tryRemoveAuthRedirectMarker,
    reload: safeHardReload,
    getRedirect: () => getRedirectResult(auth),
};

type RedirectRecoveryDependencies = {
    awaitingRedirectKey: string;
    redirectLaunchFailedRef: RefObject<boolean>;
    setSaveError: (message: string | null) => void;
};

// Redirect cleanup and foreground reconciliation belong to one provider
// lifetime. Never reload if the marker cannot be safely consumed or if
// the persistence barrier rejects the navigation.
export function attachAuthRedirectRecovery({
    awaitingRedirectKey, redirectLaunchFailedRef, setSaveError,
}: RedirectRecoveryDependencies, environment: RedirectRecoveryEnvironment = browserEnvironment): () => void {
    // Capture the intent receipt before Auth's first state callback can clear
    // the shared redirect flag. A Firebase auth event alone is not evidence
    // that this tab's redirect completed with that identity.
    const recoveringRedirect = environment.read(awaitingRedirectKey) === 'true';
    const capturedAttempt = recoveringRedirect ? (environment.readAttempt?.() ?? null) : null;
    const isOriginalAttemptCurrent = () => !recoveringRedirect
        || (environment.readAttempt?.() ?? null) === capturedAttempt;
    const expectedIntentId = recoveringRedirect ? readGuestMigrationTabReceipt() : null;
    let guestRedirectResultPending = Boolean(expectedIntentId);
    const handleAuthVisibilityChange = async () => {
        if (redirectLaunchFailedRef.current || guestRedirectResultPending) return;
        if (recoveringRedirect && !isOriginalAttemptCurrent()) return;
        if (environment.visibility() !== 'visible' || environment.read(awaitingRedirectKey) !== 'true') return;
        if (!environment.remove(awaitingRedirectKey,
            recoveringRedirect ? capturedAttempt : (environment.readAttempt?.() ?? null))) {
            setSaveError('Accesso completato, ma non riesco ad aggiornare lo stato locale del dispositivo. Riprova.');
            return;
        }
        try {
            await environment.reload();
        } catch (error) {
            console.warn('Reload post-auth bloccato dalla barriera di persistenza:', error);
            setSaveError(error instanceof Error ? error.message : 'Ricaricamento non sicuro. Riprova.');
        }
    };
    const detachVisibility = environment.listen(handleAuthVisibilityChange);

    environment.getRedirect().then(async result => {
        if (expectedIntentId) {
            const credential = result && typeof result === 'object' && 'user' in result
                ? result.user : null;
            if (!credential || typeof credential !== 'object' || !('uid' in credential)
                || typeof credential.uid !== 'string') {
                rejectGuestMigrationAuthWaiters(expectedIntentId, 'Redirect Google non confermato.');
                setSaveError('Accesso Google non confermato. Riprova.');
            } else {
                // The redirect SDK must provide the full originating credential,
                // including the provider of this *specific* Auth operation.
                if (!result || typeof result !== 'object' || !('providerId' in result)) {
                    rejectGuestMigrationAuthWaiters(expectedIntentId, 'Provider del redirect non verificabile.');
                    setSaveError('Accesso Google non confermato. Riprova.');
                } else {
                    await confirmGuestMigrationCredential(expectedIntentId, result as UserCredential);
                }
            }
        }
        if (recoveringRedirect && isOriginalAttemptCurrent()) {
            environment.remove(awaitingRedirectKey, capturedAttempt);
        }
    }).catch(() => {
        if (expectedIntentId) {
            rejectGuestMigrationAuthWaiters(expectedIntentId, 'Ripresa redirect Google non riuscita.');
        }
        if (recoveringRedirect && !isOriginalAttemptCurrent()) return;
        if (recoveringRedirect) environment.remove(awaitingRedirectKey, capturedAttempt);
        console.error('Ripresa redirect Google non riuscita.');
        setSaveError("Accesso Google non completato. Riprova.");
    }).finally(() => {
        guestRedirectResultPending = false;
    });

    return detachVisibility;
}
