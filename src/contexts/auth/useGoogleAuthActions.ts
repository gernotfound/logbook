import { useCallback, type RefObject } from 'react';
import { auth, provider, signInWithPopup, signInWithRedirect } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { AWAITING_REDIRECT_KEY, isCurrentAuthRedirectAttempt, writeAuthRedirectMarker, tryRemoveAuthRedirectMarker } from '../../lib/auth/authRedirectMarker';
import { beginGuestMigrationIntent, clearGuestMigrationIntent, confirmGuestMigrationCredential, rejectGuestMigrationAuthWaiters } from '../../lib/auth/guestMigrationIntent';
import { captureAuthAttemptGuard } from '../../lib/auth/authAttemptGuard';
import { classifyGooglePopupFailure } from './googlePopup';
import type { GuestMigrationPolicy } from '../AuthContextDef';
import type { UserData } from '../../types';

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
        let attempt: string | null = null;
        try {
            attempt = writeAuthRedirectMarker('true');
            await signInWithRedirect(auth, provider);
        } catch (error) {
            // An older failing redirect cannot clear a newer attempt (or
            // veto its foreground completion via the shared failure ref).
            if (attempt !== null && !isCurrentAuthRedirectAttempt(attempt)) return;
            redirectLaunchFailedRef.current = true;
            if (attempt !== null && !tryRemoveAuthRedirectMarker(AWAITING_REDIRECT_KEY, attempt)
                && isCurrentAuthRedirectAttempt(attempt)) {
                try {
                    writeAuthRedirectMarker('failed');
                } catch {
                    console.error('Impossibile rendere non attivo lo stato locale dopo un redirect Google non avviato.');
                }
            }
            throw error;
        }
    }, [redirectLaunchFailedRef]);

    // Both entry points authenticate first; the provider owns the later guest handoff.
    const login = useCallback(async (guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        const guestActive = isGuestActiveStrict();
        const stillOriginalAttempt = captureAuthAttemptGuard(guestActive);
        let intentId: string | null = null;
        if (guestActive) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            intentId = (await beginGuestMigrationIntent(guestPolicy, 'google', {
                assertCurrent: () => isGuestActiveStrict() && stillOriginalAttempt(),
            })).id;
        }
        // The reservation can suspend on cross-tab locks. Its completion does
        // not authorize opening a popup for a session that changed meanwhile.
        if (!stillOriginalAttempt()) { await abandonOwnGuestIntent(intentId); return; }
        let credential: Awaited<ReturnType<typeof signInWithPopup>>;
        try {
            credential = await signInWithPopup(auth, provider);
        } catch (error) {
            if (!stillOriginalAttempt()) { await abandonOwnGuestIntent(intentId); return; }
            const failure = classifyGooglePopupFailure(error);
            if (failure === 'redirect') {
                try {
                    await startGoogleRedirect();
                } catch {
                    await abandonOwnGuestIntent(intentId);
                    if (!stillOriginalAttempt()) return;
                    console.error('Accesso Google tramite redirect non riuscito.');
                    setSaveError("Accesso fallito. Riprova.");
                }
            } else if (failure === 'cancelled') {
                await abandonOwnGuestIntent(intentId);
            } else if (failure === 'network') {
                await abandonOwnGuestIntent(intentId);
                if (!stillOriginalAttempt()) return;
                setSaveError("Connessione non disponibile. Riprova quando sei online.");
            } else if (failure === 'error') {
                await abandonOwnGuestIntent(intentId);
                if (!stillOriginalAttempt()) return;
                console.error('Accesso Google non riuscito.');
                setSaveError('Accesso Google non riuscito. Riprova.');
            }
            return;
        }
        const resultSession = captureAuthAttemptGuard(false);
        const resultIsCurrent = () => auth.currentUser?.uid === credential.user.uid && resultSession();
        if (intentId) {
            try {
                await confirmGuestMigrationCredential(intentId, credential, resultIsCurrent);
            } catch (error) {
                rejectGuestMigrationAuthWaiters(intentId, 'Risultato di questo accesso Google non verificabile.');
                console.error('Prova dell’accesso Google non confermata:', error);
                if (resultIsCurrent()) setSaveError('Accesso effettuato, ma trasferimento guest non autorizzato. I dati locali sono conservati: riprova scegliendo come gestirli.');
            }
        }
    }, [isGuestActiveStrict, setSaveError, startGoogleRedirect]);

    const linkGoogleAccount = useCallback(async (guestPolicy?: GuestMigrationPolicy) => {
        migrationDataRef.current = useAppStore.getState().userData;
        await login(guestPolicy);
    }, [login, migrationDataRef]);

    return { login, linkGoogleAccount };
}
