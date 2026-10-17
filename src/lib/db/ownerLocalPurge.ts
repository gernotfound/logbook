import { del, get } from 'idb-keyval';
import { lockVault } from '../sync/secureArchiveSession';
import {
    beginLocalPurge, cancelUnstartedLocalPurge, isLocalPurgeIncomplete,
    isLocalPurgePending, markLocalPurgeComplete,
} from '../sync/localPurgeFence';
import { deviceVaultKeyId } from '../sync/secureArchiveKeys';
import { vaultControlMirrorId } from '../sync/secureArchiveControlRecovery';

// This boundary owns the write fence and the physical device purge only.
// Account/consent authorization and server-complete evidence stay with db_account.
const LOCAL_PURGE_MAX_PASSES = 6;

function collectLocalPurgeKeys(owner: string): Set<string> {
    const keys = new Set([
        'logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start', 'logbook_timer_accumulated',
        'draft_measurement', 'draft_exercise', 'draft_routine', 'logbook_awaiting_redirect',
        'logbook_telemetry_queue', 'logbook_storage_marker', 'logbook_storage_anomaly_reported',
        'guest_migration_intent_v1', 'guest_migration_policy'
    ]);
    const ownerUid = owner.startsWith('user:') ? owner.slice('user:'.length) : null;
    if (ownerUid && localStorage.getItem('logbook_guest_migration_sync_recovery') === ownerUid) {
        keys.add('logbook_guest_migration_sync_recovery');
    }
    if (owner === 'guest') { keys.add('logbook_is_guest'); keys.add('logbook_guest_session_id_v1'); }

    const prefix = 'logbook:v2:' + owner + ':';
    const length = localStorage.length;
    for (let index = 0; index < length; index++) {
        const storageKey = localStorage.key(index);
        if (storageKey?.startsWith(prefix) && !storageKey.endsWith(':account-deletion')
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

type PurgeGate = { preflight: () => Promise<void>; afterFence: () => Promise<void> };

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
        if (gate && !isLocalPurgeIncomplete(owner)) await gate.preflight();
        const previouslyIncomplete = isLocalPurgeIncomplete(owner);
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
        lockVault(owner);
        const failures: unknown[] = [];
        const storageKeys = ['logbook:v2:' + owner, 'logbook_cached_user_data',
            'pending_sync_token', 'pending_sync_payload', 'sync_failed'];
        const results = await Promise.allSettled(storageKeys.map(key => del(key)));
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);

    // Wrapped DEK metadata must survive an IndexedDB purge failure. Deleting
    // it first would leave the remaining ciphertext permanently undecryptable.
    if (!failures.length) {
        for (const key of storageKeys) {
            try {
                if (await get<unknown>(key) !== undefined) {
                    failures.push(new Error('Verifica cancellazione IndexedDB fallita: ' + key));
                }
            } catch (error) { failures.push(error); }
        }
    }
    if (failures.length) {
        throw new AggregateError(failures, 'Pulizia locale incompleta (IndexedDB). Chiave cifrata e copie residue conservate per il recupero.');
    }

    let remaining = new Set<string>();
    try {
        for (let pass = 0; pass < LOCAL_PURGE_MAX_PASSES; pass++) {
            const keys = collectLocalPurgeKeys(owner);
            for (const storageKey of keys) {
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

    // Both the non-extractable device key and the wrapping metadata are owner
    // scoped. NEVER remove the device key until the encrypted business envelope
    // and every localStorage snapshot were verifiably removed.
    const controlKey = 'logbook:v2:' + owner + ':secure-vault-control';
    const keyId = deviceVaultKeyId(owner);
    const mirrorId = vaultControlMirrorId(owner);
    try {
        await del(mirrorId);
        if ((await get(mirrorId)) !== undefined) throw new Error('La copia di recupero del controllo locale non è stata eliminata.');
        await del(keyId);
        if ((await get(keyId)) !== undefined) throw new Error('La chiave locale del dispositivo non è stata eliminata.');
        localStorage.removeItem(controlKey);
        if (localStorage.getItem(controlKey) !== null) throw new Error('I metadati crittografici locali non sono stati eliminati.');
    } catch (error) {
        throw new AggregateError([error], 'Pulizia archivio protetto non completata.');
    }
    // Drop the resident DEK only once all encrypted and device records have
    // been verified removed. An incomplete deletion remains recoverable.
    lockVault(owner);
    markLocalPurgeComplete(owner);
    // Keep the non-secret fence after removal. If the last suspended tab sees
    // no vault control, it must not fall back to plaintext legacy storage.
    // The next verified owner will release it only AFTER installing a new vault.
    });
}

