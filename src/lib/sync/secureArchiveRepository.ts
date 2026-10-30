import { get, update } from 'idb-keyval';
import { LocalCiphertextError, openLocalJson, sealLocalJson, SEALED_LOCAL_PREFIX } from './secureArchiveCipher';
import { readVaultControl, requireUnlockedLocalKey, LocalVaultLockedError } from './secureArchiveSession';
import { assertNoLocalPurge } from './localPurgeFence';

/**
 * The ONE LocalEnvelope IndexedDB gateway, used by local repository modules.
 * Every read and write requires the active, unlocked owner vault.
 * The bootstrap provisions it before ordinary domain operations; absent,
 * migrating or invalid controls cannot authorize unsealed storage access.
 */
export async function getArchiveRecord<T>(owner: string): Promise<T | undefined> {
    const storageKey = 'logbook:v2:' + owner;
    assertNoLocalPurge(owner);
    const control = readVaultControl(owner);
    if (control?.phase !== 'active') throw new LocalVaultLockedError();
    const sessionKey = requireUnlockedLocalKey(owner);
    const stored = await get<unknown>(storageKey);
    // A cross-tab change during the asynchronous IndexedDB read invalidates it.
    if (requireUnlockedLocalKey(owner) !== sessionKey) throw new LocalVaultLockedError();
    if (stored === undefined) return undefined;
    if (typeof stored !== 'string' || !stored.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
    return openLocalJson(sessionKey, owner, storageKey, stored) as T;
}

/**
 * This callback runs inside an IndexedDB transaction: non-native thenables
 * must not become persisted data when a caller accidentally returns async work.
 */
function transformSynchronously<T>(
    current: T | undefined, exists: boolean, transform: (current: T | undefined) => T | undefined,
): T | undefined {
    const next = transform(current);
    if (next !== null && (typeof next === 'object' || typeof next === 'function')
        && typeof (next as { then?: unknown }).then === 'function') {
        throw new Error('Operazione locale asincrona vietata nel commit atomico');
    }
    if (exists && next === undefined) {
        throw new Error('Una transizione locale non può eliminare tacitamente l’archivio');
    }
    return next;
}

/** The change callback remains *synchronous* inside idb-keyval.update. */
export async function updateArchiveRecord<T>(
    owner: string, transform: (current: T | undefined) => T | undefined,
): Promise<void> {
    const storageKey = 'logbook:v2:' + owner;
    assertNoLocalPurge(owner);
    const control = readVaultControl(owner);
    if (control?.phase !== 'active') throw new LocalVaultLockedError();
    const sessionKey = requireUnlockedLocalKey(owner);
    await update<unknown>(storageKey, raw => {
        if (requireUnlockedLocalKey(owner) !== sessionKey) throw new LocalVaultLockedError();
        if (raw !== undefined && (typeof raw !== 'string' || !raw.startsWith(SEALED_LOCAL_PREFIX))) {
            throw new LocalCiphertextError();
        }
        const current = raw === undefined ? undefined : openLocalJson(sessionKey, owner, storageKey, raw) as T;
        const next = transformSynchronously(current, raw !== undefined, transform);
        if (requireUnlockedLocalKey(owner) !== sessionKey) throw new LocalVaultLockedError();
        if (next === current) return raw;
        return next === undefined ? undefined : sealLocalJson(sessionKey, owner, storageKey, next);
    });
}
