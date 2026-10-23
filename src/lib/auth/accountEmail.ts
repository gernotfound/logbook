import type { User } from 'firebase/auth';
import { firebaseApp, reload, verifyBeforeUpdateEmail } from '../firebase';

type IdentityToolkitError = {
    error?: {
        message?: string;
    };
};

function authError(message: string): Error & { code: string } {
    const normalized = message.split(' : ')[0];
    const code = normalized === 'EMAIL_EXISTS'
        ? 'auth/email-already-in-use'
        : normalized === 'INVALID_EMAIL'
            ? 'auth/invalid-email'
            : normalized === 'WEAK_PASSWORD'
                ? 'auth/weak-password'
                : normalized === 'TOKEN_EXPIRED' || normalized === 'INVALID_ID_TOKEN'
                    ? 'auth/user-token-expired'
                    : 'auth/account-update-failed';
    return Object.assign(new Error(message), { code });
}

export async function requestVerifiedEmailChange(user: User, newEmail: string): Promise<void> {
    await verifyBeforeUpdateEmail(user, newEmail.trim());
}

export async function linkEmailPasswordWithEnumerationProtection(
    user: User,
    email: string,
    password: string,
): Promise<void> {
    const apiKey = firebaseApp.options.apiKey;
    if (!apiKey) throw new Error('Configurazione Firebase incompleta: API key non disponibile.');

    const idToken = await user.getIdToken();
    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                idToken,
                email: email.trim(),
                password,
                returnSecureToken: true,
            }),
        },
    );

    if (!response.ok) {
        let payload: IdentityToolkitError = {};
        try {
            payload = await response.json() as IdentityToolkitError;
        } catch {
            // Preserve a stable application error when the provider response is not JSON.
        }
        throw authError(payload.error?.message || `Identity Toolkit HTTP ${response.status}`);
    }

    // HTTP 2xx alone is not proof that the requested identity was linked.
    // The Identity Toolkit signUp response must identify this same Firebase user.
    const linkedAccount: { localId?: unknown } | null = await response.json().catch(() => null);
    if (linkedAccount?.localId !== user.uid) {
        throw authError('Identity Toolkit response missing the matching account identity');
    }

    await reload(user);
}
