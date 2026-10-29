import { stableStorageKeyInventory } from './stableStorageKeyInventory';
import {
    BrowserStorageError,
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
    if (!owner.startsWith('user:') || owner.length <= 'user:'.length) throw new AccountDeletionMarkerCorruptError(owner);

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new AccountDeletionMarkerCorruptError(owner);
        }
        const value = parsed as Partial<AccountDeletionMarker>;
        const expectedUid = owner.slice(5);
        const startedAt = value.startedAt;
        if (typeof startedAt !== 'number' || !Number.isSafeInteger(startedAt) || startedAt <= 0) {
            throw new AccountDeletionMarkerCorruptError(owner);
        }

        if (value.owner !== owner || value.uid !== expectedUid) {
            throw new AccountDeletionMarkerCorruptError(owner);
        }

        const receiptToken = value.receiptToken;
        if (receiptToken !== undefined && (typeof receiptToken !== 'string' || receiptToken.length === 0)) {
            throw new AccountDeletionMarkerCorruptError(owner);
        }

        const rawServerAcceptedAt = value.serverAcceptedAt;
        let serverAcceptedAt: number | undefined;
        if (rawServerAcceptedAt !== undefined) {
            if (typeof rawServerAcceptedAt !== 'number' || !Number.isSafeInteger(rawServerAcceptedAt) || rawServerAcceptedAt <= 0) {
                throw new AccountDeletionMarkerCorruptError(owner);
            }
            serverAcceptedAt = rawServerAcceptedAt;
        }

        return { owner, uid: expectedUid, startedAt, receiptToken, serverAcceptedAt };
    } catch (error) {
        if (error instanceof AccountDeletionMarkerCorruptError) throw error;
        throw new AccountDeletionMarkerCorruptError(owner, error);
    }
}

export function readAccountDeletionMarker(owner: string): AccountDeletionMarker | null {
    return parse(owner, readBrowserValueStrict(key(owner)));
}

export function isAccountDeletionPending(owner: string): boolean {
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
    removeBrowserValue(key(owner));
}

export function listPendingAccountDeletions(): {
    markers: AccountDeletionMarker[];
    corrupt: AccountDeletionMarkerCorruptError[];
} {
    const markers: AccountDeletionMarker[] = [];
    const corrupt: AccountDeletionMarkerCorruptError[] = [];
    if (typeof localStorage === 'undefined') {
        throw new BrowserStorageError('read', 'account-deletion-inventory', new Error('localStorage unavailable'));
    }
    const inventory = stableStorageKeyInventory('Inventario marker cancellazione account modificato durante il recupero: copie preservate.');
    for (const storageKey of inventory) {
        if (!storageKey.startsWith('logbook:v2:user:') || !storageKey.endsWith(suffix)) continue;
        const owner = storageKey.slice('logbook:v2:'.length, -suffix.length);
        try {
            const marker = parse(owner, readBrowserValueStrict(storageKey));
            // A key present in the inventory but missing at read time is not
            // proof that its durable receipt was safely removed.
            if (!marker) throw new AccountDeletionMarkerCorruptError(owner);
            markers.push(marker);
        } catch (error) {
            corrupt.push(error instanceof AccountDeletionMarkerCorruptError
                ? error : new AccountDeletionMarkerCorruptError(owner, error));
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
