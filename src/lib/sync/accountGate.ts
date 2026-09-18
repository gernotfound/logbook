import {
    readBrowserValueStrict,
    removeBrowserValue,
    writeBrowserJson,
} from './browserStorage';

const suffix = ':account-deletion';
const key = (owner: string) => 'logbook:v2:' + owner + suffix;

export interface AccountDeletionMarker {
    owner: string;
    uid: string;
    startedAt: number;
    receiptToken?: string;
    serverAcceptedAt?: number;
}

function parse(owner: string, raw: string | null): AccountDeletionMarker | null {
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

export function readAccountDeletionMarker(owner: string): AccountDeletionMarker | null {
    if (typeof localStorage === 'undefined') return null;
    return parse(owner, readBrowserValueStrict(key(owner)));
}

export function isAccountDeletionPending(owner: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        // An unreadable marker remains a hard gate: storage failure cannot be
        // interpreted as proof that account deletion is not in progress.
        return readBrowserValueStrict(key(owner)) !== null;
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
        // We can still attempt to persist a fresh marker. The strict write below
        // is the authority: if storage is unavailable the deletion flow stops.
    }
    const marker: AccountDeletionMarker = {
        owner,
        uid: owner.slice(5),
        startedAt: existing?.startedAt ?? Date.now(),
        receiptToken: values?.receiptToken ?? existing?.receiptToken,
        serverAcceptedAt: values?.serverAcceptedAt ?? existing?.serverAcceptedAt,
    };
    writeBrowserJson(key(owner), marker);
    return marker;
}

export function clearAccountDeletion(owner: string): void {
    if (typeof localStorage === 'undefined') return;
    removeBrowserValue(key(owner));
}

export function findPendingAccountDeletion(): AccountDeletionMarker | null {
    if (typeof localStorage === 'undefined') return null;
    let newest: AccountDeletionMarker | null = null;
    for (let index = 0; index < localStorage.length; index++) {
        const storageKey = localStorage.key(index);
        if (!storageKey?.startsWith('logbook:v2:user:') || !storageKey.endsWith(suffix)) continue;
        const owner = storageKey.slice('logbook:v2:'.length, -suffix.length);
        const marker = parse(owner, readBrowserValueStrict(storageKey));
        if (marker && (!newest || marker.startedAt > newest.startedAt)) newest = marker;
    }
    return newest;
}
