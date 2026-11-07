import type { User } from 'firebase/auth';
import { auth, ensureAppCheck, firebaseApp, reload, verifyBeforeUpdateEmail } from '../firebase';
import { getAppCheckToken } from '../appCheck';
import { captureSession, isCurrentSession } from '../sync/session';

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
): Promise<'linked' | 'refresh-pending'> {
    const apiKey = firebaseApp.options.apiKey;
    if (!apiKey) throw new Error('Configurazione Firebase incompleta: API key non disponibile.');

    const session = captureSession();
    const stillCurrent = () => auth.currentUser?.uid === user.uid && isCurrentSession(session);
    if (!stillCurrent()) throw new Error('Sessione cambiata. Ripeti l’operazione.');
    // The Firebase SDK attaches App Check to its own requests, not to this
    // direct Identity Toolkit REST call. Authentication enforcement requires it.
    await ensureAppCheck();
    if (!stillCurrent()) throw new Error('Sessione cambiata. Ripeti l’operazione.');
    const appCheckToken = await getAppCheckToken();
    if (!stillCurrent()) throw new Error('Sessione cambiata. Ripeti l’operazione.');
    if (!appCheckToken) throw new Error('Verifica App Check non disponibile. Collegamento non avviato.');
    const idToken = await user.getIdToken();
    if (!stillCurrent()) throw new Error('Sessione cambiata. Ripeti l’operazione.');
    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': appCheckToken },
            signal: AbortSignal.timeout(12_000),
            body: JSON.stringify({
                idToken,
                email: email.trim(),
                password,
                returnSecureToken: true,
            }),
        },
    );

    if (!response.ok) {
        let message = `Identity Toolkit HTTP ${response.status}`;
        try {
            const payload: unknown = await response.json();
            if (payload !== null && typeof payload === 'object' && 'error' in payload) {
                const error = payload.error;
                if (error !== null && typeof error === 'object' && 'message' in error
                    && typeof error.message === 'string' && error.message) {
                    message = error.message;
                }
            }
        } catch {
            // Preserve a stable application error when the provider response is not JSON.
        }
        throw authError(message);
    }

    // HTTP 2xx alone is not proof that the requested identity was linked.
    // The Identity Toolkit signUp response must identify this same Firebase user.
    const linkedAccount: { localId?: unknown } | null = await response.json().catch(() => null);
    if (linkedAccount?.localId !== user.uid) {
        throw authError('Identity Toolkit response missing the matching account identity');
    }

    // The matching response already confirms the remote mutation. A failed
    // local refresh must not invite a second credential-linking request.
    // A confirmed mutation remains confirmed even if its initiating Auth
    // epoch ended while the response was pending. Do not refresh a stale user.
    if (!stillCurrent()) return 'refresh-pending';
    try {
        await reload(user);
        return 'linked';
    } catch {
        return 'refresh-pending';
    }
}
