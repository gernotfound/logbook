import type { User } from 'firebase/auth';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserJson } from '../sync/browserStorage';
import { withGuestLifecycleLock } from '../sync/guestLifecycleLock';
import type { GuestMigrationPolicy } from '../../contexts/AuthContextDef';

// The shared record is a reservation, not proof that this tab initiated Auth.
// Session storage survives a Google redirect / verification reload but does not
// authorize a different tab that only observes Firebase's shared auth state.
const KEY = 'guest_migration_intent_v1';
const TAB_RECEIPT_KEY = 'logbook:guest-auth-attempt';
const INTENT_LOCK = 'thelogbook:guest-auth-intent';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AUTH_PROOF_WAIT_MS = 15_000;
const authResultWaiters = new Map<string, Set<(error?: Error) => void>>();
// Never persist an Auth result as a shared tab-readable authorization.
// After a reload (other than an own verified redirect), recovery must require
// an explicit new decision, rather than treating onAuthStateChanged as proof.
const provenAuthResults = new Map<string, string>();
const realmClaim = createId();

export type GuestMigrationMethod = 'email' | 'google' | 'recovery';

export interface GuestMigrationIntent {
    version: 1;
    id: string;
    policy: GuestMigrationPolicy;
    method: GuestMigrationMethod;
    startedAt: number;
    expectedEmail?: string;
    expectedUid?: string;
    boundUid?: string;
    claimedBy?: string;
}

function normalizeEmail(email: string | null | undefined): string | undefined {
    const normalized = email?.trim().toLowerCase();
    return normalized || undefined;
}

function createId(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    if (cryptoApi?.getRandomValues) {
        const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    throw new Error('Impossibile creare un identificatore sicuro per il tentativo di accesso.');
}

function parse(raw: string | null): GuestMigrationIntent {
    if (!raw) throw new Error('Tentativo di trasferimento guest assente.');
    let value: Partial<GuestMigrationIntent>;
    try {
        value = JSON.parse(raw) as Partial<GuestMigrationIntent>;
    } catch (error) {
        throw new Error('Tentativo di trasferimento guest non valido.', { cause: error });
    }
    if (
        value.version !== 1
        || typeof value.id !== 'string' || !value.id
        || (value.policy !== 'merge' && value.policy !== 'skip')
        || (value.method !== 'email' && value.method !== 'google' && value.method !== 'recovery')
        || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt) || value.startedAt <= 0
        || (value.claimedBy !== undefined && (typeof value.claimedBy !== 'string' || !value.claimedBy))
    ) {
        throw new Error('Tentativo di trasferimento guest non valido.');
    }
    const intent: GuestMigrationIntent = {
        version: 1, id: value.id, policy: value.policy,
        method: value.method, startedAt: value.startedAt,
    };
    if (typeof value.expectedEmail === 'string' && value.expectedEmail) intent.expectedEmail = value.expectedEmail;
    if (typeof value.expectedUid === 'string' && value.expectedUid) intent.expectedUid = value.expectedUid;
    if (typeof value.boundUid === 'string' && value.boundUid) intent.boundUid = value.boundUid;
    if (typeof value.claimedBy === 'string' && value.claimedBy) intent.claimedBy = value.claimedBy;
    return intent;
}

function readGuestMigrationIntentStrict(): GuestMigrationIntent {
    const intent = parse(readBrowserValueStrict(KEY));
    if (Date.now() - intent.startedAt > MAX_AGE_MS) {
        throw new Error('Il tentativo di trasferimento guest è scaduto. Avvia nuovamente l’accesso.');
    }
    return intent;
}

function withIntentLock<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
        throw new Error('Coordinamento Auth tra schede non disponibile.');
    }
    return navigator.locks.request(INTENT_LOCK, { mode: 'exclusive' }, operation);
}

function settleAuthResultWaiters(intentId: string, error?: Error): void {
    const listeners = authResultWaiters.get(intentId);
    if (!listeners) return;
    for (const notify of Array.from(listeners)) notify(error);
}

function awaitOwnAuthResult(intentId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let listeners = authResultWaiters.get(intentId);
        if (!listeners) {
            listeners = new Set();
            authResultWaiters.set(intentId, listeners);
        }
        let settled = false;
        const timer = setTimeout(() => settle(new Error('Autenticazione non confermata da questo tentativo. Riprova.')), AUTH_PROOF_WAIT_MS);
        const settle = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            listeners!.delete(settle);
            if (listeners!.size === 0) authResultWaiters.delete(intentId);
            if (error) reject(error);
            else resolve();
        };
        listeners.add(settle);
        // Close the read/subscription gap. The credential may have completed
        // just before this waiter was registered.
        try {
            const latest = readGuestMigrationIntentStrict();
            if (latest.id !== intentId) settle(new Error('Il tentativo Auth è stato sostituito.'));
            else if (provenAuthResults.has(intentId)) settle();
        } catch (error) {
            settle(error instanceof Error ? error : new Error('Tentativo Auth non verificabile.'));
        }
    });
}

function assertUserMatchesIntent(intent: GuestMigrationIntent, user: User): void {
    const uid = user.uid;
    if (intent.expectedUid && intent.expectedUid !== uid) {
        throw new Error('Il tentativo di trasferimento appartiene a un account diverso.');
    }
    const userEmail = normalizeEmail(user.email);
    if (intent.method === 'email' && intent.expectedEmail && intent.expectedEmail !== userEmail) {
        throw new Error('Il tentativo email non corrisponde all’account autenticato.');
    }
    if (intent.method === 'google' && !(user.providerData ?? []).some(provider => provider.providerId === 'google.com')) {
        throw new Error('Il tentativo Google non corrisponde all’account autenticato.');
    }
}

