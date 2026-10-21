import type { RefObject } from 'react';
import type { UserCredential } from 'firebase/auth';
import { auth, getRedirectResult } from '../../lib/firebase';
import { readBrowserValue, tryRemoveBrowserValue } from '../../lib/sync/browserStorage';
import { safeHardReload } from '../../lib/sync/safeReload';
import { confirmGuestMigrationCredential, readGuestMigrationTabReceipt, rejectGuestMigrationAuthWaiters } from '../../lib/auth/guestMigrationIntent';

type RedirectRecoveryEnvironment = {
    visibility: () => DocumentVisibilityState;
    listen: (callback: () => void) => () => void;
    read: (key: string) => string | null;
    remove: (key: string) => boolean;
    reload: () => Promise<void>;
    getRedirect: () => Promise<unknown>;
};

const browserEnvironment: RedirectRecoveryEnvironment = {
    visibility: () => document.visibilityState,
    listen: callback => {
        document.addEventListener('visibilitychange', callback);
        return () => document.removeEventListener('visibilitychange', callback);
    },
    read: readBrowserValue,
    remove: tryRemoveBrowserValue,
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
    const expectedIntentId = environment.read(awaitingRedirectKey) === 'true'
        ? readGuestMigrationTabReceipt() : null;
    const handleAuthVisibilityChange = async () => {
        if (redirectLaunchFailedRef.current) return;
        if (environment.visibility() !== 'visible' || environment.read(awaitingRedirectKey) !== 'true') return;
        if (!environment.remove(awaitingRedirectKey)) {
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
        environment.remove(awaitingRedirectKey);
    }).catch(() => {
        if (expectedIntentId) {
            rejectGuestMigrationAuthWaiters(expectedIntentId, 'Ripresa redirect Google non riuscita.');
        }
        environment.remove(awaitingRedirectKey);
        console.error('Ripresa redirect Google non riuscita.');
        setSaveError("Accesso Google non completato. Riprova.");
    });

    return detachVisibility;
}
