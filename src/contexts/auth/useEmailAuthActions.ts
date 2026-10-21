import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, reload } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { validatePasswordAgainstPolicy } from '../../lib/auth/passwordPolicy';
import { describeEmailAuthError } from '../../lib/auth/emailAuthError';
import { beginGuestMigrationIntent, clearGuestMigrationIntent } from '../../lib/auth/guestMigrationIntent';
import { safeHardReload } from '../../lib/sync/safeReload';
import type { UserData } from '../../types';
import type { GuestMigrationPolicy } from '../AuthContextDef';

type EmailAuthDependencies = {
    isGuestActiveStrict: () => boolean;
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
    setEmailVerificationRequired: Dispatch<SetStateAction<boolean>>;
    migrationDataRef: RefObject<UserData | null>;
};

// The email sign-in/verification actions share the provider's guest migration
// intent and error boundary; they never authorize owner-scoped data hydration.
/** A failed asynchronous login may only retire its own Auth handoff. */
function abandonOwnGuestIntent(id: string | null): void {
    if (id === null) return;
    try { clearGuestMigrationIntent(id); }
    catch { /* A newer Auth attempt owns the currently stored intent. */ }
}

export function useEmailAuthActions({
    isGuestActiveStrict, setSaveError, setEmailVerificationRequired, migrationDataRef,
}: EmailAuthDependencies) {
    const handleAuthError = useCallback((error: unknown): never => {
        setSaveError(describeEmailAuthError(error));
        throw error;
    }, [setSaveError]);

    const loginWithEmail = useCallback(async (email: string, pass: string, guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        let intentId: string | null = null;
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            intentId = beginGuestMigrationIntent(guestPolicy, 'email', { email }).id;
        }
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            abandonOwnGuestIntent(intentId);
            handleAuthError(error);
        }
    }, [handleAuthError, isGuestActiveStrict, setSaveError]);

    const registerWithEmail = useCallback(async (email: string, pass: string, guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        const weakError = await validatePasswordAgainstPolicy(pass);
        if (weakError) {
            const error = Object.assign(new Error(weakError), { code: 'auth/weak-password' });
            handleAuthError(error);
            return;
        }

        migrationDataRef.current = useAppStore.getState().userData;
        let intentId: string | null = null;
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            intentId = beginGuestMigrationIntent(guestPolicy, 'email', { email }).id;
        }

        let credential: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>;
        try {
            credential = await createUserWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            abandonOwnGuestIntent(intentId);
            handleAuthError(error);
            return;
        }

        if (!credential.user.emailVerified) {
            try {
                await sendEmailVerification(credential.user);
                setSaveError('Verifica la tua email per completare l’accesso. Ti abbiamo inviato un link di conferma.');
            } catch (error) {
                console.error('Invio verifica email fallito:', error);
                setSaveError('Account creato, ma non è stato possibile inviare la verifica email. Usa “Invia di nuovo” e riprova.');
            }
        }
    }, [handleAuthError, isGuestActiveStrict, migrationDataRef, setSaveError]);

    const resendEmailVerification = useCallback(async () => {
        const user = auth.currentUser;
        if (!user || user.emailVerified) return;
        await sendEmailVerification(user);
        setSaveError('Email di verifica inviata. Controlla anche la cartella spam.');
    }, [setSaveError]);

    const refreshEmailVerification = useCallback(async () => {
        const user = auth.currentUser;
        if (!user) throw new Error('Sessione non disponibile.');
        await reload(user);
        if (!user.emailVerified) {
            setEmailVerificationRequired(true);
            setSaveError('Email non ancora verificata. Apri il link ricevuto e riprova.');
            return;
        }
        // Firebase's ID token may still contain email_verified=false after reload().
        // Refresh its claims before resuming any owner-scoped cloud operation.
        await user.getIdToken(true);
        await safeHardReload();
    }, [setEmailVerificationRequired, setSaveError]);

    return { loginWithEmail, registerWithEmail, resendEmailVerification, refreshEmailVerification };
}
