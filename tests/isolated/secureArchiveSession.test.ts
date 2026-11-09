import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { createLocalKeyVault } from '../../src/lib/sync/secureArchiveKeys';
import { BrowserStorageError } from '../../src/lib/sync/browserStorage';
import { beginLocalPurge, LocalPurgePendingError } from '../../src/lib/sync/localPurgeFence';
import {
    activateGuestSession, revokeGuestSession, GUEST_SESSION_KEY, GUEST_REVOCATION_KEY,
} from '../../src/lib/sync/session';
import {
    isVaultUnlocked, LocalVaultLockedError, lockAllVaults, lockVault, parsePersistedVaultControl,
    readVaultControl, requireUnlockedLocalKey, unlockVaultForOwner, verifyMigrationCapability,
    vaultControlKey, type PersistedVaultControl,
} from '../../src/lib/sync/secureArchiveSession';

const owner = 'user:session-boundaries';
let control: PersistedVaultControl;
let originalKey: Uint8Array;
const persist = (value: PersistedVaultControl, target = owner) =>
    localStorage.setItem(vaultControlKey(target), JSON.stringify(value));
const expectZeroed = (key: Uint8Array) => expect([...key]).toEqual(Array(32).fill(0));

async function install(target: string): Promise<{ control: PersistedVaultControl; dataKey: Uint8Array }> {
    const created = await createLocalKeyVault(target);
    const metadata: PersistedVaultControl = {
        format: 'thelogbook-local-vault-control', version: 2, owner: target,
        phase: 'active', epoch: 'a'.repeat(32), wrappedKey: created.vault,
    };
    persist(metadata, target);
    return { control: metadata, dataKey: created.dataKey };
}

async function pauseAfterDecrypt(target: string, current?: () => boolean) {
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let resume!: () => void;
    let started!: () => void;
    let plaintext!: Uint8Array;
    const released = new Promise<void>(resolve => { resume = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (algorithm, key, ciphertext) => {
        const result = await decrypt(algorithm, key, ciphertext);
        plaintext = new Uint8Array(result);
        started();
        await released;
        return result;
    });
    const pending = unlockVaultForOwner(target, current);
    await Promise.race([began, pending.then(() => {
        throw new Error('Unlock completed without reaching Web Crypto');
    })]);
    return { pending, resume, plaintext, restore: () => spy.mockRestore() };
}

beforeEach(async () => {
    vi.restoreAllMocks();
    lockAllVaults();
    localStorage.clear();
    await clear();
    const installed = await install(owner);
    control = installed.control;
    originalKey = installed.dataKey;
});
afterEach(() => {
    vi.restoreAllMocks();
    lockAllVaults();
    originalKey.fill(0);
});

describe('persisted vault control trust boundary', () => {
    it.each([undefined, null, false, 0, '', 'metadata', []])('rejects a non-record control: %s', value => {
        expect(() => parsePersistedVaultControl(owner, value)).toThrow(LocalVaultLockedError);
    });

    it.each([
        ['format', 'other-vault'], ['version', 1], ['version', 3], ['version', '2'],
        ['owner', 'user:another'], ['phase', 'ready'], ['phase', undefined],
        ['epoch', undefined], ['epoch', 123], ['epoch', ''],
        ['epoch', 'a'.repeat(31)], ['epoch', 'a'.repeat(33)], ['epoch', 'A'.repeat(32)],
        ['epoch', 'g'.repeat(32)], ['epoch', 'a'.repeat(32) + '\n'],
        ['wrappedKey', null], ['wrappedKey', {}], ['wrappedKey', { owner: 'user:another' }],
    ] as const)('rejects invalid %s = %s without modifying persisted control', (field, value) => {
        const saved = localStorage.getItem(vaultControlKey(owner));
        expect(() => parsePersistedVaultControl(owner, { ...control, [field]: value }))
            .toThrow(LocalVaultLockedError);
        expect(localStorage.getItem(vaultControlKey(owner))).toBe(saved);
    });

    it.each(['active', 'migrating'] as const)('accepts the current %s control under a normalized owner', phase => {
        const candidate = { ...control, phase };
        expect(parsePersistedVaultControl('session-boundaries', candidate)).toBe(candidate);
        persist(candidate);
        expect(readVaultControl('session-boundaries')).toEqual(candidate);
        expect(vaultControlKey('session-boundaries')).toBe(vaultControlKey(owner));
    });

    it('distinguishes absent control from corrupt JSON and unavailable storage', () => {
        localStorage.removeItem(vaultControlKey(owner));
        expect(readVaultControl(owner)).toBeNull();
        localStorage.setItem(vaultControlKey(owner), '{');
        expect(() => readVaultControl(owner)).toThrow(LocalVaultLockedError);
        expect(isVaultUnlocked(owner)).toBe(false);
        const storage = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('read unavailable'); });
        expect(() => readVaultControl(owner)).toThrow(BrowserStorageError);
        expect(isVaultUnlocked(owner)).toBe(false);
        storage.mockRestore();
        expect(localStorage.getItem(vaultControlKey(owner))).toBe('{');
    });
});

