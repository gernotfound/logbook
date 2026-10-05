import type { User } from 'firebase/auth';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserJson } from '../sync/browserStorage';
import type { GuestMigrationPolicy } from '../../contexts/AuthContextDef';

const KEY = 'guest_migration_intent_v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
        || typeof value.id !== 'string'
        || !value.id
        || (value.policy !== 'merge' && value.policy !== 'skip')
        || (value.method !== 'email' && value.method !== 'google' && value.method !== 'recovery')
        || typeof value.startedAt !== 'number'
        || !Number.isFinite(value.startedAt)
        || value.startedAt <= 0
    ) {
        throw new Error('Tentativo di trasferimento guest non valido.');
    }

    const intent: GuestMigrationIntent = {
        version: 1,
        id: value.id,
        policy: value.policy,
        method: value.method,
        startedAt: value.startedAt,
    };
    if (typeof value.expectedEmail === 'string' && value.expectedEmail) intent.expectedEmail = value.expectedEmail;
    if (typeof value.expectedUid === 'string' && value.expectedUid) intent.expectedUid = value.expectedUid;
    if (typeof value.boundUid === 'string' && value.boundUid) intent.boundUid = value.boundUid;
    return intent;
}

export function beginGuestMigrationIntent(
    policy: GuestMigrationPolicy,
    method: GuestMigrationMethod,
    options: { email?: string; uid?: string } = {},
): GuestMigrationIntent {
    const intent: GuestMigrationIntent = {
        version: 1,
        id: createId(),
        policy,
        method,
        startedAt: Date.now(),
    };
    const email = normalizeEmail(options.email);
    if (email) intent.expectedEmail = email;
    if (options.uid) intent.expectedUid = options.uid;
    writeBrowserJson(KEY, intent);
    return intent;
}

export function readGuestMigrationIntentStrict(): GuestMigrationIntent {
    const intent = parse(readBrowserValueStrict(KEY));
    if (Date.now() - intent.startedAt > MAX_AGE_MS) {
        throw new Error('Il tentativo di trasferimento guest è scaduto. Avvia nuovamente l’accesso.');
    }
    return intent;
}

export function bindGuestMigrationIntentToUser(user: User): GuestMigrationIntent {
    const intent = readGuestMigrationIntentStrict();
    const uid = user.uid;
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
    const bound = { ...intent, boundUid: uid };
    writeBrowserJson(KEY, bound);
    return bound;
}

export function clearGuestMigrationIntent(expectedId?: string): void {
    if (expectedId) {
        const current = readGuestMigrationIntentStrict();
        if (current.id !== expectedId) throw new Error('Il tentativo di trasferimento corrente è cambiato.');
    }
    removeBrowserValue(KEY);
}
