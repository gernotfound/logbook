import type { RefObject } from 'react';
import { auth, getRedirectResult } from '../../lib/firebase';
import { readBrowserValue, tryRemoveBrowserValue } from '../../lib/sync/browserStorage';
import { safeHardReload } from '../../lib/sync/safeReload';

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
}: RedirectRecoveryDependencies): () => void {
    const handleAuthVisibilityChange = async () => {
        if (redirectLaunchFailedRef.current) return;
        if (document.visibilityState !== 'visible' || readBrowserValue(awaitingRedirectKey) !== 'true') return;
        if (!tryRemoveBrowserValue(awaitingRedirectKey)) {
            setSaveError('Accesso completato, ma non riesco ad aggiornare lo stato locale del dispositivo. Riprova.');
            return;
        }
        try {
            await safeHardReload();
        } catch (error) {
            console.warn('Reload post-auth bloccato dalla barriera di persistenza:', error);
            setSaveError(error instanceof Error ? error.message : 'Ricaricamento non sicuro. Riprova.');
        }
    };
    document.addEventListener('visibilitychange', handleAuthVisibilityChange);

    getRedirectResult(auth).then(() => {
        tryRemoveBrowserValue(awaitingRedirectKey);
    }).catch(() => {
        tryRemoveBrowserValue(awaitingRedirectKey);
        console.error('Ripresa redirect Google non riuscita.');
        setSaveError("Accesso Google non completato. Riprova.");
    });

    return () => document.removeEventListener('visibilitychange', handleAuthVisibilityChange);
}
