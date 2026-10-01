import { auth, getDb, ensureAppCheck, waitForPendingWrites } from '../firebase';
import { del } from 'idb-keyval';
import { useAppStore } from '../../store/useAppStore';
import { withTimeout } from './db_core';
import { readBrowserValueStrict } from '../sync/browserStorage';
import { storageOwner, captureSession, isCurrentSession } from '../sync/session';
import {
    clearAccountDeletion,
    clearAccountDeletionRecoveryCredential,
    findPendingAccountDeletion,
    listRegisteredAccountDeletionRecoveryCredentials,
    markAccountDeletion,
    markAccountDeletionRecoveryCredentialRegistered,
    persistAccountDeletionRecoveryCredential,
    readAccountDeletionMarker,
    readAccountDeletionRecoveryCredential,
    type AccountDeletionMarker,
    type AccountDeletionRecoveryCredential,
} from '../sync/accountGate';
import { waitForJournalIdle } from '../sync/replicateJournal';
import { accountDeletionApiUrl } from '../deploymentConfig';

export type AccountDeletionOutcome =
    | { status: 'complete' }
    | { status: 'pending'; message: string };

type LocalPurgeOptions = {
    preserveDeletionRecovery?: boolean;
};

type DeletionContext = {
    purgeAllLocalUserData: (owner: string, options?: LocalPurgeOptions) => Promise<void>;
    resetCache: () => void;
};

type DeletionIdentity = Pick<AccountDeletionMarker, 'owner' | 'uid'>;

type ServerDeletionStatus = {
    uid: string;
    status: 'requested' | 'deleting' | 'verifying' | 'complete' | 'failed';
    attempts?: number;
    retryable?: boolean;
    error?: string;
};

export async function purgeAllLocalUserData(
    owner = storageOwner(),
    options: LocalPurgeOptions = {},
) {
    const failures: unknown[] = [];
    const results = await Promise.allSettled([
        del('logbook:v2:' + owner), del('logbook_cached_user_data'),
        del('pending_sync_token'), del('pending_sync_payload'), del('sync_failed')
    ]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    const keys = new Set([
        'logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start', 'logbook_timer_accumulated',
        'draft_measurement', 'draft_exercise', 'draft_routine', 'logbook_awaiting_redirect',
        'logbook_telemetry_queue', 'logbook_storage_marker', 'logbook_storage_anomaly_reported', 'guest_migration_policy'
    ]);
    try {
        const ownerUid = owner.startsWith('user:') ? owner.slice('user:'.length) : null;
        if (ownerUid && localStorage.getItem('logbook_guest_migration_sync_recovery') === ownerUid) {
            keys.add('logbook_guest_migration_sync_recovery');
        }
        const prefix = 'logbook:v2:' + owner + ':';
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key?.startsWith(prefix)) continue;
            if (key.endsWith(':account-deletion')) continue;
            if (options.preserveDeletionRecovery && key.endsWith(':account-deletion-recovery')) continue;
            keys.add(key);
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

export async function ensureAccountDeletionRecoveryCredential(): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    const owner = 'user:' + user.uid;

    let credential = readAccountDeletionRecoveryCredential(owner);
    if (!credential) {
        credential = persistAccountDeletionRecoveryCredential(owner, createReceiptToken());
    }
    if (credential.registeredAt) return;

    const appToken = await appCheckToken();
    const idToken = await user.getIdToken(true);
    const response = await fetch(accountDeletionApiUrl(), {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + idToken,
            'x-firebase-appcheck': appToken,
        },
        body: JSON.stringify({ recoveryCredential: credential.token }),
        cache: 'no-store',
    });
    const body = await readJson(response);
    if (!response.ok) {
        throw new Error(typeof body.error === 'string'
            ? body.error
            : 'Impossibile registrare la recovery della cancellazione account.');
    }
    markAccountDeletionRecoveryCredentialRegistered(owner);
}

async function requestServerDeletion(marker: AccountDeletionMarker, idToken: string, appToken: string): Promise<void> {
    const response = await fetch(accountDeletionApiUrl(), {
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
        throw new Error(message);
    }
    markAccountDeletion(marker.owner, { receiptToken: marker.receiptToken, serverAcceptedAt: Date.now() });
}

export async function fetchAccountDeletionStatus(marker: AccountDeletionMarker): Promise<ServerDeletionStatus> {
    if (!marker.receiptToken) throw new Error('Cancellazione in sospeso senza ricevuta server. Riprendi l’operazione dalle impostazioni.');
    const response = await fetch(accountDeletionApiUrl(), {
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

async function fetchAccountDeletionStatusWithRecoveryCredential(
    credential: AccountDeletionRecoveryCredential,
): Promise<ServerDeletionStatus | null> {
    const response = await fetch(accountDeletionApiUrl(), {
        method: 'GET',
        headers: {
            'x-firebase-appcheck': await appCheckToken(),
            'x-account-deletion-uid': credential.uid,
            'x-account-deletion-recovery': credential.token,
        },
        cache: 'no-store',
    });
    if (response.status === 404) return null;
    const body = await readJson(response);
    if (!response.ok) {
        throw new Error(typeof body.error === 'string'
            ? body.error
            : 'Impossibile verificare la cancellazione account. Copia locale conservata.');
    }
    return body as unknown as ServerDeletionStatus;
}

function anotherLocalIdentityIsActive(marker: DeletionIdentity): boolean {
    if (readBrowserValueStrict('logbook_is_guest') === 'true') return true;
    const currentUid = auth.currentUser?.uid;
    return Boolean(currentUid && currentUid !== marker.uid);
}

async function finalizeCompletedDeletion(marker: DeletionIdentity, context: DeletionContext): Promise<AccountDeletionOutcome> {
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
        await context.purgeAllLocalUserData(marker.owner, { preserveDeletionRecovery: true });
        context.resetCache();
        clearAccountDeletion(marker.owner);
        clearAccountDeletionRecoveryCredential(marker.owner);
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

export async function resumeRegisteredAccountDeletion(
    context: DeletionContext,
): Promise<AccountDeletionOutcome | null> {
    if (readBrowserValueStrict('logbook_is_guest') === 'true') return null;
    const activeUid = auth.currentUser?.uid;
    const credentials = listRegisteredAccountDeletionRecoveryCredentials()
        .filter(credential => !activeUid || credential.uid === activeUid);
    for (const credential of credentials) {
        const status = await fetchAccountDeletionStatusWithRecoveryCredential(credential);
        if (!status) continue;
        if (status.status === 'complete') return finalizeCompletedDeletion(credential, context);
        if (status.status === 'failed') {
            throw new Error(status.error
                ?? 'Cancellazione non completata: alcuni dati cloud potrebbero essere già eliminati. Copia locale conservata.');
        }
        return {
            status: 'pending',
            message: 'La cancellazione cloud dell’account è ancora in corso. La copia locale resta conservata finché il server non conferma il completamento.',
        };
    }
    return null;
}
