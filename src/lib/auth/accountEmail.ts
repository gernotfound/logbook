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

const CREDENTIAL_PREPARATION_DEADLINE_MS = 12_000;

function expiredCredentialPreparation(): Error & { code: string } {
    return Object.assign(new Error('Preparazione del collegamento scaduta: nessuna credenziale inviata. Riprova.'), {
        code: 'auth/link-preparation-timeout',
    });
}

/**
 * SDK token acquisition cannot be aborted externally. Resolve the UI deadline,
 * then reject any late continuation before it can transmit credentials.
 */
async function prepareCredentialLink<T>(
    stillCurrent: () => boolean,
    prepare: (assertActive: () => void) => Promise<T>,
): Promise<T> {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const assertActive = () => {
        if (expired) throw expiredCredentialPreparation();
        if (!stillCurrent()) throw new Error('Sessione cambiata. Ripeti l’operazione.');
    };
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            expired = true;
            reject(expiredCredentialPreparation());
        }, CREDENTIAL_PREPARATION_DEADLINE_MS);
    });
    try {
        return await Promise.race([prepare(assertActive), deadline]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
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
    // This direct REST call does not inherit Firebase SDK App Check headers.
    // Bound all token providers, not only fetch: a stalled provider must not
    // leave the UI busy forever or submit credentials after its timeout.
    const { appCheckToken, idToken } = await prepareCredentialLink(stillCurrent, async assertActive => {
        await ensureAppCheck();
        assertActive();
        const appCheckToken = await getAppCheckToken();
        assertActive();
        if (!appCheckToken) throw new Error('Verifica App Check non disponibile. Collegamento non avviato.');
        const idToken = await user.getIdToken();
        assertActive();
        return { appCheckToken, idToken };
    });
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
