import { get, set } from 'idb-keyval';
import { readBrowserValueStrict, writeBrowserValue } from './browserStorage';
import { assertNoLocalPurge, isLocalPurgeIncomplete, isLocalPurgePending } from './localPurgeFence';
import { normalizeStorageOwner } from './owner';
import { unlockLocalKeyVault } from './secureArchiveKeys';
import {
    LocalVaultLockedError, parsePersistedVaultControl, readVaultControl,
    vaultControlKey, type PersistedVaultControl,
} from './secureArchiveSession';

/**
 * Redundant wrapped-DEK control: localStorage remains authoritative for
 * synchronous storage gateways; IndexedDB holds a recovery-only copy.
 * Both rely on the same non-extractable IDB device key, so this protects
 * against partial metadata loss, not complete device/browser-profile loss.
 */
export function vaultControlMirrorId(owner: string): string {
    return 'logbook:v2:' + normalizeStorageOwner(owner) + ':secure-vault-control-mirror';
}

async function readMirror(owner: string): Promise<PersistedVaultControl | null> {
    let raw: unknown;
    try { raw = await get<unknown>(vaultControlMirrorId(owner)); }
    catch { throw new LocalVaultLockedError(); }
    if (raw === undefined) return null;
    return parsePersistedVaultControl(owner, raw);
}

function sameGeneration(a: PersistedVaultControl, b: PersistedVaultControl): boolean {
    return a.owner === b.owner && a.epoch === b.epoch
        && JSON.stringify(a.wrappedKey) === JSON.stringify(b.wrappedKey);
}

async function confirmKey(owner: string, control: PersistedVaultControl): Promise<void> {
    const key = await unlockLocalKeyVault(control.wrappedKey, owner);
    key.fill(0);
}

function assertPublishPermitted(owner: string, allowRetiredFence: boolean): void {
    if (!allowRetiredFence) {
        assertNoLocalPurge(owner);
    } else if (!isLocalPurgePending(owner) || isLocalPurgeIncomplete(owner)) {
        // Only a caller with exclusive lock and a verified empty archive may
        // provision under the retained, completed-purge fence.
        throw new LocalVaultLockedError();
    }
}

/** Never replace unrelated epochs or wrapped keys, even across crashes. */
async function writeMirror(owner: string, control: PersistedVaultControl, allowRetiredFence = false): Promise<void> {
    assertPublishPermitted(owner, allowRetiredFence);
    const previous = await readMirror(owner);
    if (previous && !sameGeneration(previous, control)) throw new LocalVaultLockedError();
    try { await set(vaultControlMirrorId(owner), control); }
    catch { throw new LocalVaultLockedError(); }
    const verified = await readMirror(owner);
    if (!verified || !sameGeneration(verified, control) || verified.phase !== control.phase) {
        throw new LocalVaultLockedError();
    }
    assertPublishPermitted(owner, allowRetiredFence);
}

/**
 * Publish recovery copy BEFORE synchronous metadata. An interrupted write
 * leaves a recoverable mirror and never silently promotes a migration.
 */
export async function publishVaultControl(
    owner: string, control: PersistedVaultControl, allowRetiredFence = false,
): Promise<void> {
    const normalized = normalizeStorageOwner(owner);
    assertPublishPermitted(normalized, allowRetiredFence);
    const primary = readVaultControl(normalized);
    if (primary && !sameGeneration(primary, control)) throw new LocalVaultLockedError();
    await writeMirror(normalized, control, allowRetiredFence);
    writeBrowserValue(vaultControlKey(normalized), JSON.stringify(control));
    const verified = readVaultControl(normalized);
    if (!verified || !sameGeneration(verified, control) || verified.phase !== control.phase) {
        throw new LocalVaultLockedError();
    }
    assertPublishPermitted(normalized, allowRetiredFence);
}

/**
 * Call after verified owner identity while holding the provisioning Web Lock.
 * Corrupt, future-version or divergent controls are preserved and fail closed.
 * Only a genuinely absent primary is reconstructed from an authenticated
 * wrapped-key mirror, without generating a new DEK.
 */
export async function reconcileVaultControl(owner: string): Promise<void> {
    const normalized = normalizeStorageOwner(owner);
    assertNoLocalPurge(normalized);
    const primary = readVaultControl(normalized);
    const mirror = await readMirror(normalized);
    if (!primary && !mirror) return;
    if (primary && mirror) {
        if (!sameGeneration(primary, mirror)) throw new LocalVaultLockedError();
        // Crash between activation mirror and localStorage: retry the full
        // migration if primary is still migrating. No premature promotion.
        if (primary.phase === 'active' && mirror.phase === 'migrating') {
            await confirmKey(normalized, primary);
            await writeMirror(normalized, primary);
        }
        return;
    }
    const surviving = (primary ?? mirror)!;
    await confirmKey(normalized, surviving);
    if (primary) {
        await writeMirror(normalized, primary);
    } else {
        if (readBrowserValueStrict(vaultControlKey(normalized)) !== null) throw new LocalVaultLockedError();
        writeBrowserValue(vaultControlKey(normalized), JSON.stringify(surviving));
        const restored = readVaultControl(normalized);
        if (!restored || !sameGeneration(restored, surviving) || restored.phase !== surviving.phase) {
            throw new LocalVaultLockedError();
        }
    }
}
