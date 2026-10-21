import { useCallback, type RefObject } from 'react';
import { auth, provider, signInWithPopup, signInWithRedirect } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { writeBrowserValue, tryRemoveBrowserValue } from '../../lib/sync/browserStorage';
import { beginGuestMigrationIntent, clearGuestMigrationIntent } from '../../lib/auth/guestMigrationIntent';
import { classifyGooglePopupFailure } from './googlePopup';
import type { GuestMigrationPolicy } from '../AuthContextDef';
import type { UserData } from '../../types';

const AWAITING_REDIRECT_KEY = 'logbook_awaiting_redirect';

// An auth failure owns only the attempt it started. A stale popup callback
// must not erase a guest migration intent replaced by a newer login/tab.
function abandonOwnGuestIntent(intentId: string | null): void {
    if (intentId === null) return;
    try { clearGuestMigrationIntent(intentId); }
    catch { /* Another attempt replaced/consumed the intent; preserve it. */ }
}

type GoogleAuthDependencies = {
    isGuestActiveStrict: () => boolean;
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
    migrationDataRef: RefObject<UserData | null>;
    redirectLaunchFailedRef: RefObject<boolean>;
};

// The provider still owns redirect-resume, owner validation and consent.
export function useGoogleAuthActions({
    isGuestActiveStrict, setSaveError, migrationDataRef, redirectLaunchFailedRef,
}: GoogleAuthDependencies) {
    const startGoogleRedirect = useCallback(async () => {
        redirectLaunchFailedRef.current = false;
        try {
            writeBrowserValue(AWAITING_REDIRECT_KEY, 'true');
            await signInWithRedirect(auth, provider);
        } catch (error) {
            redirectLaunchFailedRef.current = true;
            if (!tryRemoveBrowserValue(AWAITING_REDIRECT_KEY)) {
                try {
                    writeBrowserValue(AWAITING_REDIRECT_KEY, 'failed');
                } catch {
                    console.error('Impossibile rendere non attivo lo stato locale dopo un redirect Google non avviato.');
                }
            }
            throw error;
        }
    }, [redirectLaunchFailedRef]);

    // Login con Google (dalla schermata di login, nessun guest precedente)
    const login = useCallback(async (guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        let intentId: string | null = null;
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            intentId = beginGuestMigrationIntent(guestPolicy, 'google').id;
        }
        try {
            await signInWithPopup(auth, provider);
        } catch (error: any) {
            const failure = classifyGooglePopupFailure(error);
            if (failure === 'redirect') {
                try {
                    await startGoogleRedirect();
                } catch {
                    abandonOwnGuestIntent(intentId);
                    console.error('Accesso Google tramite redirect non riuscito.');
                    setSaveError("Accesso fallito. Riprova.");
                }
            } else if (failure === 'cancelled') {
                abandonOwnGuestIntent(intentId);
            } else if (failure === 'network') {
                abandonOwnGuestIntent(intentId);
                setSaveError("Connessione non disponibile. Riprova quando sei online.");
            } else if (failure === 'error') {
                abandonOwnGuestIntent(intentId);
                console.error('Accesso Google non riuscito.');
                setSaveError('Accesso Google non riuscito. Riprova.');
            }
        }
    }, [isGuestActiveStrict, setSaveError, startGoogleRedirect]);

    // Collega account Google: migra i dati locali su Firestore
    const linkGoogleAccount = useCallback(async (guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        migrationDataRef.current = useAppStore.getState().userData;
        let intentId: string | null = null;
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            intentId = beginGuestMigrationIntent(guestPolicy, 'google').id;
        }
        try {
            await signInWithPopup(auth, provider);
        } catch (error: any) {
            const failure = classifyGooglePopupFailure(error);
            if (failure === 'redirect') {
                try {
                    await startGoogleRedirect();
                } catch {
                    abandonOwnGuestIntent(intentId);
                    console.error('Collegamento Google tramite redirect non riuscito.');
                    setSaveError("Accesso fallito. Riprova.");
                }
                return;
            }
            if (failure === 'cancelled') {
                abandonOwnGuestIntent(intentId);
                return;
            }
            if (failure === 'network') {
                abandonOwnGuestIntent(intentId);
                setSaveError("Connessione non disponibile. Riprova quando sei online.");
                return;
            }
            if (failure === 'error') {
                abandonOwnGuestIntent(intentId);
                console.error('Collegamento account Google non riuscito.');
                setSaveError("Collegamento fallito. Riprova.");
            }
        }
    }, [isGuestActiveStrict, migrationDataRef, setSaveError, startGoogleRedirect]);

    return { login, linkGoogleAccount };
}
