import { get, update } from 'idb-keyval';
import { openLocalJson, sealLocalJson, SEALED_LOCAL_PREFIX, LocalCiphertextError } from './secureArchiveCipher';

/**
 * Synchronous cleartext transformation within one real IndexedDB transaction.
 * This intentionally never calls Web Crypto or any asynchronous code inside
 * the IDB update callback: concurrent writers remain serialized by IDB.
 *
 * This low-level primitive is NOT connected to production localRepository yet.
 * Activation requires an unlocked, owner-fenced key capability and migration.
 */
export function sealedArchiveKey(owner: string): string {
    if (!owner || owner.length > 512 || (owner !== 'guest' && !/^user:[^:]+$/.test(owner))) {
        throw new Error('Proprietario archivio cifrato non valido');
    }
    return 'logbook:v2:' + owner;
}

export async function readSealedArchive<T>(owner: string, key: Uint8Array): Promise<T | undefined> {
    const storageKey = sealedArchiveKey(owner);
    const raw: unknown = await get<unknown>(storageKey);
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || !raw.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
    return openLocalJson(key, owner, storageKey, raw) as T;
}

/** A mutable cleartext snapshot never outlives this call's JavaScript realm. */
export async function updateSealedArchive<T>(
    owner: string, key: Uint8Array,
    mutate: (current: T | undefined) => T,
): Promise<void> {
    const storageKey = sealedArchiveKey(owner);
    await update<unknown>(storageKey, (raw: unknown): unknown => {
        if (raw !== undefined && (typeof raw !== 'string' || !raw.startsWith(SEALED_LOCAL_PREFIX))) {
            throw new LocalCiphertextError();
        }
        const current = raw === undefined ? undefined : openLocalJson(key, owner, storageKey, raw) as T;
        const next = mutate(current);
        if (next === undefined || next instanceof Promise) {
            throw new Error('La mutazione atomica cifrata deve restituire immediatamente uno snapshot valido');
        }
        return sealLocalJson(key, owner, storageKey, next);
    });
}
