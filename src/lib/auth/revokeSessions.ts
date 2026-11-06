import { trustedBackendUrl } from '../backendApi';
import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from '../firebase';
import { getLimitedUseAppCheckToken } from '../appCheck';
import { assertDeletionDeadlineActive, withDeletionDeadline } from '../deletionDeadline';
import { captureSession, isCurrentSession } from '../sync/session';

const TIMEOUT_MS = 10_000;

/**
 * The response is an acknowledgement, not a guarantee that an offline device
 * has erased its own local archive.
 */
export async function revokeSessionsOnServer(user: User): Promise<void> {
    const session = captureSession();
    const assertCurrent = () => {
        if (!isCurrentSession(session) || auth.currentUser?.uid !== user.uid) {
            throw new Error('Sessione cambiata.');
        }
    };
    assertCurrent();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Connettiti a Internet per disconnettere gli altri dispositivi.');
    }
    await withDeletionDeadline(async signal => {
        await ensureAppCheck();
        assertDeletionDeadlineActive(signal);
        assertCurrent();
        const token = await user.getIdToken(true);
        assertDeletionDeadlineActive(signal);
        assertCurrent();
        const appCheckToken = await getLimitedUseAppCheckToken();
        assertDeletionDeadlineActive(signal);
        assertCurrent();
        const response = await fetch(trustedBackendUrl('/api/account-sessions'), {
            method: 'POST',
            headers: {
                authorization: 'Bearer ' + token,
                'x-firebase-appcheck': appCheckToken,
            },
            cache: 'no-store',
            signal,
        });
        assertDeletionDeadlineActive(signal);
        assertCurrent();
        if (!response.ok) throw new Error('Revoca non confermata dal server.');
        let result: unknown;
        try {
            result = await response.json();
        } catch {
            throw new Error('Revoca non confermata dal server.');
        }
        assertDeletionDeadlineActive(signal);
        assertCurrent();
        if (result === null || typeof result !== 'object' || !('status' in result) || result.status !== 'revoked') {
            throw new Error('Revoca non confermata dal server.');
        }
    }, TIMEOUT_MS, () => new Error('La risposta del server è scaduta: la revoca potrebbe essere già avvenuta.'));
}