describe('resident owner and guest capabilities', () => {
    it('zeroes a locked owner key, preserves other owners, and zeroes all remaining keys on lockAll', async () => {
        const other = await install('user:other-session');
        await unlockVaultForOwner(owner);
        await unlockVaultForOwner('user:other-session');
        const first = requireUnlockedLocalKey(owner);
        const second = requireUnlockedLocalKey('user:other-session');
        expect(first).toEqual(originalKey);
        expect(second).toEqual(other.dataKey);
        expect(requireUnlockedLocalKey('session-boundaries')).toBe(first);
        lockVault('session-boundaries');
        expectZeroed(first);
        expect(isVaultUnlocked(owner)).toBe(false);
        expect(requireUnlockedLocalKey('user:other-session')).toBe(second);
        expect(second).toEqual(other.dataKey);
        lockAllVaults();
        expectZeroed(second);
        expect(isVaultUnlocked('user:other-session')).toBe(false);
        await unlockVaultForOwner(owner);
        expect(requireUnlockedLocalKey(owner)).toEqual(originalKey);
        expect(requireUnlockedLocalKey(owner)).not.toBe(first);
        other.dataKey.fill(0);
    });

    it.each(['missing', 'migrating', 'epoch', 'wrapped-key'] as const)('revokes and zeroes a resident key after %s control changes', async reason => {
        const replacement = reason === 'wrapped-key' ? await createLocalKeyVault(owner) : undefined;
        await unlockVaultForOwner(owner);
        const resident = requireUnlockedLocalKey(owner);
        if (reason === 'missing') localStorage.removeItem(vaultControlKey(owner));
        else persist({
            ...control,
            ...(reason === 'migrating' ? { phase: 'migrating' as const } : {}),
            ...(reason === 'epoch' ? { epoch: 'b'.repeat(32) } : {}),
            ...(replacement ? { wrappedKey: replacement.vault } : {}),
        });
        expect(() => requireUnlockedLocalKey(owner)).toThrow(LocalVaultLockedError);
        expectZeroed(resident);
        persist(control);
        expect(isVaultUnlocked(owner)).toBe(false);
        await unlockVaultForOwner(owner);
        expect(requireUnlockedLocalKey(owner)).toEqual(originalKey);
        replacement?.dataKey.fill(0);
    });

    it.each(['revoked', 'flag', 'missing-generation', 'storage-generation', 'realm-generation'] as const)('revokes a guest capability on %s without adopting another generation', async reason => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-original');
        activateGuestSession('guest-original');
        const guest = await install('guest');
        await unlockVaultForOwner('guest');
        const resident = requireUnlockedLocalKey('guest');
        if (reason === 'revoked') revokeGuestSession();
        if (reason === 'flag') localStorage.setItem('logbook_is_guest', 'false');
        if (reason === 'missing-generation') localStorage.removeItem(GUEST_SESSION_KEY);
        if (reason === 'storage-generation') localStorage.setItem(GUEST_SESSION_KEY, 'guest-replaced');
        if (reason === 'realm-generation') {
            localStorage.setItem(GUEST_SESSION_KEY, 'guest-replaced');
            activateGuestSession('guest-replaced');
        }
        expect(() => requireUnlockedLocalKey('guest')).toThrow(LocalVaultLockedError);
        expectZeroed(resident);
        guest.dataKey.fill(0);
    });

    it('refuses inactive guest unlock before doing Web Crypto work', async () => {
        const guest = await install('guest');
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'new-generation');
        activateGuestSession('old-generation');
        const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
        await expect(unlockVaultForOwner('guest')).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(decrypt).not.toHaveBeenCalled();
        expect(isVaultUnlocked('guest')).toBe(false);
        guest.dataKey.fill(0);
    });
});

