import { isLocalPurgeIncomplete, isLocalPurgePending } from '../sync/localPurgeFence';
import { purgeOwnerLocalData } from './ownerLocalPurge';
import {
    ACCOUNT_DELETION_HTTP_TIMEOUT_MS, AccountDeletionRequestTimeoutError,
    appCheckToken, requestServerDeletion, fetchAccountDeletionStatus,
    type ServerDeletionStatus,
} from './accountDeletionTransport';
export { AccountDeletionReceiptNotFoundError } from './accountDeletionTransport';
import { auth, getDb, waitForPendingWrites, signOut } from '../firebase';





import { withTimeout } from './db_core';
import { assertDeletionDeadlineActive, withDeletionDeadline } from '../deletionDeadline';
import { readBrowserValueStrict } from '../sync/browserStorage';
import { storageOwner, captureSession, isCurrentSession, isActiveGuestSession } from '../sync/session';
import {
    clearAccountDeletion,
    findPendingAccountDeletion,
    isAccountDeletionPending,
    listPendingAccountDeletions,
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

class HealthConsentTransitionPendingError extends Error {
    constructor() {
        super('La revoca o la nuova accettazione dei dati salute non è ancora riconciliata. Per non perdere la richiesta, completa la verifica prima di uscire.');
        this.name = 'HealthConsentTransitionPendingError';
    }
}

function assertOrdinaryPurgeAllowed(owner: string): void {
    // A sign-out or an ordinary purge must not erase the only durable copy
    // of a withdrawal not yet confirmed by the trusted server.
    const consent = readBrowserValueStrict(`logbook:v2:${owner}:health-consent-withdrawal`);
    if (consent !== null && consent !== 'withdrawn') {
        throw new HealthConsentTransitionPendingError();
    }
    if (owner.startsWith('user:')) {
        if (isAccountDeletionPending(owner)) {
            throw new Error('Cancellazione account in sospeso: i dati locali devono restare disponibili per il recupero.');
        }
    } else if (owner === 'guest' && readBrowserValueStrict('logbook_is_guest') !== 'true') {
        // An auth-less recovery must not purge shared drafts via a guest fallback.
        if (findPendingAccountDeletion()) {
            throw new Error('Recupero cancellazione account in sospeso: impossibile azzerare i dati locali.');
        }
    }
}

/** A new server consent epoch never authorizes discarding an older offline journal. */
async function assertNoOutdatedConsentJournal(owner: string): Promise<void> {
    if (!owner.startsWith('user:')) return;
    const generation = readBrowserValueStrict(`logbook:v2:${owner}:health-consent-generation`);
    const withdrawal = readBrowserValueStrict(`logbook:v2:${owner}:health-consent-withdrawal`);
    if (generation === null && withdrawal !== 'withdrawn') return;
    if (generation !== null && (!/^[1-9]\\d*$/.test(generation) || !Number.isSafeInteger(Number(generation)))) {
        throw new HealthConsentTransitionPendingError();
    }
    const { readLocal } = await import('../sync/localRepository');
    const envelope = await readLocal(owner);
    if (envelope?.pending.length && (withdrawal === 'withdrawn'
        || (generation !== null && (envelope.consentRevision ?? 0) !== Number(generation)))) {
        throw new HealthConsentTransitionPendingError();
    }
}

export async function purgeAllLocalUserData(owner = storageOwner()) {
    // Recovery of a previously started purge must never require an archive
    // that may already be partially deleted.
    if (isLocalPurgePending(owner)) return purgeOwnerLocalData(owner, true);
    return purgeOwnerLocalData(owner, false, {
        preflight: async () => {
            assertOrdinaryPurgeAllowed(owner);
            await assertNoOutdatedConsentJournal(owner);
            if (owner.startsWith('user:')) {
                const { readLocal } = await import('../sync/localRepository');
                if ((await readLocal(owner))?.pending.length) throw new UnsyncedLogoutError();
            }
            assertOrdinaryPurgeAllowed(owner);
        },
        afterFence: async () => {},
    });
}

/** Only a verified server-complete account deletion may use this boundary. */
export async function purgeCompletedAccountLocalData(owner: string) {
    if (!owner.startsWith('user:')) throw new Error('La finalizzazione richiede un owner account.');
    return purgeOwnerLocalData(owner);
}

/** A clean-looking UI cannot prove that its durable offline journal is empty. */
class UnsyncedLogoutError extends Error {
    constructor() {
        super('Logout sospeso: alcune modifiche sono ancora salvate solo sul dispositivo. Attendi la sincronizzazione o scegli esplicitamente di perderle.');
        this.name = 'UnsyncedLogoutError';
    }
}

/**
 * Data-only erasure: caller MUST have an authenticated, server-confirmed
 * `health_data_erasures/{uid}.status=complete` response for this exact owner.
 * Unlike ordinary logout, old pending changes are deliberately discarded:
 * the user requested erasure and the cloud revision has advanced to fence them.
 * This boundary does NOT delete Firebase Auth.
 */
export async function purgeCompletedHealthDataLocal(owner: string): Promise<void> {
    if (!owner.startsWith('user:')) throw new Error('Cancellazione dati: proprietario account richiesto.');
    const session = captureSession();
    if (session.owner !== owner || !isCurrentSession(session)) {
        throw new Error('Sessione non attribuibile al proprietario della cancellazione.');
    }
    // Verify inside the infrastructure boundary, not just in the UI caller.
    // A stale complete receipt must not purge data added in a later consent cycle.
    const { assertCurrentHealthDataErasureCompleted } = await import('../healthDataErasure');
    await assertCurrentHealthDataErasureCompleted(owner.slice('user:'.length));
    if (!isCurrentSession(session)) {
        throw new Error('Il consenso o la sessione sono cambiati prima della pulizia.');
    }
    // If interrupted, preserve the existing purge fence and resume its cleanup.
    // Re-check the same session INSIDE the owner's exclusive lock, just before
    // fencing every writer and erasing the durable local bytes.
    return purgeOwnerLocalData(owner, isLocalPurgeIncomplete(owner), {
        preflight: async () => {
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata prima della pulizia locale.');
            if (isAccountDeletionPending(owner)) throw new Error('Cancellazione account concorrente in corso.');
        },
        afterFence: async () => {},
    });
}

/** Sign-out and purge share one owner lock, with a persistent writer fence. */
export async function logoutAndPurgeAccount(
    owner: string,
    signOutAccount: () => Promise<void>,
    discardUnsynced = false,
    verifyCurrentDrafts?: () => Promise<void>,
): Promise<void> {
    if (!owner.startsWith('user:')) throw new Error('Logout autenticato: proprietario non valido');
    return purgeOwnerLocalData(owner, false, {
        preflight: async () => {
            assertOrdinaryPurgeAllowed(owner);
            if (!discardUnsynced) await verifyCurrentDrafts?.();
            await assertNoOutdatedConsentJournal(owner);
            if (!discardUnsynced) {
                const { readLocal } = await import('../sync/localRepository');
                const local = await readLocal(owner);
                if (local?.pending.length) throw new UnsyncedLogoutError();
            }
            assertOrdinaryPurgeAllowed(owner);
        },
        afterFence: signOutAccount,
    });
}

export async function resumeInterruptedLocalPurge(owner: string): Promise<void> {
    if (!isLocalPurgeIncomplete(owner)) return;
    await purgeOwnerLocalData(owner, true);
}

const ACCOUNT_DELETION_INITIAL_OBSERVE_MS = 7500;

class AccountDeletionLocalFinalizationError extends Error {
    readonly code = 'account-deletion-local-finalization-failed';

    constructor(message: string, cause?: unknown) {
        super(message, cause instanceof Error ? { cause } : undefined);
        this.name = 'AccountDeletionLocalFinalizationError';
    }
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

function anotherLocalIdentityIsActive(uid: string): boolean {
    if (readBrowserValueStrict('logbook_is_guest') === 'true') return true;
    const currentUid = auth.currentUser?.uid;
    return Boolean(currentUid && currentUid !== uid);
}

export async function finalizeCompletedDeletionForUid(uid: string, context: AccountDeletionCompletionContext): Promise<AccountDeletionOutcome> {
    if (anotherLocalIdentityIsActive(uid)) {
        return {
            status: 'pending',
            message: 'La cancellazione cloud dell’account precedente è completa. La pulizia locale di quell’account resta sospesa finché è attiva un’altra sessione su questo dispositivo.',
        };
    }

    if (auth.currentUser?.uid === uid) {
        try {
            await auth.signOut();
        } catch (error) {
            throw new AccountDeletionLocalFinalizationError('Account cloud eliminato, ma la sessione locale non è stata chiusa. Copia locale conservata; riapri LogBook per completare la pulizia.', error);
        }
    }

    if (anotherLocalIdentityIsActive(uid)) {
        return pendingDeletionOutcome('Un altro account è diventato attivo durante la riconciliazione. La copia locale rimane conservata.');
    }

    try {
        await context.purgeAllLocalUserData('user:' + uid);
        removeDeletionRecoveryCredential(uid);
        clearAccountDeletion('user:' + uid);
        if (!anotherLocalIdentityIsActive(uid)) {
            context.resetCache();
            context.resetStore();
        }
        return { status: 'complete' };
    } catch (error) {
        throw new AccountDeletionLocalFinalizationError('Account cloud eliminato, ma pulizia locale incompleta. Riapri LogBook per completare la pulizia dei dati su questo dispositivo.', error);
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
        if (status.status === 'complete') return finalizeCompletedDeletionForUid(marker.uid, context);
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
    // A new account can be authenticated while its guest archive remains the
    // active local owner, before the first explicit health consent.
    const preservingGuest = before.owner === 'guest' && isActiveGuestSession();
    if (before.owner !== owner && !preservingGuest) {
        throw new Error('Sessione non valida per la cancellazione account.');
    }
    const isCurrentDeletion = () => isCurrentSession(before) && auth.currentUser?.uid === user.uid;

    const token = await withTimeout(user.getIdTokenResult(true), 10000, 'Verifica identità non disponibile.');
    if (!isCurrentDeletion()) throw new Error('Sessione cambiata.');
    const authenticatedAt = new Date(token.authTime).getTime();
    if (!Number.isFinite(authenticatedAt) || authenticatedAt > Date.now() + 60000 || Date.now() - authenticatedAt > 5 * 60 * 1000) {
        throw new Error('Per eliminare l’account devi effettuare di nuovo il login. Nessun dato è stato cancellato.');
    }

    await withTimeout(waitForJournalIdle(owner), 10000, 'Scritture precedenti ancora in corso.');
    if (!isCurrentDeletion()) throw new Error('Sessione cambiata.');
    await withTimeout(waitForPendingWrites(getDb()), 10000, 'Scritture Firebase precedenti ancora in corso.');
    if (!isCurrentDeletion()) throw new Error('Sessione cambiata.');

    const appToken = await withDeletionDeadline(async signal => {
        const token = await appCheckToken();
        assertDeletionDeadlineActive(signal);
        return token;
    }, ACCOUNT_DELETION_HTTP_TIMEOUT_MS, () => new AccountDeletionRequestTimeoutError());
    if (!isCurrentDeletion()) throw new Error('Sessione cambiata.');

    const existing = readAccountDeletionMarker(owner);
    const marker = markAccountDeletion(owner, { receiptToken: existing?.receiptToken ?? createReceiptToken() });
    if (!preservingGuest) context.cancelPendingSyncs();

    try {
        await requestServerDeletion(marker, token.token, appToken);
        markAccountDeletion(marker.owner, { receiptToken: marker.receiptToken, serverAcceptedAt: Date.now() });
    } catch (error) {
        if (error instanceof AccountDeletionRequestTimeoutError) {
            return pendingDeletionOutcome('La richiesta di cancellazione è stata inviata, ma il server non ha risposto entro il limite interattivo. La copia locale e la ricevuta sono state conservate; LogBook verificherà lo stato automaticamente e puoi riprendere l’operazione dalle impostazioni.');
        }
        const definitive = Boolean(error && typeof error === 'object' && 'definitiveRejection' in error
            && (error as { definitiveRejection?: boolean }).definitiveRejection);
        // A previous POST may have been accepted despite a lost acknowledgement.
        if (definitive && !existing) clearAccountDeletion(owner);
        throw error instanceof Error
            ? error
            : new Error('Cancellazione non avviata. Verifica la connessione e riprova.', { cause: error });
    }

    const outcome = await observeDeletion(markAccountDeletion(owner), context, ACCOUNT_DELETION_INITIAL_OBSERVE_MS);
    if (preservingGuest && auth.currentUser?.uid === user.uid) {
        // Only AFTER the backend accepted the durable job may Auth be released.
        // Keep the guest owner and the account receipt; owner-local purge is
        // deferred until there is no other active local identity.
        try {
            await signOut(auth);
        } catch {
            return pendingDeletionOutcome('Cancellazione acquisita dal server, ma la sessione Firebase non è stata chiusa. L’archivio ospite e la ricevuta account sono conservati; riprova dopo aver riaperto TheLogBook.');
        }
    }
    return outcome;
}

export async function resumeAccountDeletion(context: AccountDeletionCompletionContext): Promise<AccountDeletionOutcome | null> {
    const { markers, corrupt } = listPendingAccountDeletions();
    let firstError: unknown = corrupt[0];
    let pending: AccountDeletionOutcome | null = null;
    let completed = false;

    // Every owner advances independently; errors cannot starve other receipts.
    for (const marker of markers) {
        if (!marker.receiptToken) {
            pending ??= pendingDeletionOutcome('Cancellazione account in sospeso senza ricevuta. Accedi allo stesso account per riprendere l’operazione.');
            continue;
        }
        try {
            const outcome = await observeDeletion(marker, context, 0);
            if (outcome.status === 'pending') pending ??= outcome;
            else completed = true;
        } catch (error) {
            firstError ??= error;
        }
    }
    if (firstError) throw firstError;
    return pending ?? (completed ? { status: 'complete' } : null);
}