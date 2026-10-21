import { del, get } from 'idb-keyval';
import { lockVault } from '../sync/secureArchiveSession';
import {
    beginLocalPurge, cancelUnstartedLocalPurge, isLocalPurgeIncomplete,
    isLocalPurgePending, markLocalPurgeComplete,
} from '../sync/localPurgeFence';
import { deviceVaultKeyId } from '../sync/secureArchiveKeys';
import { vaultControlMirrorId } from '../sync/secureArchiveControlRecovery';
import { stableStorageKeyInventory } from '../sync/stableStorageKeyInventory';
import { readBrowserValueStrict } from '../sync/browserStorage';

// This boundary owns the write fence and the physical device purge only.
// Account/consent authorization and server-complete evidence stay with db_account.
const LOCAL_PURGE_MAX_PASSES = 6;

// Fresh start: obsolete pre-launch global business/Background Sync keys
// are neither read nor adopted by an owner purge. Auth retains its own
// active, separately authorized guest→account handoff.
const GUEST_AUTH_INTENT = 'guest_migration_intent_v1';

function collectLocalPurgeKeys(owner: string): Set<string> {
    const keys = new Set<string>();
    // Redirects belong to Auth and are never deleted by owner archive purge.
    const ownerUid = owner.startsWith('user:') ? owner.slice('user:'.length) : null;
    if (ownerUid && localStorage.getItem('logbook_guest_migration_sync_recovery') === ownerUid) {
        keys.add('logbook_guest_migration_sync_recovery');
    }
    if (owner === 'guest') {
        keys.add('logbook_is_guest');
        keys.add('logbook_guest_session_id_v1');
        keys.add(GUEST_AUTH_INTENT);
    }

    const prefix = 'logbook:v2:' + owner + ':';
    for (const storageKey of stableStorageKeyInventory('Inventario localStorage modificato durante la pulizia.')) {
        if (storageKey.startsWith(prefix) && !storageKey.endsWith(':account-deletion')
            && !storageKey.endsWith(':secure-vault-control')) {
            keys.add(storageKey);
        }
    }
    return keys;
}

function remainingLocalPurgeKeys(owner: string): Set<string> {
    const candidates = collectLocalPurgeKeys(owner);
    const remaining = new Set<string>();
    for (const storageKey of candidates) {
        if (localStorage.getItem(storageKey) !== null) remaining.add(storageKey);
    }
    return remaining;
}

type PurgeGate = {
    preflight: () => Promise<void>;
    afterFence: () => Promise<void>;
    /** Recheck after every asynchronous deletion before touching shared data. */
    assertStillSafe?: () => void;
};

