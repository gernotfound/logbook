import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, reload } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { validatePasswordAgainstPolicy } from '../../lib/auth/passwordPolicy';
import { describeEmailAuthError } from '../../lib/auth/emailAuthError';
import { beginGuestMigrationIntent, clearGuestMigrationIntent, confirmGuestMigrationCredential, rejectGuestMigrationAuthWaiters } from '../../lib/auth/guestMigrationIntent';
import { captureAuthAttemptGuard } from '../../lib/auth/authAttemptGuard';
import { safeHardReload } from '../../lib/sync/safeReload';
import type { UserData } from '../../types';
import type { EmailVerificationRefreshResult, EmailVerificationSendResult, GuestMigrationPolicy } from '../AuthContextDef';

type EmailAuthDependencies = {
    isGuestActiveStrict: () => boolean;
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
    setEmailVerificationRequired: Dispatch<SetStateAction<boolean>>;
    migrationDataRef: RefObject<UserData | null>;
};

// The email sign-in/verification actions share the provider's guest migration
// intent and error boundary; they never authorize owner-scoped data hydration.
/** A failed asynchronous login may only retire its own Auth handoff. */
async function abandonOwnGuestIntent(id: string | null): Promise<void> {
    if (id === null) return;
    try { await clearGuestMigrationIntent(id); }
    catch { /* A newer Auth attempt owns the currently stored intent. */ }
}

const VERIFICATION_RECHECK_DELAYS_MS = [600, 1200] as const;

