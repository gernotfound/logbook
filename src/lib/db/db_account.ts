import { auth, getDb, ensureAppCheck, waitForPendingWrites } from '../firebase';
import { del } from 'idb-keyval';
import { useAppStore } from '../../store/useAppStore';
import { withTimeout } from './db_core';
import { storageOwner, captureSession, isCurrentSession } from '../sync/session';
import {
    clearAccountDeletion,
    findPendingAccountDeletion,
    markAccountDeletion,
    readAccountDeletionMarker,
    type AccountDeletionMarker,
} from '../sync/accountGate';
import { waitForJournalIdle } from '../sync/replicateJournal';

export type AccountDeletionOutcome =
    | { status: 'complete' }
    | { status: 'pending'; message: string };

type DeletionContext = {
    purgeAllLocalUserData: (owner: string) => Promise<void>;
    resetCache: () => void;
};

type ServerDeletionStatus = {
    uid: string;
    status: 'requested' | 'deleting' | 'verifying' | 'complete' | 'failed';
    attempts?: number;
    retryable?: boolean;
    error?: string;
};

export async function purgeAllLocalUserData(owner = storageOwner()) {
    const failures: unknown[] = [];
    const results = await Promise.allSettled([
        del('logbook:v2:' + owner), del('logbook_cached_user_data'),
        del('pending_sync_token'), del('pending_sync_payload')
    ]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    const keys = new Set([
        'logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start', 'logbook_timer_accumulated',
        'draft_measurement', 'draft_exercise', 'draft_routine', 'logbook_awaiting_redirect',
        'logbook_telemetry_queue'
    ]);
    try {
        const prefix = 'logbook:v2:' + owner + ':';
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            // Keep the server-deletion receipt until every other local purge succeeds.
            if (key?.startsWith(prefix) && !key.endsWith(':account-deletion')) keys.add(key);
        }
        if (owner === 'guest') keys.add('logbook_is_guest');
    } catch (error) { failures.push(error); }
    for (const key of keys) {
        try { localStorage.removeItem(key); }
        catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Pulizia locale incompleta. Alcuni dati sono ancora presenti su questo dispositivo.');
}

let deleting: Promise<AccountDeletionOutcome> | undefined;

function createReceiptToken(): string {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
        throw new Error('Generatore crittografico non disponibile. Cancellazione non avviata.');
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function appCheckToken(): Promise<string> {
    await ensureAppCheck();
    const { getAppCheckToken } = await import('../appCheck');
    const token = await getAppCheckToken(true);
    if (!token) throw new Error('Verifica App Check non disponibile. Cancellazione non avviata.');
    return token;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
    try { return await response.json() as Record<string, unknown>; }
    catch { return {}; }
}

async function requestServerDeletion(marker: AccountDeletionMarker, idToken: string, appToken: string): Promise<void> {
    const response = await fetch('/api/account-deletion', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${idToken}`,
            'x-firebase-appcheck': appToken,
        },
        body: JSON.stringify({ receiptToken: marker.receiptToken }),
        cache: 'no-store',
    });
    const body = await readJson(response);
    if (!response.ok) {
        const message = typeof body.error === 'string' ? body.error : 'Impossibile avviare la cancellazione account.';
        const error = new Error(message) as Error & { definitiveRejection?: boolean };
        error.definitiveRejection = response.status === 400 || response.status === 401 || response.status === 403;
        throw error;
    }
    markAccountDeletion(marker.owner, { receiptToken: marker.receiptToken, serverAcceptedAt: Date.now() });
}

export async function fetchAccountDeletionStatus(marker: AccountDeletionMarker): Promise<ServerDeletionStatus> {
    if (!marker.receiptToken) throw new Error('Cancellazione in sospeso senza ricevuta server. Riprendi l’operazione dalle impostazioni.');
    const response = await fetch('/api/account-deletion', {
        method: 'GET',
        headers: {
            'x-firebase-appcheck': await appCheckToken(),
            'x-account-deletion-uid': marker.uid,
            'x-account-deletion-receipt': marker.receiptToken,
        },
        cache: 'no-store',
    });
    const body = await readJson(response);
    if (!response.ok) {
        throw new Error(typeof body.error === 'string'
            ? body.error
            : 'Impossibile verificare lo stato della cancellazione. Copia locale conservata.');
    }
    return body as unknown as ServerDeletionStatus;
}

function anotherLocalIdentityIsActive(marker: AccountDeletionMarker): boolean {
    try {
        if (localStorage.getItem('logbook_is_guest') === 'true') return true;
    } catch {
        // If guest state cannot be read, Firebase Auth below still protects authenticated owners.
    }
    const currentUid = auth.currentUser?.uid;
    return Boolean(currentUid && currentUid !== marker.uid);
}

async function finalizeCompletedDeletion(marker: AccountDeletionMarker, context: DeletionContext): Promise<AccountDeletionOutcome> {
    // A stale receipt from account A must never sign out, purge global drafts, or reset
    // the in-memory view of account B (or an explicitly active guest) on a shared device.
    if (anotherLocalIdentityIsActive(marker)) {
        return {
            status: 'pending',
            message: 'La cancellazione cloud dell’account precedente è completa. La pulizia locale di quell’account resta sospesa finché è attiva un’altra sessione su questo dispositivo.',
        };
    }

    if (auth.currentUser?.uid === marker.uid) {
        try {
            await auth.signOut();
        } catch (error) {
            throw new Error('Account cloud eliminato, ma la sessione locale non è stata chiusa. Copia locale conservata; riapri LogBook per completare la pulizia.', { cause: error });
        }
    }

    try {
        await context.purgeAllLocalUserData(marker.owner);
        context.resetCache();
        clearAccountDeletion(marker.owner);
        useAppStore.getState().resetStore();
        return { status: 'complete' };
    } catch (error) {
        throw new Error('Account cloud eliminato, ma pulizia locale incompleta. Riapri LogBook per completare la pulizia dei dati su questo dispositivo.', { cause: error });
    }
}

async function observeDeletion(marker: AccountDeletionMarker, context: DeletionContext, maxWaitMs: number): Promise<AccountDeletionOutcome> {
    const deadline = Date.now() + maxWaitMs;
    do {
        const status = await fetchAccountDeletionStatus(marker);
        if (status.status === 'complete') return finalizeCompletedDeletion(marker, context);
        if (status.status === 'failed') {
            throw new Error(status.error ?? 'Cancellazione non completata: alcuni dati cloud potrebbero essere già eliminati. Copia locale conservata; riprendi l’operazione dalle impostazioni.');
        }
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
    } while (Date.now() <= deadline);

    return {
        status: 'pending',
        message: 'Richiesta acquisita: la cancellazione cloud è ancora in corso. Puoi chiudere LogBook; il polling, i successivi avvii e il recovery giornaliero del server riprenderanno automaticamente il job.',
    };
}

export function deleteAccount(context: DeletionContext): Promise<AccountDeletionOutcome> {
    if (deleting) return deleting;
    const work = performDeletion(context);
    deleting = work;
    void work.finally(() => { if (deleting === work) deleting = undefined; }).catch(() => {});
    return work;
}

async function performDeletion(context: DeletionContext): Promise<AccountDeletionOutcome> {
    const user = auth.currentUser;
    if (!user) throw new Error('Nessun utente autenticato.');
    const before = captureSession();
    const owner = 'user:' + user.uid;
    if (before.owner !== owner) throw new Error('Esci dalla modalità ospite prima di eliminare l’account.');

    const token = await withTimeout(user.getIdTokenResult(true), 10000, 'Verifica identità non disponibile.');
    if (!isCurrentSession(before) || auth.currentUser?.uid !== user.uid) throw new Error('Sessione cambiata.');
    const authenticatedAt = new Date(token.authTime).getTime();
    if (!Number.isFinite(authenticatedAt) || authenticatedAt > Date.now() + 60000 || Date.now() - authenticatedAt > 5 * 60 * 1000) {
        throw new Error('Per eliminare l’account devi effettuare di nuovo il login. Nessun dato è stato cancellato.');
    }

    await withTimeout(waitForJournalIdle(owner), 10000, 'Scritture precedenti ancora in corso.');
    if (!isCurrentSession(before)) throw new Error('Sessione cambiata.');
    await withTimeout(waitForPendingWrites(getDb()), 10000, 'Scritture Firebase precedenti ancora in corso.');
    if (!isCurrentSession(before)) throw new Error('Sessione cambiata.');

    const appToken = await appCheckToken();
    if (!isCurrentSession(before)) throw new Error('Sessione cambiata.');

    const existing = readAccountDeletionMarker(owner);
    const marker = markAccountDeletion(owner, { receiptToken: existing?.receiptToken ?? createReceiptToken() });
    useAppStore.getState().cancelPendingSyncs();

    try {
        await requestServerDeletion(marker, token.token, appToken);
    } catch (error) {
        const definitive = Boolean(error && typeof error === 'object' && 'definitiveRejection' in error
            && (error as { definitiveRejection?: boolean }).definitiveRejection);
        if (definitive) clearAccountDeletion(owner);
        throw error instanceof Error
            ? error
            : new Error('Cancellazione non avviata. Verifica la connessione e riprova.', { cause: error });
    }

    return observeDeletion(markAccountDeletion(owner), context, 15000);
}

export async function resumeAccountDeletion(context: DeletionContext): Promise<AccountDeletionOutcome | null> {
    const marker = findPendingAccountDeletion();
    if (!marker) return null;
    if (!marker.receiptToken) {
        return {
            status: 'pending',
            message: 'Cancellazione account in sospeso. Accedi allo stesso account e riprendi l’operazione dalle impostazioni; la copia locale resta conservata.',
        };
    }
    return observeDeletion(marker, context, 0);
}