export async function purgeOwnerLocalData(owner: string, resumeOnly = false, gate?: PurgeGate) {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
        throw new Error('Coordinamento sicuro multi-scheda non disponibile: pulizia locale sospesa.');
    }
    return navigator.locks.request('thelogbook:secure-archive:' + owner, { mode: 'exclusive' }, async () => {
        // A second tab must not purge newly activated guest data after the
        // previous generation's deletion was already completed.
        if (isLocalPurgePending(owner) && !isLocalPurgeIncomplete(owner)) {
            // Already fully purged. A new sign-out may still need to invalidate Auth.
            if (gate) await gate.afterFence();
            return;
        }
        if (resumeOnly && !isLocalPurgeIncomplete(owner)) return;
        const previouslyIncomplete = isLocalPurgeIncomplete(owner);
        if (!previouslyIncomplete && gate) await gate.preflight();
        beginLocalPurge(owner);
        if (gate) {
            try {
                await gate.afterFence();
            } catch (error) {
                // No deletion occurred yet. Restore write access only if this
                // invocation created the fence; a previous interrupted purge
                // must remain fenced for recovery.
                if (!previouslyIncomplete) cancelUnstartedLocalPurge(owner);
                throw error;
            }
        }
        gate?.assertStillSafe?.();
        // During a guest reset, preserve an Auth attempt started concurrently.
        const initialGuestIntent = owner === 'guest' ? readBrowserValueStrict(GUEST_AUTH_INTENT) : null;
        lockVault(owner);
        const failures: unknown[] = [];
        // Only delete the authenticated owner-scoped IndexedDB envelope.
        // No pre-launch global IDB key belongs to the current owner.
        const ownerKey = 'logbook:v2:' + owner;
        gate?.assertStillSafe?.();
        try {
            await del(ownerKey);
            if ((await get<unknown>(ownerKey)) !== undefined) {
                failures.push(new Error('Verifica cancellazione IndexedDB fallita: ' + ownerKey));
            }
        } catch (error) { failures.push(error); }
        if (failures.length) {
            throw new AggregateError(failures, 'Pulizia locale incompleta (IndexedDB). Chiave cifrata e copie residue conservate per il recupero.');
        }
        gate?.assertStillSafe?.();

    let remaining = new Set<string>();
    try {
        for (let pass = 0; pass < LOCAL_PURGE_MAX_PASSES; pass++) {
            gate?.assertStillSafe?.();
            const keys = collectLocalPurgeKeys(owner);
            for (const storageKey of keys) {
                gate?.assertStillSafe?.();

                // This global migration handoff is owner-labeled by its VALUE,
                // not by its name. Another account may replace it between
                // inventory and removeItem: only erase a matching owner UID.
                if (storageKey === 'logbook_guest_migration_sync_recovery'
                    && localStorage.getItem(storageKey) !== owner.slice('user:'.length)) continue;
                if (storageKey === GUEST_AUTH_INTENT
                    && readBrowserValueStrict(GUEST_AUTH_INTENT) !== initialGuestIntent) {
                    throw new Error('Intento Auth guest cambiato durante la pulizia.');
                }
                try {
                    localStorage.removeItem(storageKey);
                } catch (error) {
                    failures.push(error);
                }
            }
            remaining = remainingLocalPurgeKeys(owner);
            if (remaining.size === 0) break;
        }

        remaining = remainingLocalPurgeKeys(owner);
        if (remaining.size > 0) {
            failures.push(new Error(`Pulizia locale incompleta: restano ${remaining.size} chiavi del proprietario.`));
        }
    } catch (error) {
        failures.push(error);
    }

    if (failures.length) {
        throw new AggregateError(failures, 'Pulizia locale incompleta. Alcuni dati sono ancora presenti su questo dispositivo.');
    }

    gate?.assertStillSafe?.();
    gate?.assertStillSafe?.();

    // Both the non-extractable device key and the wrapping metadata are owner
    // scoped. NEVER remove the device key until the encrypted business envelope
    // and every localStorage snapshot were verifiably removed.
    const controlKey = 'logbook:v2:' + owner + ':secure-vault-control';
    const keyId = deviceVaultKeyId(owner);
    const mirrorId = vaultControlMirrorId(owner);
    try {
        gate?.assertStillSafe?.();
        await del(mirrorId);
        if ((await get(mirrorId)) !== undefined) throw new Error('La copia di recupero del controllo locale non è stata eliminata.');
        gate?.assertStillSafe?.();
        await del(keyId);
        if ((await get(keyId)) !== undefined) throw new Error('La chiave locale del dispositivo non è stata eliminata.');
        gate?.assertStillSafe?.();
        localStorage.removeItem(controlKey);
        if (localStorage.getItem(controlKey) !== null) throw new Error('I metadati crittografici locali non sono stati eliminati.');
    } catch (error) {
        throw new AggregateError([error], 'Pulizia archivio protetto non completata.');
    }
    // Drop the resident DEK only once all encrypted and device records have
    // been verified removed. An incomplete deletion remains recoverable.
    lockVault(owner);
    // The owner fence is completed only after ciphertext and its device key
    // were verified deleted. New versions recover an interrupted owner purge.
    gate?.assertStillSafe?.();
    markLocalPurgeComplete(owner);
    // Keep the non-secret fence after removal. If the last suspended tab sees
    // no vault control, it must not fall back to plaintext legacy storage.
    // The next verified owner will release it only AFTER installing a new vault.
    });
}

