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

export class AccountDeletionMarkerCorruptError extends Error {
    readonly code = 'account-deletion-marker-corrupt';
    readonly owner: string;

    constructor(owner: string, cause?: unknown) {
        super('Marker di cancellazione account presente ma non leggibile. La copia locale resta bloccata fino alla riconciliazione.', { cause });
        this.name = 'AccountDeletionMarkerCorruptError';
        this.owner = owner;
    }
}

function parse(owner: string, raw: string | null): AccountDeletionMarker | null {
    if (raw === null) return null;
    if (!owner.startsWith('user:')) throw new AccountDeletionMarkerCorruptError(owner);

    try {
        const value = JSON.parse(raw) as Partial<AccountDeletionMarker>;
        const expectedUid = owner.slice(5);
        const startedAt = Number(value.startedAt);
        if (!Number.isFinite(startedAt) || startedAt <= 0) {
            throw new AccountDeletionMarkerCorruptError(owner);
        }

        const uid = typeof value.uid === 'string' && value.uid ? value.uid : expectedUid;
        if (uid !== expectedUid) throw new AccountDeletionMarkerCorruptError(owner);

        const receiptToken = value.receiptToken;
        if (receiptToken !== undefined && (typeof receiptToken !== 'string' || receiptToken.length === 0)) {
            throw new AccountDeletionMarkerCorruptError(owner);
        }

        const rawServerAcceptedAt = value.serverAcceptedAt;
        let serverAcceptedAt: number | undefined;
        if (rawServerAcceptedAt !== undefined) {
            serverAcceptedAt = Number(rawServerAcceptedAt);
            if (!Number.isFinite(serverAcceptedAt) || serverAcceptedAt <= 0) {
                throw new AccountDeletionMarkerCorruptError(owner);
            }
        }

        return { owner, uid, startedAt, receiptToken, serverAcceptedAt };
    } catch (error) {
        if (error instanceof AccountDeletionMarkerCorruptError) throw error;
        throw new AccountDeletionMarkerCorruptError(owner, error);
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
    const existing = readAccountDeletionMarker(owner);
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

export function listPendingAccountDeletions(): {
    markers: AccountDeletionMarker[];
    corrupt: AccountDeletionMarkerCorruptError[];
} {
    const markers: AccountDeletionMarker[] = [];
    const corrupt: AccountDeletionMarkerCorruptError[] = [];
    if (typeof localStorage === 'undefined') return { markers, corrupt };
    for (let index = 0; index < localStorage.length; index++) {
        const storageKey = localStorage.key(index);
        if (!storageKey?.startsWith('logbook:v2:user:') || !storageKey.endsWith(suffix)) continue;
        const owner = storageKey.slice('logbook:v2:'.length, -suffix.length);
        try {
            const marker = parse(owner, readBrowserValueStrict(storageKey));
            if (marker) markers.push(marker);
        } catch (error) {
            if (!(error instanceof AccountDeletionMarkerCorruptError)) throw error;
            corrupt.push(error);
        }
    }
    markers.sort((a, b) => a.startedAt - b.startedAt);
    return { markers, corrupt };
}

export function findPendingAccountDeletion(): AccountDeletionMarker | null {
    const { markers, corrupt } = listPendingAccountDeletions();
    // Writer barriers must remain fail-closed even when another marker is valid.
    if (corrupt.length) throw corrupt[0];
    return markers.at(-1) ?? null;
}
