import { readBrowserValueStrict } from './browserStorage';
import { normalizeStorageOwner } from './owner';
import { captureSessionForOwner, isActiveGuestSession } from './session';
import {
    type LocalKeyVault, unlockLocalKeyVault, recoverLocalKeyVault,
} from './secureArchiveKeys';

type VaultPhase = 'migrating' | 'active';
export interface PersistedVaultControl {
    format: 'thelogbook-local-vault-control';
    version: 1;
    owner: string;
    phase: VaultPhase;
    epoch: string;
    wrappedKey: LocalKeyVault;
}

/** In-memory secret capability for the CURRENT tab, never persisted. */
type LocalKeyCapability = { key: Uint8Array; epoch: string; guestSessionId?: string | null };
const capabilities = new Map<string, LocalKeyCapability>();

export class LocalVaultLockedError extends Error {
    readonly code = 'local-vault-locked';
    constructor() {
        super('Archivio protetto bloccato. Sblocca il dispositivo prima di accedere ai dati locali.');
        this.name = 'LocalVaultLockedError';
    }
}

export function vaultControlKey(owner: string): string {
    return `logbook:v2:${normalizeStorageOwner(owner)}:secure-vault-control`;
}

/** A corrupt or unknown-version control must NEVER be interpreted as absent. */
export function readVaultControl(owner: string): PersistedVaultControl | null {
    const normalized = normalizeStorageOwner(owner);
    const raw = readBrowserValueStrict(vaultControlKey(normalized));
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new LocalVaultLockedError(); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LocalVaultLockedError();
    const parsed = value as Partial<PersistedVaultControl>;
    if (parsed.format !== 'thelogbook-local-vault-control' || parsed.version !== 1
        || parsed.owner !== normalized
        || (parsed.phase !== 'migrating' && parsed.phase !== 'active')
        || typeof parsed.epoch !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.epoch)
        || !parsed.wrappedKey || parsed.wrappedKey.owner !== normalized
    ) throw new LocalVaultLockedError();
    return parsed as PersistedVaultControl;
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
    const control = readVaultControl(normalized);
    const capability = capabilities.get(normalized);
    // Guest revocation is a separate durable session fence; retaining valid
    // wrapped metadata must not grant access after that generation is revoked.
    if (!control || control.phase !== 'active' || !capability || control.epoch !== capability.epoch
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

/** Only an authenticated unwrap may enter an unlocked capability. */
export async function unlockVaultWithPassphrase(owner: string, passphrase: string): Promise<void> {
    const normalized = normalizeStorageOwner(owner);
    const control = readVaultControl(normalized);
    if (!control || control.phase !== 'active') throw new LocalVaultLockedError();
    const unwrapped = await unlockLocalKeyVault(control.wrappedKey, normalized, passphrase);
    const current = readVaultControl(normalized);
    if (!current || current.epoch !== control.epoch || current.phase !== 'active') {
        unwrapped.fill(0);
        throw new LocalVaultLockedError();
    }
    lockVault(normalized);
    capabilities.set(normalized, { key: unwrapped, epoch: control.epoch,
        ...(normalized === 'guest' ? { guestSessionId: captureSessionForOwner('guest').guestSessionId } : {}),
    });
}

export async function unlockVaultWithRecoveryCode(owner: string, recoveryCode: string): Promise<void> {
    const normalized = normalizeStorageOwner(owner);
    const control = readVaultControl(normalized);
    if (!control || control.phase !== 'active') throw new LocalVaultLockedError();
    const unwrapped = await recoverLocalKeyVault(control.wrappedKey, normalized, recoveryCode);
    const current = readVaultControl(normalized);
    if (!current || current.epoch !== control.epoch || current.phase !== 'active') {
        unwrapped.fill(0);
        throw new LocalVaultLockedError();
    }
    lockVault(normalized);
    capabilities.set(normalized, { key: unwrapped, epoch: control.epoch,
        ...(normalized === 'guest' ? { guestSessionId: captureSessionForOwner('guest').guestSessionId } : {}),
    });
}

/** For provisioning/migration ONLY: it never authorizes normal app writes. */
export function verifyMigrationCapability(owner: string, expectedEpoch: string, key: Uint8Array): void {
    const control = readVaultControl(owner);
    if (!control || control.phase !== 'migrating' || control.epoch !== expectedEpoch || key.length !== 32) {
        throw new LocalVaultLockedError();
    }
}
