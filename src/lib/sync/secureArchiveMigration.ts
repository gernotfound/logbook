import { get, update } from 'idb-keyval';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { normalizeStorageOwner } from './owner';
import { deviceKey, protectedDeviceKey } from './deviceStorage';
import { openLocalJson, openLocalText, sealLocalJson, sealLocalText, SEALED_LOCAL_PREFIX, LocalCiphertextError } from './secureArchiveCipher';
import { createLocalKeyVault, unlockLocalKeyVault } from './secureArchiveKeys';
import { publishVaultControl, reconcileVaultControl } from './secureArchiveControlRecovery';
import {
    readVaultControl, unlockVaultForOwner, LocalVaultLockedError,
    verifyMigrationCapability, type PersistedVaultControl,
} from './secureArchiveSession';
import { assertLegacyEnvelopeValidForSecureMigration } from './localRepository';
import { withGuestLifecycleLock } from './guestLifecycleLock';
import { isAccountDeletionPending } from './accountGate';
import { OWNER_UI_PREFERENCES } from '../uiPreferenceKeys';
import { assertNoLocalPurge, isLocalPurgeIncomplete, isLocalPurgePending, releaseLocalPurgeFence, LocalPurgePendingError } from './localPurgeFence';

const SAFE_PLAINTEXT_NAMES = new Set([
    'health-consent-withdrawal', 'health-consent-generation', 'health-consent-last-active',
    'account-deletion', 'secure-vault-control',
    'storage_marker', 'storage_anomaly_reported',
    ...OWNER_UI_PREFERENCES.map(preference => 'ui:' + preference),
]);

/** Explicitly inventory all current device-critical writers. Unknown keys halt migration. */
function isSensitiveDeviceName(name: string): boolean {
    return name === 'telemetry_queue' || name === 'workout' || /^workout-slot:[a-f0-9]{32}$/.test(name)
        || name === 'timer' || name === 'draft_exercise'
        || name === 'draft_routine' || name === 'history-editor-context'
        || (name.startsWith('draft:') && name.length > 'draft:'.length);
}

function ownerStorageNames(owner: string): string[] {
    const prefix = 'logbook:v2:' + owner + ':';
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) names.push(key.slice(prefix.length));
    }
    return names;
}

function assertKnownDeviceNames(owner: string): string[] {
    const names = ownerStorageNames(owner);
    for (const name of names) {
        if (SAFE_PLAINTEXT_NAMES.has(name) || isSensitiveDeviceName(name)) continue;
        if (name.startsWith('sealed:') && isSensitiveDeviceName(name.slice('sealed:'.length))) continue;
        throw new Error('Archivio locale contiene chiavi sconosciute. Migrazione sospesa senza cancellare dati.');
    }
    return [...new Set(names.flatMap(name => name.startsWith('sealed:') ? [name.slice(7)] : isSensitiveDeviceName(name) ? [name] : []))].sort();
}

function assertMigrationAvailable(owner: string, control: PersistedVaultControl, key: Uint8Array): void {
    assertNoLocalPurge(owner);
    verifyMigrationCapability(owner, control.epoch, key);
    if (owner.startsWith('user:') && isAccountDeletionPending(owner)) {
        throw new Error('Cancellazione account in corso: migrazione archivio sospesa.');
    }
}

async function migrateIndexedDb(owner: string, control: PersistedVaultControl, key: Uint8Array): Promise<void> {
    const storageKey = 'logbook:v2:' + owner;
    assertMigrationAvailable(owner, control, key);
    await update<unknown>(storageKey, raw => {
        assertMigrationAvailable(owner, control, key);
        if (raw === undefined) return undefined;
        if (typeof raw === 'string' && raw.startsWith(SEALED_LOCAL_PREFIX)) {
            assertLegacyEnvelopeValidForSecureMigration(openLocalJson(key, owner, storageKey, raw), owner);
            return raw;
        }
        assertLegacyEnvelopeValidForSecureMigration(raw, owner);
        return sealLocalJson(key, owner, storageKey, raw);
    });
    assertMigrationAvailable(owner, control, key);
    const current = await get<unknown>(storageKey);
    if (current !== undefined) {
        if (typeof current !== 'string' || !current.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
        assertLegacyEnvelopeValidForSecureMigration(openLocalJson(key, owner, storageKey, current), owner);
    }
}

/** Convert one legacy snapshot, then verify it, then delete its plaintext copy. */
function migrateDevice(owner: string, control: PersistedVaultControl, key: Uint8Array, name: string): void {
    assertMigrationAvailable(owner, control, key);
    const legacyName = deviceKey(name, owner);
    const secureName = protectedDeviceKey(name, owner);
    const original = readBrowserValueStrict(legacyName);
    const sealed = readBrowserValueStrict(secureName);
    if (sealed !== null) {
        const restored = openLocalText(key, owner, secureName, sealed);
        if (original !== null && restored !== original) {
            throw new Error('Conflitto tra una bozza precedente e quella già cifrata. Nessun dato eliminato.');
        }
        if (original !== null) removeBrowserValue(legacyName);
        return;
    }
    if (original === null) return;
    writeBrowserValue(secureName, sealLocalText(key, owner, secureName, original));
    // Detect quota/storage trouble without deleting the only original copy.
    const confirmed = readBrowserValueStrict(secureName);
    if (!confirmed || openLocalText(key, owner, secureName, confirmed) !== original) {
        throw new LocalCiphertextError();
    }
    assertMigrationAvailable(owner, control, key);
    removeBrowserValue(legacyName);
}

async function migrateAndFinalize(owner: string, control: PersistedVaultControl, dataKey: Uint8Array): Promise<void> {
    assertMigrationAvailable(owner, control, dataKey);
    assertKnownDeviceNames(owner);
    await migrateIndexedDb(owner, control, dataKey);
    for (const name of assertKnownDeviceNames(owner)) migrateDevice(owner, control, dataKey, name);
    assertMigrationAvailable(owner, control, dataKey);
    for (const name of assertKnownDeviceNames(owner)) {
        if (readBrowserValueStrict(deviceKey(name, owner)) !== null) {
            throw new Error('Una vecchia scheda sta scrivendo ancora dati in chiaro. Completa il recupero prima di proseguire.');
        }
        const sealed = readBrowserValueStrict(protectedDeviceKey(name, owner));
        if (sealed !== null) openLocalText(dataKey, owner, protectedDeviceKey(name, owner), sealed);
    }
    const stored = await get<unknown>('logbook:v2:' + owner);
    if (stored !== undefined) {
        if (typeof stored !== 'string') throw new LocalCiphertextError();
        assertLegacyEnvelopeValidForSecureMigration(openLocalJson(dataKey, owner, 'logbook:v2:' + owner, stored), owner);
    }
    assertMigrationAvailable(owner, control, dataKey);
    await publishVaultControl(owner, { ...control, phase: 'active' });
    if (readVaultControl(owner)?.phase !== 'active') throw new Error('Attivazione archivio locale non verificata.');
}

function withSecureMigrationLock<T>(owner: string, operation: () => Promise<T>): Promise<T> {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
        throw new Error('Coordinamento sicuro multi-scheda non disponibile.');
    }
    const execute = () => navigator.locks.request(
        'thelogbook:secure-archive:' + owner, { mode: 'exclusive' }, operation,
    );
    return owner === 'guest' ? withGuestLifecycleLock(execute) : execute();
}

