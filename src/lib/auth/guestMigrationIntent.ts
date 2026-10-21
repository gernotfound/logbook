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
            throw new Error('Sessione di recupero guest non più attiva.');
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
        sessionStorage.setItem(TAB_RECEIPT_KEY, intent.id);
        try {
            writeBrowserJson(KEY, intent);
        } catch (error) {
            if (oldReceipt === null) sessionStorage.removeItem(TAB_RECEIPT_KEY);
            else sessionStorage.setItem(TAB_RECEIPT_KEY, oldReceipt);
            throw error;
        }
        return intent;
    }));
}

export function bindGuestMigrationIntentToUser(user: User): Promise<GuestMigrationIntent> {
    return withIntentLock(async () => {
        const intent = readGuestMigrationIntentStrict();
        if (readTabReceipt() !== intent.id) {
            throw new Error('Questo accesso non ha origine da questa scheda.');
        }
        const uid = user.uid;
        if (intent.claimedBy && intent.claimedBy !== realmClaim) {
            throw new Error('Il tentativo è già stato acquisito da un’altra istanza.');
        }
        if (intent.boundUid && intent.boundUid !== uid) {
            throw new Error('Il tentativo di trasferimento appartiene a una sessione diversa.');
        }
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
    });
}
