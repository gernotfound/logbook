import { get, update } from 'idb-keyval';
import { openLocalText, sealLocalText, LocalCiphertextError } from './secureArchiveCipher';
import { requireUnlockedLocalKey } from './secureArchiveSession';
import { captureSessionForOwner, isCurrentSession } from './session';

/**
 * Durable account-key cache; a different encryption key from the device DEK.
 * The account key comes ONLY from the authenticated backend (not generated here).
 * This module never performs network I/O or mutates the business journal.
 */
export class CloudAccountKeyMismatchError extends Error {
    readonly code = 'cloud-account-key-mismatch';
    constructor() {
        super('Chiave account diversa da quella già protetta sul dispositivo: sincronizzazione sospesa, dati conservati.');
        this.name = 'CloudAccountKeyMismatchError';
    }
}

export function cloudAccountKeyStorageId(owner: string): string {
    if (typeof owner !== 'string' || !/^user:[^:/]{1,128}$/.test(owner)) {
        throw new CloudAccountKeyMismatchError();
    }
    return 'logbook:v2:' + owner + ':cloud-account-data-key';
}

function keyHex(key: Uint8Array): string {
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new CloudAccountKeyMismatchError();
    return Array.from(key, byte => byte.toString(16).padStart(2, '0')).join('');
}

function openCachedKey(dek: Uint8Array, owner: string, id: string, stored: unknown): Uint8Array {
    if (typeof stored !== 'string') throw new LocalCiphertextError();
    const hex = openLocalText(dek, owner, id, stored);
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new LocalCiphertextError();
    return Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

/** A missing cache is not permission to create a different ADK. */
export async function readCachedAccountDataKey(owner: string): Promise<Uint8Array | null> {
    const id = cloudAccountKeyStorageId(owner);
    const session = captureSessionForOwner(owner);
    if (!isCurrentSession(session)) throw new CloudAccountKeyMismatchError();
    const deviceDek = requireUnlockedLocalKey(owner);
    const stored = await get<unknown>(id);
    if (!isCurrentSession(session) || requireUnlockedLocalKey(owner) !== deviceDek) {
        throw new CloudAccountKeyMismatchError();
    }
    return stored === undefined ? null : openCachedKey(deviceDek, owner, id, stored);
}

/**
 * Immutable per-owner cache: once a key exists, a later (possibly stale or
 * compromised) response must not silently replace it. Existing ciphertext
 * remains available for explicit recovery investigation.
 */
export async function rememberAccountDataKey(owner: string, key: Uint8Array): Promise<void> {
    const id = cloudAccountKeyStorageId(owner);
    const hex = keyHex(key);
    const session = captureSessionForOwner(owner);
    if (!isCurrentSession(session)) throw new CloudAccountKeyMismatchError();
    const deviceDek = requireUnlockedLocalKey(owner);
    await update<unknown>(id, previous => {
        if (!isCurrentSession(session) || requireUnlockedLocalKey(owner) !== deviceDek) {
            throw new CloudAccountKeyMismatchError();
        }
        if (previous !== undefined) {
            const existing = openCachedKey(deviceDek, owner, id, previous);
            if (keyHex(existing) !== hex) throw new CloudAccountKeyMismatchError();
            return previous;
        }
        return sealLocalText(deviceDek, owner, id, hex);
    });
    if (!isCurrentSession(session) || requireUnlockedLocalKey(owner) !== deviceDek) {
        throw new CloudAccountKeyMismatchError();
    }
}
