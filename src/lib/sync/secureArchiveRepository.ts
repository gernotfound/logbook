import { get, update } from 'idb-keyval';
import { LocalCiphertextError, openLocalJson, sealLocalJson, SEALED_LOCAL_PREFIX } from './secureArchiveCipher';
import { readVaultControl, requireUnlockedLocalKey, LocalVaultLockedError } from './secureArchiveSession';

/**
 * The ONE LocalEnvelope IndexedDB gateway, used by localRepository.
 * A vault that exists but is not unlocked never falls back to plaintext.
 *
 * Legacy plaintext is supported ONLY while no vault has been provisioned.
 * The bootstrap onboarding must provision/migrate that owner BEFORE allowing
 * new ordinary domain writes. A partially migrated vault blocks all reads/writes.
 */
export async function getArchiveRecord<T>(owner: string): Promise<T | undefined> {
    const storageKey = 'logbook:v2:' + owner;
    const control = readVaultControl(owner);
    if (control) {
        if (control.phase !== 'active') throw new LocalVaultLockedError();
        const sessionKey = requireUnlockedLocalKey(owner);
        const stored = await get<unknown>(storageKey);
        // A cross-tab change during the asynchronous IndexedDB read invalidates it.
        if (requireUnlockedLocalKey(owner) !== sessionKey) throw new LocalVaultLockedError();
        if (stored === undefined) return undefined;
        if (typeof stored !== 'string' || !stored.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
        return openLocalJson(sessionKey, owner, storageKey, stored) as T;
    }
    const stored = await get<unknown>(storageKey);
    if (readVaultControl(owner)) throw new LocalVaultLockedError();
    if (typeof stored === 'string' && stored.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
    return stored as T | undefined;
}

/** The change callback remains *synchronous* inside idb-keyval.update. */
export async function updateArchiveRecord<T>(
    owner: string, transform: (current: T | undefined) => T | undefined,
): Promise<void> {
    const storageKey = 'logbook:v2:' + owner;
    const control = readVaultControl(owner);
    if (control) {
        if (control.phase !== 'active') throw new LocalVaultLockedError();
        const sessionKey = requireUnlockedLocalKey(owner);
        await update<unknown>(storageKey, raw => {
            if (requireUnlockedLocalKey(owner) !== sessionKey) throw new LocalVaultLockedError();
            if (raw !== undefined && (typeof raw !== 'string' || !raw.startsWith(SEALED_LOCAL_PREFIX))) {
                throw new LocalCiphertextError();
            }
            const current = raw === undefined ? undefined : openLocalJson(sessionKey, owner, storageKey, raw) as T;
            const next = transform(current);
            if (next instanceof Promise) throw new Error('Operazione locale asincrona vietata nel commit atomico');
            if (requireUnlockedLocalKey(owner) !== sessionKey) throw new LocalVaultLockedError();
            if (next === current) return raw;
            if (next === undefined) {
                if (raw !== undefined) throw new Error('Una transizione cifrata non può eliminare tacitamente l’archivio');
                return undefined;
            }
            return sealLocalJson(sessionKey, owner, storageKey, next);
        });
        return;
    }

    // Existing pre-migration behavior for a legacy account. Fail on any late
    // vault setup or already-sealed record instead of writing plaintext.
    await update<unknown>(storageKey, raw => {
        if (readVaultControl(owner)) throw new LocalVaultLockedError();
        if (typeof raw === 'string' && raw.startsWith(SEALED_LOCAL_PREFIX)) {
            throw new LocalCiphertextError();
        }
        return transform(raw as T | undefined);
    });
}
