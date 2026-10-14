import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from '../firebase';
import { getLimitedUseAppCheckToken } from '../appCheck';
import { assertDeletionDeadlineActive, withDeletionDeadline } from '../deletionDeadline';

const API = (import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;

/**
 * The response is an acknowledgement, not a guarantee that an offline device
 * has erased its own local archive.
 */
export async function revokeSessionsOnServer(user: User): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Connettiti a Internet per disconnettere gli altri dispositivi.');
    }
    await withDeletionDeadline(async signal => {
        await ensureAppCheck();
        assertDeletionDeadlineActive(signal);
        const token = await user.getIdToken(true);
        assertDeletionDeadlineActive(signal);
        const appCheckToken = await getLimitedUseAppCheckToken();
        assertDeletionDeadlineActive(signal);
        if (auth.currentUser?.uid !== user.uid) throw new Error('Sessione cambiata.');
        const response = await fetch(API + '/api/account-sessions', {
            method: 'POST',
            headers: {
                authorization: 'Bearer ' + token,
                'x-firebase-appcheck': appCheckToken,
            },
            cache: 'no-store',
            signal,
        });
        assertDeletionDeadlineActive(signal);
        if (!response.ok) throw new Error('Revoca non confermata dal server.');
    }, TIMEOUT_MS, () => new Error('La risposta del server è scaduta: la revoca potrebbe essere già avvenuta.'));
}