export function useEmailAuthActions({
    isGuestActiveStrict, setSaveError, setEmailVerificationRequired, migrationDataRef,
}: EmailAuthDependencies) {
    const handleAuthError = useCallback((error: unknown): never => {
        setSaveError(describeEmailAuthError(error));
        throw error;
    }, [setSaveError]);

    const loginWithEmail = useCallback(async (email: string, pass: string, guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        const stillOriginalAttempt = captureAuthAttemptGuard(isGuestActiveStrict());
        let intentId: string | null = null;
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            intentId = (await beginGuestMigrationIntent(guestPolicy, 'email', {
                email, assertCurrent: () => isGuestActiveStrict() && stillOriginalAttempt(),
            })).id;
        }
        if (!stillOriginalAttempt()) { await abandonOwnGuestIntent(intentId); return; }
        let credential: Awaited<ReturnType<typeof signInWithEmailAndPassword>>;
        try {
            credential = await signInWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            await abandonOwnGuestIntent(intentId);
            if (!stillOriginalAttempt()) return;
            return handleAuthError(error);
        }
        const resultSession = captureAuthAttemptGuard(false);
        const resultIsCurrent = () => auth.currentUser?.uid === credential.user.uid && resultSession();
        if (intentId) {
            try {
                await confirmGuestMigrationCredential(intentId, credential, resultIsCurrent);
            } catch (error) {
                rejectGuestMigrationAuthWaiters(intentId, 'Risultato di questo accesso email non verificabile.');
                console.error('Prova dell’accesso email non confermata:', error);
                if (resultIsCurrent()) setSaveError('Accesso effettuato, ma trasferimento guest non autorizzato. I dati locali sono conservati: riprova scegliendo come gestirli.');
            }
        }
    }, [handleAuthError, isGuestActiveStrict, setSaveError]);

    const registerWithEmail = useCallback(async (email: string, pass: string, guestPolicy?: GuestMigrationPolicy, isRequestCurrent?: () => boolean) => {
        setSaveError(null);
        const stillOriginalAttempt = captureAuthAttemptGuard(isGuestActiveStrict());
        // The initiating form can disappear while Firebase validates its policy.
        // The Auth epoch and form lifetime are independent cancellation gates.
        const stillRequested = () => stillOriginalAttempt() && (isRequestCurrent?.() ?? true);
        const weakError = await validatePasswordAgainstPolicy(pass);
        if (!stillRequested()) return;
        if (weakError) {
            const error = Object.assign(new Error(weakError), { code: 'auth/weak-password', policyFeedback: weakError });
            handleAuthError(error);
            return;
        }

        migrationDataRef.current = useAppStore.getState().userData;
        let intentId: string | null = null;
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            intentId = (await beginGuestMigrationIntent(guestPolicy, 'email', {
                email, assertCurrent: () => isGuestActiveStrict() && stillRequested(),
            })).id;
        }

        if (!stillRequested()) { await abandonOwnGuestIntent(intentId); return; }
        let credential: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>;
        try {
            credential = await createUserWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            await abandonOwnGuestIntent(intentId);
            if (!stillOriginalAttempt()) return;
            handleAuthError(error);
            return;
        }

        const resultSession = captureAuthAttemptGuard(false);
        const resultIsCurrent = () => auth.currentUser?.uid === credential.user.uid && resultSession();
        let proofFailed = false;
        if (intentId) {
            try {
                await confirmGuestMigrationCredential(intentId, credential, resultIsCurrent);
            } catch (error) {
                proofFailed = true;
                rejectGuestMigrationAuthWaiters(intentId, 'Risultato della registrazione email non verificabile.');
                console.error('Prova della registrazione email non confermata:', error);
                if (resultIsCurrent()) setSaveError('Registrazione effettuata, ma trasferimento guest non autorizzato. I dati locali sono conservati: riprova dopo la verifica.');
            }
        }

        if (resultIsCurrent() && !credential.user.emailVerified) {
            try {
                await sendEmailVerification(credential.user);
                if (!resultIsCurrent()) return;
                setSaveError(proofFailed
                    ? 'Verifica la tua email. I dati guest sono conservati: dopo la verifica conferma nuovamente la scelta di trasferimento.'
                    : 'Verifica la tua email per completare l’accesso. Ti abbiamo inviato un link di conferma.');
            } catch (error) {
                if (!resultIsCurrent()) return;
                console.error('Invio verifica email fallito:', error);
                setSaveError('Account creato, ma non è stato possibile inviare la verifica email. Usa “Invia di nuovo” e riprova.');
            }
        }
    }, [handleAuthError, isGuestActiveStrict, migrationDataRef, setSaveError]);

    const resendEmailVerification = useCallback(async (): Promise<EmailVerificationSendResult> => {
        const user = auth.currentUser;
        if (!user) throw new Error('Sessione non disponibile.');
        const session = captureSession();
        const stillCurrent = () => auth.currentUser === user && isCurrentSession(session);
        if (!stillCurrent()) return 'stale';
        if (user.emailVerified) return 'already-verified';
        try {
            await sendEmailVerification(user);
        } catch (error) {
            if (stillCurrent()) throw error;
            return 'stale';
        }
        if (!stillCurrent()) return 'stale';
        setSaveError('Email di verifica inviata. Controlla anche la cartella spam.');
        return 'sent';
    }, [setSaveError]);

    const refreshEmailVerification = useCallback(async (): Promise<EmailVerificationRefreshResult> => {
        const user = auth.currentUser;
        if (!user) throw new Error('Sessione non disponibile.');
        // A delayed SDK result belongs to this Auth epoch, including when the
        // same UID signs in again. It cannot change the next account's UI or
        // start a reload barrier for data it did not verify.
        const session = captureSession();
        const stillCurrent = () => auth.currentUser === user && isCurrentSession(session);
        try {
            // The confirmation link may complete just before Firebase exposes
            // emailVerified to this tab. Bound the recheck rather than requiring
            // a manual browser reload or polling indefinitely.
            for (let attempt = 0; attempt <= VERIFICATION_RECHECK_DELAYS_MS.length; attempt++) {
                await reload(user);
                if (!stillCurrent()) return 'stale';
                if (user.emailVerified) {
                    // Firebase's ID token may still contain email_verified=false after reload().
                    // Refresh its claims before resuming any owner-scoped cloud operation.
                    await user.getIdToken(true);
                    if (!stillCurrent()) return 'stale';
                    await safeHardReload();
                    return 'verified';
                }
                if (attempt < VERIFICATION_RECHECK_DELAYS_MS.length) {
                    await new Promise<void>(resolve => setTimeout(resolve, VERIFICATION_RECHECK_DELAYS_MS[attempt]));
                    if (!stillCurrent()) return 'stale';
                }
            }
            setEmailVerificationRequired(true);
            setSaveError('Email non ancora verificata. Apri il link ricevuto e riprova.');
            return 'pending';
        } catch (error) {
            if (stillCurrent()) throw error;
            return 'stale';
        }
    }, [setEmailVerificationRequired, setSaveError]);

    return { loginWithEmail, registerWithEmail, resendEmailVerification, refreshEmailVerification };
}
