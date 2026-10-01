import {
    readBrowserValueStrict,
    removeBrowserValue,
    writeBrowserJson,
} from './browserStorage';

const deletionSuffix = ':account-deletion';
const recoverySuffix = ':account-deletion-recovery';
const deletionKey = (owner: string) => 'logbook:v2:' + owner + deletionSuffix;
const recoveryKey = (owner: string) => 'logbook:v2:' + owner + recoverySuffix;

export interface AccountDeletionMarker {
    owner: string;
    uid: string;
    startedAt: number;
    receiptToken?: string;
    serverAcceptedAt?: number;
}

export interface AccountDeletionRecoveryCredential {
    owner: string;
    uid: string;
    createdAt: number;
    token: string;
    registeredAt?: number;
}

function parseDeletion(owner: string, raw: string | null): AccountDeletionMarker | null {
    if (!raw || !owner.startsWith('user:')) return null;
    try {
        const value = JSON.parse(raw) as Partial<AccountDeletionMarker>;
        const startedAt = Number(value.startedAt);
        if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
        return {
            owner,
            uid: typeof value.uid === 'string' && value.uid ? value.uid : owner.slice(5),
            startedAt,
            receiptToken: typeof value.receiptToken === 'string' ? value.receiptToken : undefined,
            serverAcceptedAt: Number.isFinite(Number(value.serverAcceptedAt)) ? Number(value.serverAcceptedAt) : undefined,
        };
    } catch {
        return null;
    }
}

function parseRecovery(owner: string, raw: string | null): AccountDeletionRecoveryCredential | null {
    if (!raw || !owner.startsWith('user:')) return null;
    try {
        const value = JSON.parse(raw) as Partial<AccountDeletionRecoveryCredential>;
        const createdAt = Number(value.createdAt);
        if (!Number.isFinite(createdAt) || createdAt <= 0 || typeof value.token !== 'string' || !value.token) return null;
        return {
            owner,
            uid: typeof value.uid === 'string' && value.uid ? value.uid : owner.slice(5),
            createdAt,
            token: value.token,
            registeredAt: Number.isFinite(Number(value.registeredAt)) ? Number(value.registeredAt) : undefined,
        };
    } catch {
        return null;
    }
}

export function readAccountDeletionMarker(owner: string): AccountDeletionMarker | null {
    if (typeof localStorage === 'undefined') return null;
    return parseDeletion(owner, readBrowserValueStrict(deletionKey(owner)));
}

export function isAccountDeletionPending(owner: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        return readBrowserValueStrict(deletionKey(owner)) !== null;
    } catch {
        return true;
    }
}

export function markAccountDeletion(owner: string, values?: Partial<Pick<AccountDeletionMarker, 'receiptToken' | 'serverAcceptedAt'>>): AccountDeletionMarker {
    if (!owner.startsWith('user:')) throw new Error('La cancellazione server richiede un account autenticato.');
    let existing: AccountDeletionMarker | null = null;
    try {
        existing = readAccountDeletionMarker(owner);
    } catch {
        // The strict write below remains authoritative.
    }
    const marker: AccountDeletionMarker = {
        owner,
        uid: owner.slice(5),
        startedAt: existing?.startedAt ?? Date.now(),
        receiptToken: values?.receiptToken ?? existing?.receiptToken,
        serverAcceptedAt: values?.serverAcceptedAt ?? existing?.serverAcceptedAt,
    };
    writeBrowserJson(deletionKey(owner), marker);
    return marker;
}

export function clearAccountDeletion(owner: string): void {
    if (typeof localStorage === 'undefined') return;
    removeBrowserValue(deletionKey(owner));
}

export function readAccountDeletionRecoveryCredential(owner: string): AccountDeletionRecoveryCredential | null {
    if (typeof localStorage === 'undefined') return null;
    return parseRecovery(owner, readBrowserValueStrict(recoveryKey(owner)));
}

export function persistAccountDeletionRecoveryCredential(
    owner: string,
    token: string,
): AccountDeletionRecoveryCredential {
    if (!owner.startsWith('user:')) throw new Error('La recovery cancellazione richiede un account autenticato.');
    const existing = readAccountDeletionRecoveryCredential(owner);
    const credential: AccountDeletionRecoveryCredential = {
        owner,
        uid: owner.slice(5),
        createdAt: existing?.createdAt ?? Date.now(),
        token: existing?.token ?? token,
        registeredAt: existing?.registeredAt,
    };
    writeBrowserJson(recoveryKey(owner), credential);
    return credential;
}

export function markAccountDeletionRecoveryCredentialRegistered(owner: string): AccountDeletionRecoveryCredential {
    const credential = readAccountDeletionRecoveryCredential(owner);
    if (!credential) throw new Error('Credenziale locale di recovery non disponibile.');
    const registered = { ...credential, registeredAt: Date.now() };
    writeBrowserJson(recoveryKey(owner), registered);
    return registered;
}

export function clearAccountDeletionRecoveryCredential(owner: string): void {
    if (typeof localStorage === 'undefined') return;
    removeBrowserValue(recoveryKey(owner));
}

export function listRegisteredAccountDeletionRecoveryCredentials(): AccountDeletionRecoveryCredential[] {
    if (typeof localStorage === 'undefined') return [];
    const result: AccountDeletionRecoveryCredential[] = [];
    for (let index = 0; index < localStorage.length; index++) {
        const storageKey = localStorage.key(index);
        if (!storageKey?.startsWith('logbook:v2:user:') || !storageKey.endsWith(recoverySuffix)) continue;
        const owner = storageKey.slice('logbook:v2:'.length, -recoverySuffix.length);
        const credential = parseRecovery(owner, readBrowserValueStrict(storageKey));
        // A lost PUT acknowledgement can leave registeredAt unset even though the
        // server durably accepted this proof. Recovery GET is proof-only and a
        // never-registered credential simply returns 404, so ambiguous credentials
        // are safe and necessary to probe after Auth disappears.
        if (credential) result.push(credential);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function findPendingAccountDeletion(): AccountDeletionMarker | null {
    if (typeof localStorage === 'undefined') return null;
    let newest: AccountDeletionMarker | null = null;
    for (let index = 0; index < localStorage.length; index++) {
        const storageKey = localStorage.key(index);
        if (!storageKey?.startsWith('logbook:v2:user:') || !storageKey.endsWith(deletionSuffix)) continue;
        const owner = storageKey.slice('logbook:v2:'.length, -deletionSuffix.length);
        const marker = parseDeletion(owner, readBrowserValueStrict(storageKey));
        if (marker && (!newest || marker.startedAt > newest.startedAt)) newest = marker;
    }
    return newest;
}
