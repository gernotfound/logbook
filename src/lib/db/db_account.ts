import { auth, getDb, ensureAppCheck, waitForPendingWrites } from '../firebase';
import { del } from 'idb-keyval';
import { withTimeout } from './db_core';
import { readBrowserValueStrict } from '../sync/browserStorage';
import { storageOwner, captureSession, isCurrentSession } from '../sync/session';
import {
    clearAccountDeletion,
    findPendingAccountDeletion,
    markAccountDeletion,
    readAccountDeletionMarker,
    type AccountDeletionMarker,
} from '../sync/accountGate';
import { waitForJournalIdle } from '../sync/replicateJournal';
import { removeDeletionRecoveryCredential } from '../deletionDeviceRecovery';

export type AccountDeletionOutcome =
    | { status: 'complete' }
    | { status: 'pending'; message: string };

export type AccountDeletionCompletionContext = {
    purgeAllLocalUserData: (owner: string) => Promise<void>;
    resetCache: () => void;
    resetStore: () => void;
};

export type AccountDeletionContext = AccountDeletionCompletionContext & {
    cancelPendingSyncs: () => void;
};

type ServerDeletionStatus = {
    uid: string;
    status: 'requested' | 'deleting' | 'verifying' | 'complete' | 'failed';
    attempts?: number;
    retryable?: boolean;
    error?: string;
};

const LOCAL_PURGE_MAX_PASSES = 6;

function collectLocalPurgeKeys(owner: string): Set<string> {
    const keys = new Set([
        'logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start', 'logbook_timer_accumulated',
        'draft_measurement', 'draft_exercise', 'draft_routine', 'logbook_awaiting_redirect',
        'logbook_telemetry_queue', 'logbook_storage_marker', 'logbook_storage_anomaly_reported', 'guest_migration_policy',
        'guest_migration_intent_v1'
    ]);
    const ownerUid = owner.startsWith('user:') ? owner.slice('user:'.length) : null;
    if (ownerUid && localStorage.getItem('logbook_guest_migration_sync_recovery') === ownerUid) {
        keys.add('logbook_guest_migration_sync_recovery');
    }
    if (owner === 'guest') keys.add('logbook_is_guest');

    const prefix = 'logbook:v2:' + owner + ':';
    const length = localStorage.length;
    for (let index = 0; index < length; index++) {
        const storageKey = localStorage.key(index);
        if (storageKey?.startsWith(prefix) && !storageKey.endsWith(':account-deletion')) {
            keys.add(storageKey);
        }
    }
    return keys;
}

function remainingLocalPurgeKeys(owner: string): Set<string> {
    const candidates = collectLocalPurgeKeys(owner);
    const remaining = new Set<string>();
    for (const storageKey of candidates) {
        if (localStorage.getItem(storageKey) !== null) remaining.add(storageKey);
    }
    return remaining;
}

export async function purgeAllLocalUserData(owner = storageOwner()) {
    const failures: unknown[] = [];
    const results = await Promise.allSettled([
        del('logbook:v2:' + owner), del('logbook_cached_user_data'),
        del('pending_sync_token'), del('pending_sync_payload'), del('sync_failed')
    ]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);

    let remaining = new Set<string>();
    try {
        for (let pass = 0; pass < LOCAL_PURGE_MAX_PASSES; pass++) {
            const keys = collectLocalPurgeKeys(owner);
            for (const storageKey of keys) {
                try {
                    localStorage.removeItem(storageKey);
                } catch (error) {
                    failures.push(error);
                }
            }
            remaining = remainingLocalPurgeKeys(owner);
            if (remaining.size === 0) break;
        }

        remaining = remainingLocalPurgeKeys(owner);
        if (remaining.size > 0) {
            failures.push(new Error(`Pulizia locale incompleta: restano ${remaining.size} chiavi del proprietario.`));
        }
    } catch (error) {
        failures.push(error);
    }

    if (failures.length) {
        throw new AggregateError(failures, 'Pulizia locale incompleta. Alcuni dati sono ancora presenti su questo dispositivo.');
    }
}

const ACCOUNT_DELETION_API_ORIGIN = (import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/, '');
const ACCOUNT_DELETION_HTTP_TIMEOUT_MS = 7500;
const ACCOUNT_DELETION_INITIAL_OBSERVE_MS = 7500;

class AccountDeletionRequestTimeoutError extends Error {
    constructor() {
        super('Il server di cancellazione non ha risposto entro il limite interattivo.');
        this.name = 'AccountDeletionRequestTimeoutError';
    }
}

export class AccountDeletionReceiptNotFoundError extends Error {
    constructor() {
        super('La ricevuta locale non è più riconosciuta dal server. La copia locale resta conservata fino alla verifica del dispositivo.');
        this.name = 'AccountDeletionReceiptNotFoundError';
    }
}

