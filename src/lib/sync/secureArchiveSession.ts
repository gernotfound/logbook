import { readBrowserValueStrict } from './browserStorage';
import { assertNoLocalPurge } from './localPurgeFence';
import { normalizeStorageOwner } from './owner';
import { captureSessionForOwner, isActiveGuestSession } from './session';
import {
    type LocalKeyVault, unlockLocalKeyVault,
} from './secureArchiveKeys';

type VaultPhase = 'migrating' | 'active';
export interface PersistedVaultControl {
    format: 'thelogbook-local-vault-control';
    version: 2;
    owner: string;
    phase: VaultPhase;
    epoch: string;
    wrappedKey: LocalKeyVault;
}

/** In-memory secret capability for the CURRENT tab, never persisted. */
type LocalKeyCapability = { key: Uint8Array; epoch: string; wrappedKeyIdentity: string; guestSessionId?: string | null };
const capabilities = new Map<string, LocalKeyCapability>();

// An epoch alone cannot authenticate a changed wrapped DEK in another tab.
const wrappedKeyIdentity = (control: PersistedVaultControl): string => JSON.stringify(control.wrappedKey);

export class LocalVaultLockedError extends Error {
    readonly code = 'local-vault-locked';
    constructor() {
        super('Archivio protetto non pronto. I dati locali sono conservati per il recupero.');
        this.name = 'LocalVaultLockedError';
    }
}

export function vaultControlKey(owner: string): string {
    return `logbook:v2:${normalizeStorageOwner(owner)}:secure-vault-control`;
}

/** Strict validator shared with the independent IndexedDB control mirror. */
export function parsePersistedVaultControl(owner: string, value: unknown): PersistedVaultControl {
    const normalized = normalizeStorageOwner(owner);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LocalVaultLockedError();
    const parsed = value as Partial<PersistedVaultControl>;
    if (parsed.format !== 'thelogbook-local-vault-control' || parsed.version !== 2
        || parsed.owner !== normalized
        || (parsed.phase !== 'migrating' && parsed.phase !== 'active')
        || typeof parsed.epoch !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.epoch)
        || !parsed.wrappedKey || parsed.wrappedKey.owner !== normalized
    ) throw new LocalVaultLockedError();
    return parsed as PersistedVaultControl;
}

/** A corrupt or unknown-version control must NEVER be interpreted as absent. */
export function readVaultControl(owner: string): PersistedVaultControl | null {
    const normalized = normalizeStorageOwner(owner);
    const raw = readBrowserValueStrict(vaultControlKey(normalized));
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new LocalVaultLockedError(); }
    return parsePersistedVaultControl(normalized, value);
}

export function lockVault(owner: string): void {
    const normalized = normalizeStorageOwner(owner);
    const live = capabilities.get(normalized);
    if (live) live.key.fill(0);
    capabilities.delete(normalized);
}

export function lockAllVaults(): void {
    for (const owner of capabilities.keys()) lockVault(owner);
}

/** Read by every sensitive storage gateway, including inside IDB update(). */
export function requireUnlockedLocalKey(owner: string): Uint8Array {
    const normalized = normalizeStorageOwner(owner);
    assertNoLocalPurge(normalized);
    const control = readVaultControl(normalized);
    const capability = capabilities.get(normalized);
    // Guest revocation is a separate durable session fence; retaining valid
    // wrapped metadata must not grant access after that generation is revoked.
    if (!control || control.phase !== 'active' || !capability || control.epoch !== capability.epoch
        || wrappedKeyIdentity(control) !== capability.wrappedKeyIdentity
        || (normalized === 'guest' && (!isActiveGuestSession()
            || capability.guestSessionId !== captureSessionForOwner('guest').guestSessionId))) {
        if (capability) lockVault(normalized);
        throw new LocalVaultLockedError();
    }
    return capability.key;
}

export function isVaultUnlocked(owner: string): boolean {
    try { requireUnlockedLocalKey(owner); return true; } catch { return false; }
}

/** Automatic same-device unlock after the caller verifies current owner identity. */
export async function unlockVaultForOwner(owner: string, isCurrent: () => boolean = () => true): Promise<void> {
    const normalized = normalizeStorageOwner(owner);
    assertNoLocalPurge(normalized);
    const control = readVaultControl(normalized);
    if (!control || control.phase !== 'active') throw new LocalVaultLockedError();
    // A guest session may change while Web Crypto unwraps the DEK.
    const guestSessionId = normalized === 'guest' && isActiveGuestSession()
        ? captureSessionForOwner('guest').guestSessionId
        : null;
    if (normalized === 'guest' && !guestSessionId) throw new LocalVaultLockedError();

    const unwrapped = await unlockLocalKeyVault(control.wrappedKey, normalized);
    try {
        // A cancelled bootstrap may finish its Web Crypto work after a newer
        // session has started. Never publish that obsolete DEK to the tab.
        if (!isCurrent()) throw new LocalVaultLockedError();
        assertNoLocalPurge(normalized);
        const current = readVaultControl(normalized);
        if (!current || current.epoch !== control.epoch || current.phase !== 'active'
            || wrappedKeyIdentity(current) !== wrappedKeyIdentity(control)
            || (normalized === 'guest' && (!isActiveGuestSession()
                || captureSessionForOwner('guest').guestSessionId !== guestSessionId))) {
            throw new LocalVaultLockedError();
        }
        lockVault(normalized);
        capabilities.set(normalized, { key: unwrapped, epoch: control.epoch,
            wrappedKeyIdentity: wrappedKeyIdentity(control),
            ...(normalized === 'guest' ? { guestSessionId } : {}),
        });
    } catch (error) {
        // Never retain decrypted key material after a failed post-await check.
        unwrapped.fill(0);
        throw error;
    }
}

/** For provisioning/migration ONLY: it never authorizes normal app writes. */
export function verifyMigrationCapability(owner: string, expectedControl: PersistedVaultControl, key: Uint8Array): void {
    const control = readVaultControl(owner);
    if (!control || control.phase !== 'migrating' || control.epoch !== expectedControl.epoch
        || wrappedKeyIdentity(control) !== wrappedKeyIdentity(expectedControl) || key.length !== 32) {
        throw new LocalVaultLockedError();
    }
}
