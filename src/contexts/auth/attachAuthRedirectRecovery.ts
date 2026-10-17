import type { RefObject } from 'react';
import { auth, getRedirectResult } from '../../lib/firebase';
import { readBrowserValue, tryRemoveBrowserValue } from '../../lib/sync/browserStorage';
import { safeHardReload } from '../../lib/sync/safeReload';

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

    environment.getRedirect().then(() => {
        environment.remove(awaitingRedirectKey);
    }).catch(() => {
        environment.remove(awaitingRedirectKey);
        console.error('Ripresa redirect Google non riuscita.');
        setSaveError("Accesso Google non completato. Riprova.");
    });

    return detachVisibility;
}