/** Only a successful Firebase UserCredential from this initiating Auth action can
 * authorize a migration. onAuthStateChanged alone may report another tab's login. */
export async function confirmGuestMigrationCredential(intentId: string, user: User): Promise<void> {
    await withIntentLock(async () => {
        const intent = readGuestMigrationIntentStrict();
        if (readTabReceipt() !== intentId || intent.id !== intentId || intent.method === 'recovery') {
            throw new Error('La credenziale non appartiene al tentativo Auth corrente.');
        }
        assertUserMatchesIntent(intent, user);
        const provenUid = provenAuthResults.get(intentId);
        if (provenUid && provenUid !== user.uid) {
            throw new Error('La credenziale del tentativo Auth è cambiata.');
        }
        provenAuthResults.set(intentId, user.uid);
        settleAuthResultWaiters(intentId);
    });
}

/** Captured at redirect bootstrap before Auth can clear its navigation marker. */
export function readGuestMigrationTabReceipt(): string | null {
    return readTabReceipt();
}

export function rejectGuestMigrationAuthWaiters(intentId: string, reason: string): void {
    settleAuthResultWaiters(intentId, new Error(reason));
}

function readTabReceipt(): string | null {
    // sessionStorage errors are fatal at this owner-changing boundary.
    return sessionStorage.getItem(TAB_RECEIPT_KEY);
}

/**
 * Starting Auth first reserves the guest generation under its lifecycle lock.
 * A second popup/email attempt cannot overwrite an active choice. An explicit
 * authenticated recovery can replace the record, but only after the ongoing
 * migration has released the same guest lifecycle lock.
 */
export function beginGuestMigrationIntent(
    policy: GuestMigrationPolicy,
    method: GuestMigrationMethod,
    options: { email?: string; uid?: string; assertCurrent?: () => boolean } = {},
): Promise<GuestMigrationIntent> {
    return withGuestLifecycleLock(() => withIntentLock(async () => {
        if (options.assertCurrent && !options.assertCurrent()) {
            throw new Error('La sessione locale originaria non è più attiva.');
        }
        const raw = readBrowserValueStrict(KEY);
        if (raw !== null) {
            const active = parse(raw);
            const notExpired = Date.now() - active.startedAt <= MAX_AGE_MS;
            if (notExpired && !(method === 'recovery' && options.uid)) {
                throw new Error('Un altro tentativo di trasferimento è ancora in corso. Completalo o riprova.');
            }
        }
        const intent: GuestMigrationIntent = {
            version: 1, id: createId(), policy, method, startedAt: Date.now(),
        };
        const email = normalizeEmail(options.email);
        if (email) intent.expectedEmail = email;
        if (options.uid) intent.expectedUid = options.uid;
        const oldReceipt = readTabReceipt();
        const previousId = raw ? parse(raw).id : null;
        sessionStorage.setItem(TAB_RECEIPT_KEY, intent.id);
        try {
            writeBrowserJson(KEY, intent);
        } catch (error) {
            if (oldReceipt === null) sessionStorage.removeItem(TAB_RECEIPT_KEY);
            else sessionStorage.setItem(TAB_RECEIPT_KEY, oldReceipt);
            throw error;
        }
        if (previousId && previousId !== intent.id) {
            provenAuthResults.delete(previousId);
            settleAuthResultWaiters(previousId, new Error('Tentativo Auth sostituito da un recupero esplicito.'));
        }
        return intent;
    }));
}

export async function bindGuestMigrationIntentToUser(user: User): Promise<GuestMigrationIntent> {
    // Register a local waiter before binding: Firebase auth broadcasts do not
    // establish that this tab's popup/email/redirect has returned a credential.
    const prior = readGuestMigrationIntentStrict();
    if (readTabReceipt() !== prior.id) {
        throw new Error('Questo accesso non ha origine da questa scheda.');
    }
    assertUserMatchesIntent(prior, user);
    if (prior.method !== 'recovery' && provenAuthResults.get(prior.id) !== user.uid) {
        await awaitOwnAuthResult(prior.id);
    }
    return withIntentLock(async () => {
        const intent = readGuestMigrationIntentStrict();
        if (intent.id !== prior.id || readTabReceipt() !== intent.id) {
            throw new Error('Il tentativo Auth corrente è cambiato.');
        }
        const uid = user.uid;
        if (intent.claimedBy && intent.claimedBy !== realmClaim) {
            throw new Error('Il tentativo è già stato acquisito da un’altra istanza.');
        }
        if (intent.boundUid && intent.boundUid !== uid) {
            throw new Error('Il tentativo di trasferimento appartiene a una sessione diversa.');
        }
        assertUserMatchesIntent(intent, user);
        if (intent.method !== 'recovery' && provenAuthResults.get(intent.id) !== uid) {
            throw new Error('L’identità non è stata confermata dal login avviato in questa scheda.');
        }
        const bound = { ...intent, boundUid: uid, claimedBy: realmClaim };
        writeBrowserJson(KEY, bound);
        return bound;
    });
}

export function clearGuestMigrationIntent(expectedId: string): Promise<void> {
    return withIntentLock(async () => {
        const current = readGuestMigrationIntentStrict();
        if (current.id !== expectedId || readTabReceipt() !== expectedId) {
            throw new Error('Il tentativo di trasferimento corrente è cambiato.');
        }
        removeBrowserValue(KEY);
        sessionStorage.removeItem(TAB_RECEIPT_KEY);
        provenAuthResults.delete(expectedId);
        settleAuthResultWaiters(expectedId, new Error('Tentativo Auth terminato.'));
    });
}