describe('post-decrypt publication and failure cleanup', () => {
    it.each(['cancelled', 'guard-error', 'purge', 'missing', 'migrating', 'epoch', 'wrapped-key', 'storage-error'] as const)(
        'zeroes the actual unwrapped plaintext when publication fails: %s', async reason => {
            const replacement = reason === 'wrapped-key' ? await createLocalKeyVault(owner) : undefined;
            let current = true;
            const failure = new Error('readiness callback failed');
            const paused = await pauseAfterDecrypt(owner, () => {
                if (reason === 'guard-error') throw failure;
                return current;
            });
            expect(paused.plaintext).toEqual(originalKey);
            current = false;
            if (reason !== 'cancelled') current = true;
            if (reason === 'purge') beginLocalPurge(owner);
            if (reason === 'missing') localStorage.removeItem(vaultControlKey(owner));
            if (reason === 'migrating') persist({ ...control, phase: 'migrating' });
            if (reason === 'epoch') persist({ ...control, epoch: 'b'.repeat(32) });
            if (replacement) persist({ ...control, wrappedKey: replacement.vault });
            if (reason === 'storage-error') vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('read blocked'); });
            paused.resume();
            if (reason === 'guard-error') await expect(paused.pending).rejects.toBe(failure);
            else await expect(paused.pending).rejects.toBeInstanceOf(
                reason === 'purge' ? LocalPurgePendingError : reason === 'storage-error' ? BrowserStorageError : LocalVaultLockedError,
            );
            expectZeroed(paused.plaintext);
            vi.restoreAllMocks();
            expect(isVaultUnlocked(owner)).toBe(false);
            replacement?.dataKey.fill(0);
        },
    );

    it.each(['revocation', 'replacement'] as const)('zeroes a guest unwrap invalidated by %s during Web Crypto', async reason => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-before-unwrap');
        localStorage.removeItem(GUEST_REVOCATION_KEY);
        activateGuestSession('guest-before-unwrap');
        const guest = await install('guest');
        const paused = await pauseAfterDecrypt('guest');
        if (reason === 'revocation') revokeGuestSession();
        else {
            localStorage.setItem(GUEST_SESSION_KEY, 'guest-after-unwrap');
            activateGuestSession('guest-after-unwrap');
        }
        paused.resume();
        await expect(paused.pending).rejects.toBeInstanceOf(LocalVaultLockedError);
        expectZeroed(paused.plaintext);
        expect(isVaultUnlocked('guest')).toBe(false);
        guest.dataKey.fill(0);
    });

    it.each(['cancelled', 'new-control'] as const)('keeps a newer capability when an older unwrap fails: %s', async reason => {
        let current = true;
        const paused = await pauseAfterDecrypt(owner, () => current);
        paused.restore();
        let expected = originalKey;
        let replacement: Awaited<ReturnType<typeof createLocalKeyVault>> | undefined;
        if (reason === 'cancelled') current = false;
        else {
            replacement = await createLocalKeyVault(owner);
            persist({ ...control, epoch: 'b'.repeat(32), wrappedKey: replacement.vault });
            expected = replacement.dataKey;
        }
        await unlockVaultForOwner(owner);
        const newer = requireUnlockedLocalKey(owner);
        expect(newer).toEqual(expected);
        paused.resume();
        await expect(paused.pending).rejects.toBeInstanceOf(LocalVaultLockedError);
        expectZeroed(paused.plaintext);
        expect(requireUnlockedLocalKey(owner)).toBe(newer);
        expect(newer).toEqual(expected);
        replacement?.dataKey.fill(0);
    });
});

describe('migration capability is separate from ordinary access', () => {
    it('validates a migrating key without granting normal archive access', () => {
        const migrating = { ...control, phase: 'migrating' as const };
        persist(migrating);
        expect(() => verifyMigrationCapability('session-boundaries', migrating, originalKey)).not.toThrow();
        expect(isVaultUnlocked(owner)).toBe(false);
        expect(() => requireUnlockedLocalKey(owner)).toThrow(LocalVaultLockedError);
    });

    it.each(['missing', 'active', 'epoch', 'wrapped-key', 'short-key', 'long-key'] as const)('rejects an invalid migration capability: %s', async reason => {
        const migrating = { ...control, phase: 'migrating' as const };
        const replacement = reason === 'wrapped-key' ? await createLocalKeyVault(owner) : undefined;
        if (reason === 'missing') localStorage.removeItem(vaultControlKey(owner));
        else persist({
            ...migrating,
            ...(reason === 'active' ? { phase: 'active' as const } : {}),
            ...(reason === 'epoch' ? { epoch: 'b'.repeat(32) } : {}),
            ...(replacement ? { wrappedKey: replacement.vault } : {}),
        });
        const key = reason === 'short-key' ? originalKey.subarray(0, 31)
            : reason === 'long-key' ? new Uint8Array(33) : originalKey;
        expect(() => verifyMigrationCapability(owner, migrating, key)).toThrow(LocalVaultLockedError);
        replacement?.dataKey.fill(0);
    });
});
