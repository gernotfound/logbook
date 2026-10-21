import { useCallback, type RefObject } from 'react';
import { auth, provider, signInWithPopup, signInWithRedirect } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { writeBrowserValue, tryRemoveBrowserValue } from '../../lib/sync/browserStorage';
import { beginGuestMigrationIntent, clearGuestMigrationIntent, confirmGuestMigrationCredential, rejectGuestMigrationAuthWaiters } from '../../lib/auth/guestMigrationIntent';
import { classifyGooglePopupFailure } from './googlePopup';
import type { GuestMigrationPolicy } from '../AuthContextDef';
import type { UserData } from '../../types';

const AWAITING_REDIRECT_KEY = 'logbook_awaiting_redirect';

// An auth failure owns only the attempt it started. A stale popup callback
// must not erase a guest migration intent replaced by a newer login/tab.
async function abandonOwnGuestIntent(intentId: string | null): Promise<void> {
    if (intentId === null) return;
    try { await clearGuestMigrationIntent(intentId); }
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
            const guestSession = captureSession();
            intentId = (await beginGuestMigrationIntent(guestPolicy, 'google', {
                assertCurrent: () => isGuestActiveStrict() && isCurrentSession(guestSession),
            })).id;
        }
        let credential: Awaited<ReturnType<typeof signInWithPopup>>;
        try {
            credential = await signInWithPopup(auth, provider);
        } catch (error: any) {
            const failure = classifyGooglePopupFailure(error);
            if (failure === 'redirect') {
                try {
                    await startGoogleRedirect();
                } catch {
                    await abandonOwnGuestIntent(intentId);
                    console.error('Accesso Google tramite redirect non riuscito.');
                    setSaveError("Accesso fallito. Riprova.");
                }
            } else if (failure === 'cancelled') {
                await abandonOwnGuestIntent(intentId);
            } else if (failure === 'network') {
                await abandonOwnGuestIntent(intentId);
                setSaveError("Connessione non disponibile. Riprova quando sei online.");
            } else if (failure === 'error') {
                await abandonOwnGuestIntent(intentId);
                console.error('Accesso Google non riuscito.');
                setSaveError('Accesso Google non riuscito. Riprova.');
            }
            return;
        }
        if (intentId) {
            try {
                await confirmGuestMigrationCredential(intentId, credential);
            } catch (error) {
                rejectGuestMigrationAuthWaiters(intentId, 'Risultato di questo accesso Google non verificabile.');
                console.error('Prova dell’accesso Google non confermata:', error);
                setSaveError('Accesso effettuato, ma trasferimento guest non autorizzato. I dati locali sono conservati: riprova scegliendo come gestirli.');
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
            const guestSession = captureSession();
            intentId = (await beginGuestMigrationIntent(guestPolicy, 'google', {
                assertCurrent: () => isGuestActiveStrict() && isCurrentSession(guestSession),
            })).id;
        }
        let credential: Awaited<ReturnType<typeof signInWithPopup>>;
        try {
            credential = await signInWithPopup(auth, provider);
        } catch (error: any) {
            const failure = classifyGooglePopupFailure(error);
            if (failure === 'redirect') {
                try {
                    await startGoogleRedirect();
                } catch {
                    await abandonOwnGuestIntent(intentId);
                    console.error('Collegamento Google tramite redirect non riuscito.');
                    setSaveError("Accesso fallito. Riprova.");
                }
                return;
            }
            if (failure === 'cancelled') {
                await abandonOwnGuestIntent(intentId);
                return;
            }
            if (failure === 'network') {
                await abandonOwnGuestIntent(intentId);
                setSaveError("Connessione non disponibile. Riprova quando sei online.");
                return;
            }
            if (failure === 'error') {
                await abandonOwnGuestIntent(intentId);
                console.error('Collegamento account Google non riuscito.');
                setSaveError("Collegamento fallito. Riprova.");
            }
            return;
        }
        if (intentId) {
            try {
                await confirmGuestMigrationCredential(intentId, credential);
            } catch (error) {
                rejectGuestMigrationAuthWaiters(intentId, 'Risultato di questo collegamento Google non verificabile.');
                console.error('Prova del collegamento Google non confermata:', error);
                setSaveError('Account collegato, ma trasferimento guest non autorizzato. I dati locali sono conservati: riprova scegliendo come gestirli.');
            }
        }
    }, [isGuestActiveStrict, migrationDataRef, setSaveError, startGoogleRedirect]);

    return { login, linkGoogleAccount };
}