/**
 * Called automatically after current account/guest ownership is established.
 * A failed step leaves original data and a durable MIGRATING marker; the
 * next start reopens the same non-extractable device key and resumes safely.
 */
export async function createAndMigrateVault(requestedOwner: string): Promise<void> {
    const owner = normalizeStorageOwner(requestedOwner);
    return withSecureMigrationLock(owner, async () => {
        // Another tab may have provisioned this owner after the caller checked
        // for missing metadata, but before it acquired the exclusive Web Lock.
        // Reuse its existing device key/DEK; never create a competing archive.
        const finishingPriorPurge = isLocalPurgePending(owner);
        if (finishingPriorPurge && isLocalPurgeIncomplete(owner)) throw new LocalPurgePendingError();
        if (finishingPriorPurge) {
            // The retained fence can be released ONLY with an empty archive.
            // A crash after persisting the new mirror but before localStorage
            // must reuse that same generation, rather than minting a new DEK.
            if (await get<unknown>('logbook:v2:' + owner) !== undefined
                || assertKnownDeviceNames(owner).length > 0) {
                throw new LocalPurgePendingError();
            }
        }
        await reconcileVaultControl(owner, finishingPriorPurge);
        const existing = readVaultControl(owner);
        if (finishingPriorPurge && existing?.phase === 'active') throw new LocalPurgePendingError();
        if (!existing && !finishingPriorPurge) {
            // A lost localStorage control is not permission to install a new
            // DEK over an existing authenticated ciphertext. Preserve bytes.
            const raw = await get<unknown>('logbook:v2:' + owner);
            if ((typeof raw === 'string' && raw.startsWith(SEALED_LOCAL_PREFIX))
                || ownerStorageNames(owner).some(name => name.startsWith('sealed:'))) {
                throw new LocalVaultLockedError();
            }
        }
        if (existing?.phase === 'active') {
            await unlockVaultForOwner(owner);
            return;
        }
        if (existing?.phase === 'migrating') {
            // Crash between publishing the replacement control and releasing
            // the retired fence: the empty new vault is recoverable in place.
            if (finishingPriorPurge) releaseLocalPurgeFence(owner);
            const dataKey = await unlockLocalKeyVault(existing.wrappedKey, owner);
            try {
                await migrateAndFinalize(owner, existing, dataKey);
                await unlockVaultForOwner(owner);
            } finally { dataKey.fill(0); }
            return;
        }
        const { vault, dataKey } = await createLocalKeyVault(owner);
        const epoch = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        const control: PersistedVaultControl = {
            format: 'thelogbook-local-vault-control', version: 2,
            owner, phase: 'migrating', epoch, wrappedKey: vault,
        };
        // Durable marker FIRST; no plain or encrypted business data is touched
        // unless recovery credentials are present for crash resume.
        try {
            await publishVaultControl(owner, control, finishingPriorPurge);
            // Retain the fence during provisioning. Only a durable new migrating
            // control can exclude a stale tab from the no-control legacy path.
            if (finishingPriorPurge) releaseLocalPurgeFence(owner);
            await migrateAndFinalize(owner, control, dataKey);
            await unlockVaultForOwner(owner);
        } finally { dataKey.fill(0); }
    });
}

export async function resumeVaultMigration(requestedOwner: string): Promise<void> {
    const owner = normalizeStorageOwner(requestedOwner);
    await withSecureMigrationLock(owner, async () => {
        await reconcileVaultControl(owner);
        const control = readVaultControl(owner);
        if (!control || control.phase !== 'migrating') throw new Error('Nessuna migrazione riprendibile.');
        const dataKey = await unlockLocalKeyVault(control.wrappedKey, owner);
        try {
            await migrateAndFinalize(owner, control, dataKey);
            await unlockVaultForOwner(owner);
        } finally { dataKey.fill(0); }
    });
}
