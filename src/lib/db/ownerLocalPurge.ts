import { del, get } from 'idb-keyval';
import { lockVault } from '../sync/secureArchiveSession';
import {
    beginLocalPurge, cancelUnstartedLocalPurge, isLocalPurgeIncomplete,
    isLocalPurgePending, markLocalPurgeComplete,
} from '../sync/localPurgeFence';
import { deviceVaultKeyId } from '../sync/secureArchiveKeys';
import { vaultControlMirrorId } from '../sync/secureArchiveControlRecovery';
import { stableStorageKeyInventory } from '../sync/stableStorageKeyInventory';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from '../sync/browserStorage';

// This boundary owns the write fence and the physical device purge only.
// Account/consent authorization and server-complete evidence stay with db_account.
const LOCAL_PURGE_MAX_PASSES = 6;

// These old idb-keyval entries have no owner identity. The current application
// no longer writes them, but an already running legacy tab may still do so.
// An owner-scoped purge must not turn their physical location into ownership.
const OWNERLESS_LEGACY_IDB_KEYS = [
    'logbook_cached_user_data', 'pending_sync_token', 'pending_sync_payload', 'sync_failed',
] as const;

async function assertNoOwnerlessLegacyIndexedDbData(): Promise<void> {
    for (const key of OWNERLESS_LEGACY_IDB_KEYS) {
        if (await get<unknown>(key) !== undefined) {
            throw new Error('Pulizia sospesa: dati IndexedDB legacy senza proprietario verificabile (' + key + ').');
        }
    }
}

// Only legacy compatibility keys without an owner namespace. New app writers
// must not publish business data under these names. A suspended old tab may
// still write them while a purge waits for IndexedDB, however.
const UNSCOPED_LEGACY_KEYS = [
    'logbook_local_workout', 'logbook_timer_state', 'logbook_timer_start', 'logbook_timer_accumulated',
    'draft_measurement', 'draft_exercise', 'draft_routine', 'logbook_awaiting_redirect',
    'logbook_telemetry_queue', 'logbook_storage_marker', 'logbook_storage_anomaly_reported',
    'guest_migration_intent_v1', 'guest_migration_policy',
] as const;
const UNSCOPED_LEGACY_KEY_SET: ReadonlySet<string> = new Set(UNSCOPED_LEGACY_KEYS);

// The active guest→account migration intent belongs to the guest/Auth flow,
// not to any account being signed out or deleted. The guest reset still owns it.
// Keep the historical fingerprint vector shape for resumed v1 purge evidence.
const GUEST_AUTH_INTENT = 'guest_migration_intent_v1';
const purgeOwnsLegacyKey = (owner: string, key: string): boolean =>
    key !== GUEST_AUTH_INTENT || owner === 'guest';

 
// A purge restart must not adopt unowned values created after its first attempt.
// Persist only SHA-256 fingerprints (never plaintext recovery data) BEFORE
// starting asynchronous IndexedDB deletion.
const purgeLegacySnapshotKey = (owner: string) => 'logbook:local-purge-legacy-snapshot:v1:' + owner;
const HEX_SHA256 = /^[a-f0-9]{64}$/;

