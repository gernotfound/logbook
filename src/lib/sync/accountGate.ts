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
    return parse(owner, localStorage.getItem(key(owner)));
}

export function isAccountDeletionPending(owner: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    // An unreadable marker remains a hard gate. The writer must fail closed.
    return localStorage.getItem(key(owner)) !== null;
}

export function markAccountDeletion(owner: string, values?: Partial<Pick<AccountDeletionMarker, 'receiptToken' | 'serverAcceptedAt'>>): AccountDeletionMarker {
    if (!owner.startsWith('user:')) throw new Error('La cancellazione server richiede un account autenticato.');
    const existing = readAccountDeletionMarker(owner);
    const marker: AccountDeletionMarker = {
        owner,
        uid: owner.slice(5),
        startedAt: existing?.startedAt ?? Date.now(),
        receiptToken: values?.receiptToken ?? existing?.receiptToken,
        serverAcceptedAt: values?.serverAcceptedAt ?? existing?.serverAcceptedAt,
    };
    localStorage.setItem(key(owner), JSON.stringify(marker));
    return marker;
}

export function clearAccountDeletion(owner: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key(owner));
}

export function findPendingAccountDeletion(): AccountDeletionMarker | null {
    if (typeof localStorage === 'undefined') return null;
    let newest: AccountDeletionMarker | null = null;
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const storageKey = localStorage.key(index);
            if (!storageKey?.startsWith('logbook:v2:user:') || !storageKey.endsWith(suffix)) continue;
            const owner = storageKey.slice('logbook:v2:'.length, -suffix.length);
            const marker = parse(owner, localStorage.getItem(storageKey));
            if (marker && (!newest || marker.startedAt > newest.startedAt)) newest = marker;
        }
    } catch {
        return null;
    }
    return newest;
}