async function fetchAccountDeletion(input: RequestInfo | URL, init: RequestInit, timeoutMs = ACCOUNT_DELETION_HTTP_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new AccountDeletionRequestTimeoutError());
        }, Math.max(1, timeoutMs));
    });
    try {
        return await Promise.race([
            fetch(input, { ...init, signal: controller.signal }),
            timeout,
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function accountDeletionUrl(): string {
    if (!ACCOUNT_DELETION_API_ORIGIN) throw new Error('Backend cancellazione account non configurato.');
    return ACCOUNT_DELETION_API_ORIGIN + '/api/account-deletion';
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
    const { getLimitedUseAppCheckToken } = await import('../appCheck');
    const token = await getLimitedUseAppCheckToken();
    if (!token) throw new Error('Verifica App Check non disponibile. Cancellazione non avviata.');
    return token;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
    try { return await response.json() as Record<string, unknown>; }
    catch { return {}; }
}

async function requestServerDeletion(marker: AccountDeletionMarker, idToken: string, appToken: string): Promise<void> {
    const response = await fetchAccountDeletion(accountDeletionUrl(), {
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
    if (response.status === 404) throw new AccountDeletionReceiptNotFoundError();
    if (!response.ok) {
        const message = typeof body.error === 'string' ? body.error : 'Impossibile avviare la cancellazione account.';
        const error = new Error(message) as Error & { definitiveRejection?: boolean };
        error.definitiveRejection = response.status === 400 || response.status === 401 || response.status === 403;
        throw error;
    }
    markAccountDeletion(marker.owner, { receiptToken: marker.receiptToken, serverAcceptedAt: Date.now() });
}

export async function fetchAccountDeletionStatus(marker: AccountDeletionMarker, timeoutMs = ACCOUNT_DELETION_HTTP_TIMEOUT_MS): Promise<ServerDeletionStatus> {
    if (!marker.receiptToken) throw new Error('Cancellazione in sospeso senza ricevuta server. Riprendi l’operazione dalle impostazioni.');
    const response = await fetchAccountDeletion(accountDeletionUrl(), {
        method: 'GET',
        headers: {
            'x-firebase-appcheck': await appCheckToken(),
            'x-account-deletion-uid': marker.uid,
            'x-account-deletion-receipt': marker.receiptToken,
        },
        cache: 'no-store',
    }, timeoutMs);
    const body = await readJson(response);
    if (!response.ok) {
        throw new Error(typeof body.error === 'string'
            ? body.error
            : 'Impossibile verificare lo stato della cancellazione. Copia locale conservata.');
    }
    return body as unknown as ServerDeletionStatus;
}

function anotherLocalIdentityIsActive(marker: AccountDeletionMarker): boolean {
    if (readBrowserValueStrict('logbook_is_guest') === 'true') return true;
    const currentUid = auth.currentUser?.uid;
    return Boolean(currentUid && currentUid !== marker.uid);
}

async function finalizeCompletedDeletion(marker: AccountDeletionMarker, context: AccountDeletionCompletionContext): Promise<AccountDeletionOutcome> {
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
        removeDeletionRecoveryCredential(marker.uid);
        context.resetCache();
        clearAccountDeletion(marker.owner);
        context.resetStore();
        return { status: 'complete' };
    } catch (error) {
        throw new Error('Account cloud eliminato, ma pulizia locale incompleta. Riapri LogBook per completare la pulizia dei dati su questo dispositivo.', { cause: error });
    }
}

function pendingDeletionOutcome(message = 'Richiesta acquisita: la cancellazione cloud è ancora in corso. Puoi chiudere LogBook; i successivi avvii e il recovery giornaliero del server riprenderanno automaticamente il job.'): AccountDeletionOutcome {
    return { status: 'pending', message };
}

async function observeDeletion(marker: AccountDeletionMarker, context: AccountDeletionCompletionContext, maxWaitMs: number): Promise<AccountDeletionOutcome> {
    const deadline = Date.now() + Math.max(0, maxWaitMs);
    do {
        const remaining = Math.max(1, deadline - Date.now());
        const timeoutMs = maxWaitMs > 0
            ? Math.min(ACCOUNT_DELETION_HTTP_TIMEOUT_MS, remaining)
            : ACCOUNT_DELETION_HTTP_TIMEOUT_MS;
        let status: ServerDeletionStatus;
        try {
            status = await fetchAccountDeletionStatus(marker, timeoutMs);
        } catch (error) {
            if (error instanceof AccountDeletionRequestTimeoutError) {
                return pendingDeletionOutcome('La verifica della cancellazione ha superato il limite interattivo. La copia locale e la ricevuta restano conservate; LogBook riprenderà automaticamente la verifica.');
            }
            throw error;
        }
        if (status.status === 'complete') return finalizeCompletedDeletion(marker, context);
        if (status.status === 'failed') {
            throw new Error(status.error ?? 'Cancellazione non completata: alcuni dati cloud potrebbero essere già eliminati. Copia locale conservata; riprendi l’operazione dalle impostazioni.');
        }

        const waitMs = deadline - Date.now();
        if (waitMs <= 0) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, waitMs)));
    } while (Date.now() <= deadline);

    return pendingDeletionOutcome();
}

export function deleteAccount(context: AccountDeletionContext): Promise<AccountDeletionOutcome> {
    if (deleting) return deleting;
    const work = performDeletion(context);
    deleting = work;
    void work.finally(() => { if (deleting === work) deleting = undefined; }).catch(() => {});
    return work;
}

async function performDeletion(context: AccountDeletionContext): Promise<AccountDeletionOutcome> {
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
    context.cancelPendingSyncs();

    try {
        await requestServerDeletion(marker, token.token, appToken);
    } catch (error) {
        if (error instanceof AccountDeletionRequestTimeoutError) {
            return pendingDeletionOutcome('La richiesta di cancellazione è stata inviata, ma il server non ha risposto entro il limite interattivo. La copia locale e la ricevuta sono state conservate; LogBook verificherà lo stato automaticamente e puoi riprendere l’operazione dalle impostazioni.');
        }
        const definitive = Boolean(error && typeof error === 'object' && 'definitiveRejection' in error
            && (error as { definitiveRejection?: boolean }).definitiveRejection);
        if (definitive) clearAccountDeletion(owner);
        throw error instanceof Error
            ? error
            : new Error('Cancellazione non avviata. Verifica la connessione e riprova.', { cause: error });
    }

    return observeDeletion(markAccountDeletion(owner), context, ACCOUNT_DELETION_INITIAL_OBSERVE_MS);
}

export async function resumeAccountDeletion(context: AccountDeletionCompletionContext): Promise<AccountDeletionOutcome | null> {
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