async function fingerprintLegacyValue(value: string | null): Promise<string | null> {
    if (value === null) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readFrozenLegacySnapshot(owner: string, resuming: boolean): Promise<Map<string, string | null>> {
    const key = purgeLegacySnapshotKey(owner);
    const initial = new Map(UNSCOPED_LEGACY_KEYS.map(name => [
        name, purgeOwnsLegacyKey(owner, name) ? readBrowserValueStrict(name) : null,
    ]));
    const existing = readBrowserValueStrict(key);
    const hashes = await Promise.all([...initial.values()].map(fingerprintLegacyValue));
    // Web Crypto is async. Do not publish a baseline for values that were
    // modified while computing their fingerprints.
    if (UNSCOPED_LEGACY_KEYS.some(name => purgeOwnsLegacyKey(owner, name)
        && readBrowserValueStrict(name) !== initial.get(name))) {
        throw new Error('Chiavi legacy cambiate prima della registrazione della pulizia.');
    }
    if (resuming) {
        if (existing === null) {
            // Older interrupted purges, or a crash after installing the fence
            // but before recording the snapshot, have no proven provenance.
            // An active redirect belongs to Auth and is never deleted here.
            if (UNSCOPED_LEGACY_KEYS.some(name => name !== 'logbook_awaiting_redirect'
                && initial.get(name) !== null)
                || (initial.get('logbook_awaiting_redirect') !== null
                    && initial.get('logbook_awaiting_redirect') !== 'true')) {
                throw new Error('Provenienza delle chiavi legacy dopo una pulizia interrotta non verificabile.');
            }
        } else {
            let saved: unknown;
            try { saved = JSON.parse(existing) as unknown; } catch {
                throw new Error('Prova delle chiavi legacy non valida: pulizia sospesa.');
            }
            const record = saved as { version?: unknown; owner?: unknown; hashes?: unknown } | null;
            if (!record || record.version !== 1 || record.owner !== owner
                || !Array.isArray(record.hashes) || record.hashes.length !== UNSCOPED_LEGACY_KEYS.length
                || record.hashes.some(value => value !== null && (typeof value !== 'string' || !HEX_SHA256.test(value)))) {
                throw new Error('Prova delle chiavi legacy non valida: pulizia sospesa.');
            }
            for (let i = 0; i < hashes.length; i++) {
                const name = UNSCOPED_LEGACY_KEYS[i];
                // An active Google redirect belongs to the next auth flow.
                if (name === 'logbook_awaiting_redirect' && initial.get(name) === 'true') continue;
                // Absence is safe: an earlier pass may have removed this key
                // before a crash. A present value must match the *first* attempt.
                if (hashes[i] !== null && hashes[i] !== record.hashes[i]) {
                    throw new Error('Chiave legacy senza provenienza dopo il riavvio: ' + name);
                }
            }
        }
    } else {
        if (existing !== null) {
            throw new Error('Prova precedente della pulizia legacy non riconciliata.');
        }
        const serialized = JSON.stringify({ version: 1, owner, hashes });
        writeBrowserValue(key, serialized);
        if (readBrowserValueStrict(key) !== serialized) {
            throw new Error('Prova durevole delle chiavi legacy non verificabile.');
        }
    }
    return initial;
}


function collectLocalPurgeKeys(owner: string): Set<string> {
    const keys = new Set<string>(UNSCOPED_LEGACY_KEYS.filter(key => purgeOwnsLegacyKey(owner, key)));
    // An in-flight Google login redirect belongs to the AUTH flow, not to
    // the account or guest archive being removed. It can begin while an
    // older account's IndexedDB cleanup is still pending.
    if (localStorage.getItem('logbook_awaiting_redirect') === 'true') {
        keys.delete('logbook_awaiting_redirect');
    }
    const ownerUid = owner.startsWith('user:') ? owner.slice('user:'.length) : null;
    if (ownerUid && localStorage.getItem('logbook_guest_migration_sync_recovery') === ownerUid) {
        keys.add('logbook_guest_migration_sync_recovery');
    }
    if (owner === 'guest') { keys.add('logbook_is_guest'); keys.add('logbook_guest_session_id_v1'); }

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
        if (!previouslyIncomplete) {
            // Known unattributed IDB bytes must prevent sign-out and the
            // durable fence, not strand the user in an unfinished purge.
            // Run this asynchronous probe BEFORE the final owner/journal
            // preflight; no new await is introduced between that gate and
            // installation of the synchronous writer fence.
            await assertNoOwnerlessLegacyIndexedDbData();
            if (gate) await gate.preflight();
        }
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
        // Capture legacy globals before the first awaited IndexedDB operation.
        // A new session can write a value before Firebase publishes its UID;
        // the owner identity gate alone cannot attribute that shared key.
        const legacyAtStart = await readFrozenLegacySnapshot(owner, previouslyIncomplete);
        gate?.assertStillSafe?.();
        const legacyRemoved = new Set<string>();
        lockVault(owner);
        const failures: unknown[] = [];
        // Only the owner-scoped envelope can be deleted before the next awaited
        // identity check. Only the explicitly owner-scoped IDB envelope may
        // be removed; ownerless legacy keys are never part of this delete.
        const ownerKey = 'logbook:v2:' + owner;
        // Ownerless values cannot be safely attributed even if present before
        // the purge. Refuse automatic erasure instead of deleting another
        // session's legacy writes; keep the durable fence for reconciliation.
        await assertNoOwnerlessLegacyIndexedDbData();
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
        // The owner lock does not serialize a legacy tab's global IDB writes.
        // Check again after the awaited owner deletion; never delete globals.
        gate?.assertStillSafe?.();
        await assertNoOwnerlessLegacyIndexedDbData();
        gate?.assertStillSafe?.();

    let remaining = new Set<string>();
    try {
        for (let pass = 0; pass < LOCAL_PURGE_MAX_PASSES; pass++) {
            gate?.assertStillSafe?.();
            const keys = collectLocalPurgeKeys(owner);
            for (const storageKey of keys) {
                gate?.assertStillSafe?.();
                // This active auth marker belongs to the new Google redirect,
                // not the old owner. Its normal lifecycle clears it.
                if (storageKey === 'logbook_awaiting_redirect'
                    && localStorage.getItem(storageKey) === 'true') continue;
                // This global migration handoff is owner-labeled by its VALUE,
                // not by its name. Another account may replace it between
                // inventory and removeItem: only erase a matching owner UID.
                if (storageKey === 'logbook_guest_migration_sync_recovery'
                    && localStorage.getItem(storageKey) !== owner.slice('user:'.length)) continue;
                if (UNSCOPED_LEGACY_KEY_SET.has(storageKey)) {
                    const expected = legacyRemoved.has(storageKey) ? null : legacyAtStart.get(storageKey);
                    if (localStorage.getItem(storageKey) !== expected) {
                        // Do not erase a different value published during a
                        // purge. Retain the owner fence for a safe retry.
                        throw new Error('Chiave legacy condivisa modificata durante la pulizia: ' + storageKey);
                    }
                }
                try {
                    localStorage.removeItem(storageKey);
                    if (UNSCOPED_LEGACY_KEY_SET.has(storageKey)) legacyRemoved.add(storageKey);
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
    await assertNoOwnerlessLegacyIndexedDbData();
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
    // An unscoped legacy write during key erasure must not be reported as
    // completed cleanup. This is detection, not cross-tab atomicity.
    gate?.assertStillSafe?.();
    await assertNoOwnerlessLegacyIndexedDbData();
    gate?.assertStillSafe?.();
    // The original fingerprints are no longer needed once all deletes and
    // encryption-key cleanup have succeeded. If interrupted here, only absent
    // unscoped values may be resumed without the removed snapshot.
    removeBrowserValue(purgeLegacySnapshotKey(owner));
    markLocalPurgeComplete(owner);
    // Keep the non-secret fence after removal. If the last suspended tab sees
    // no vault control, it must not fall back to plaintext legacy storage.
    // The next verified owner will release it only AFTER installing a new vault.
    });
}

