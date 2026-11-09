import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, del, get, set } from 'idb-keyval';
import { BrowserStorageError } from '../../src/lib/sync/browserStorage';
import { beginLocalPurge, LocalPurgePendingError, markLocalPurgeComplete } from '../../src/lib/sync/localPurgeFence';
import { createLocalKeyVault, deviceVaultKeyId, unlockLocalKeyVault } from '../../src/lib/sync/secureArchiveKeys';
import { publishVaultControl, reconcileVaultControl, vaultControlMirrorId } from '../../src/lib/sync/secureArchiveControlRecovery';
import { LocalVaultLockedError, lockAllVaults, readVaultControl, vaultControlKey, type PersistedVaultControl } from '../../src/lib/sync/secureArchiveSession';

// Real IndexedDB runs by default; only individual failure/race tests replace a single I/O.
vi.mock('idb-keyval', async importOriginal => {
    const actual = await importOriginal<typeof import('idb-keyval')>();
    return { ...actual, get: vi.fn(actual.get), set: vi.fn(actual.set) };
});

const owner = 'user:control-recovery';
const mirror = () => vaultControlMirrorId(owner);
const primary = () => vaultControlKey(owner);
let control: PersistedVaultControl;
const persist = (value: PersistedVaultControl) =>
    localStorage.setItem(primary(), JSON.stringify(value));

beforeEach(async () => {
    vi.restoreAllMocks();
    lockAllVaults();
    localStorage.clear();
    await clear();
    const { vault, dataKey } = await createLocalKeyVault(owner);
    dataKey.fill(0);
    control = {
        format: 'thelogbook-local-vault-control', version: 2, owner,
        phase: 'active', epoch: 'a'.repeat(32), wrappedKey: vault,
    };
});
afterEach(() => {
    vi.restoreAllMocks();
    lockAllVaults();
});

describe('control mirror publication', () => {
    it('normalizes the owner without sharing another identity namespace', () => {
        expect(vaultControlMirrorId('control-recovery')).toBe(mirror());
        expect(vaultControlMirrorId('guest')).not.toBe(mirror());
        expect(vaultControlMirrorId('user:other')).not.toBe(mirror());
    });

    it('stores the authenticated same-generation control in both stores', async () => {
        await publishVaultControl('control-recovery', control);
        expect(readVaultControl(owner)).toEqual(control);
        expect(await get(mirror())).toEqual(control);
        const dek = await unlockLocalKeyVault(control.wrappedKey, owner);
        expect(dek).toHaveLength(32);
        dek.fill(0);
    });

    it('publishes migrating before active without rotating the DEK', async () => {
        const migrating = { ...control, phase: 'migrating' as const };
        await publishVaultControl(owner, migrating);
        expect(await get(mirror())).toEqual(migrating);
        await publishVaultControl(owner, control);
        expect(await get(mirror())).toEqual(control);
        expect(readVaultControl(owner)).toEqual(control);
    });

    it.each(['epoch', 'wrapped-key'] as const)('refuses a different %s while keeping both durable copies', async kind => {
        await publishVaultControl(owner, control);
        const changed = kind === 'epoch'
            ? { ...control, epoch: 'b'.repeat(32) }
            : { ...control, wrappedKey: { ...control.wrappedKey, nonce: '0'.repeat(24) } };
        await expect(publishVaultControl(owner, changed)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(readVaultControl(owner)).toEqual(control);
        expect(await get(mirror())).toEqual(control);
    });

    it.each([
        ['other owner', { owner: 'user:other' }],
        ['invalid epoch', { epoch: 'invalid' }],
        ['unexpected version', { version: 3 }],
    ] as const)('rejects %s before poisoning a pristine recovery mirror', async (_, fields) => {
        const invalid = { ...control, ...fields } as PersistedVaultControl;
        await expect(publishVaultControl(owner, invalid)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get(mirror())).toBeUndefined();
        expect(readVaultControl(owner)).toBeNull();
        await publishVaultControl(owner, control);
        expect(readVaultControl(owner)).toEqual(control);
    });

    it('keeps the verified mirror after interrupted synchronous publication', async () => {
        const original = localStorage.setItem.bind(localStorage);
        const interrupt = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            if (key === primary()) throw new Error('interrupted browser write');
            original(key, value);
        });
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(BrowserStorageError);
        interrupt.mockRestore();
        expect(await get(mirror())).toEqual(control);
        expect(readVaultControl(owner)).toBeNull();
        await reconcileVaultControl(owner);
        expect(readVaultControl(owner)).toEqual(control);
    });

    it('denies publication during a purge before changing either control', async () => {
        beginLocalPurge(owner);
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalPurgePendingError);
        expect(await get(mirror())).toBeUndefined();
        expect(readVaultControl(owner)).toBeNull();
    });

    it('requires the explicit completed-purge capability for retired fences', async () => {
        beginLocalPurge(owner);
        await expect(publishVaultControl(owner, control, true)).rejects.toBeInstanceOf(LocalVaultLockedError);
        markLocalPurgeComplete(owner);
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalPurgePendingError);
        await publishVaultControl(owner, control, true);
        expect(readVaultControl(owner)).toEqual(control);
        expect(await get(mirror())).toEqual(control);
    });

    it('fails closed when purge starts just before the primary is published', async () => {
        const original = localStorage.setItem.bind(localStorage);
        const raced = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            if (key === primary()) beginLocalPurge(owner);
            original(key, value);
        });
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalPurgePendingError);
        raced.mockRestore();
        expect(await get(mirror())).toEqual(control);
        expect(readVaultControl(owner)).toEqual(control);
    });
});

describe('control recovery after partial persistence', () => {
    it('does nothing when both controls are genuinely absent', async () => {
        await reconcileVaultControl(owner);
        expect(readVaultControl(owner)).toBeNull();
        expect(await get(mirror())).toBeUndefined();
    });

    it('restores missing synchronous metadata from an authenticated mirror', async () => {
        await set(mirror(), control);
        await reconcileVaultControl('control-recovery');
        expect(readVaultControl(owner)).toEqual(control);
        expect(await get(mirror())).toEqual(control);
    });

    it('restores a missing mirror by authenticating the primary', async () => {
        persist(control);
        await reconcileVaultControl(owner);
        expect(await get(mirror())).toEqual(control);
        expect(readVaultControl(owner)).toEqual(control);
    });

    it('does not rewrite a matching pair of active controls', async () => {
        await publishVaultControl(owner, control);
        const write = vi.spyOn(localStorage, 'setItem');
        await reconcileVaultControl(owner);
        expect(write).not.toHaveBeenCalled();
        expect(await get(mirror())).toEqual(control);
        write.mockRestore();
    });

    it('promotes only a migrating mirror when primary was already authenticated and active', async () => {
        persist(control);
        await set(mirror(), { ...control, phase: 'migrating' as const });
        await reconcileVaultControl(owner);
        expect(await get(mirror())).toEqual(control);
        expect(readVaultControl(owner)).toEqual(control);
    });

    it('preserves the migrating primary when the mirror activation preceded a crash', async () => {
        const migrating = { ...control, phase: 'migrating' as const };
        persist(migrating);
        await set(mirror(), control);
        await reconcileVaultControl(owner);
        expect(readVaultControl(owner)).toEqual(migrating);
        expect(await get(mirror())).toEqual(control);
    });

    it.each(['epoch', 'wrapped-key'] as const)('rejects mismatched %s and never silently selects a winner', async kind => {
        persist(control);
        const other = kind === 'epoch'
            ? { ...control, epoch: 'b'.repeat(32) }
            : { ...control, wrappedKey: { ...control.wrappedKey, nonce: 'f'.repeat(24) } };
        await set(mirror(), other);
        await expect(reconcileVaultControl(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(readVaultControl(owner)).toEqual(control);
        expect(await get(mirror())).toEqual(other);
    });

    it('treats malformed mirror bytes as corruption rather than absence', async () => {
        const invalid = { ...control, version: 99 };
        await set(mirror(), invalid);
        await expect(reconcileVaultControl(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(readVaultControl(owner)).toBeNull();
        expect(await get(mirror())).toEqual(invalid);
    });

    it('never overwrites a malformed primary with an otherwise valid mirror', async () => {
        await set(mirror(), control);
        localStorage.setItem(primary(), '{invalid-json');
        await expect(reconcileVaultControl(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(localStorage.getItem(primary())).toBe('{invalid-json');
        expect(await get(mirror())).toEqual(control);
    });

    it('does not restore metadata after losing the non-exportable device wrapping key', async () => {
        await set(mirror(), control);
        await del(deviceVaultKeyId(owner));
        await expect(reconcileVaultControl(owner)).rejects.toThrow();
        expect(localStorage.getItem(primary())).toBeNull();
        expect(await get(mirror())).toEqual(control);
    });

    it('rejects unauthentic primary ciphertext before recreating the mirror', async () => {
        const invalid = { ...control, wrappedKey: { ...control.wrappedKey, nonce: '1'.repeat(24) } };
        persist(invalid);
        await expect(reconcileVaultControl(owner)).rejects.toThrow();
        expect(await get(mirror())).toBeUndefined();
        expect(readVaultControl(owner)).toEqual(invalid);
    });

    it('does not replace a concurrent primary during mirror-only recovery', async () => {
        await set(mirror(), control);
        const concurrent = { ...control, epoch: 'b'.repeat(32) };
        const originalGet = localStorage.getItem.bind(localStorage);
        const originalSet = localStorage.setItem.bind(localStorage);
        let reads = 0;
        const race = vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
            if (key === primary() && ++reads === 2) originalSet(key, JSON.stringify(concurrent));
            return originalGet(key);
        });
        await expect(reconcileVaultControl(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        race.mockRestore();
        expect(readVaultControl(owner)).toEqual(concurrent);
        expect(await get(mirror())).toEqual(control);
    });

    it('refuses successful recovery if the purge fence was installed during publication', async () => {
        await set(mirror(), control);
        const original = localStorage.setItem.bind(localStorage);
        const race = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            if (key === primary()) beginLocalPurge(owner);
            original(key, value);
        });
        await expect(reconcileVaultControl(owner)).rejects.toBeInstanceOf(LocalPurgePendingError);
        race.mockRestore();
        expect(readVaultControl(owner)).toEqual(control);
        expect(await get(mirror())).toEqual(control);
    });
});


describe('mirror I/O failures and post-write verification', () => {
    it('rejects an IndexedDB read failure without replacing a missing primary', async () => {
        vi.mocked(get).mockRejectedValueOnce(new Error('IDB read failed'));
        await expect(reconcileVaultControl(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(localStorage.getItem(primary())).toBeNull();
    });

    it('rejects an IndexedDB write failure before publishing localStorage metadata', async () => {
        vi.mocked(set).mockRejectedValueOnce(new Error('IDB write failed'));
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(localStorage.getItem(primary())).toBeNull();
        expect(await get(mirror())).toBeUndefined();
    });

    it('rejects a conflicting mirror even when no localStorage control exists', async () => {
        await set(mirror(), control);
        const changed = { ...control, epoch: 'b'.repeat(32) };
        await expect(publishVaultControl(owner, changed)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get(mirror())).toEqual(control);
        expect(localStorage.getItem(primary())).toBeNull();
    });

    it('rejects an absent mirror on readback without publishing the primary', async () => {
        const nativeGet = vi.mocked(get).getMockImplementation()!;
        vi.mocked(get).mockImplementationOnce(nativeGet).mockResolvedValueOnce(undefined);
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get(mirror())).toEqual(control);
        expect(localStorage.getItem(primary())).toBeNull();
    });

    it('rejects a mirror phase mismatch on readback before publishing the primary', async () => {
        const nativeGet = vi.mocked(get).getMockImplementation()!;
        vi.mocked(get).mockImplementationOnce(nativeGet)
            .mockResolvedValueOnce({ ...control, phase: 'migrating' });
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get(mirror())).toEqual(control);
        expect(localStorage.getItem(primary())).toBeNull();
    });

    it('rejects a primary phase mismatch after the synchronous write', async () => {
        const nativeSet = localStorage.setItem.bind(localStorage);
        const replaced = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            nativeSet(key, key === primary()
                ? JSON.stringify({ ...control, phase: 'migrating' }) : value);
        });
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalVaultLockedError);
        replaced.mockRestore();
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect(await get(mirror())).toEqual(control);
    });

    it('rejects an altered primary on mirror-only restoration', async () => {
        await set(mirror(), control);
        const nativeSet = localStorage.setItem.bind(localStorage);
        const changed = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            nativeSet(key, key === primary()
                ? JSON.stringify({ ...control, phase: 'migrating' }) : value);
        });
        await expect(reconcileVaultControl(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        changed.mockRestore();
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect(await get(mirror())).toEqual(control);
    });

    it('zeroes the authenticated temporary DEK after verifying a missing mirror', async () => {
        persist(control);
        const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
        let plaintext: ArrayBuffer | undefined;
        const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
            plaintext = await decrypt(...args);
            return plaintext;
        });
        await reconcileVaultControl(owner);
        spy.mockRestore();
        expect(plaintext).toBeDefined();
        expect([...new Uint8Array(plaintext!)]).toEqual(Array(32).fill(0));
        expect(await get(mirror())).toEqual(control);
    });

    it.each(['active', 'migrating'] as const)(
        'does not decrypt unnecessarily when both controls already match as %s', async phase => {
            const matching = { ...control, phase };
            persist(matching);
            await set(mirror(), matching);
            const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
            await reconcileVaultControl(owner);
            expect(decrypt).not.toHaveBeenCalled();
            decrypt.mockRestore();
        },
    );

    it('does not write a mirror if purge begins after reading the primary', async () => {
        const nativeGet = localStorage.getItem.bind(localStorage);
        const switched = vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
            const value = nativeGet(key);
            if (key === primary()) beginLocalPurge(owner);
            return value;
        });
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalPurgePendingError);
        switched.mockRestore();
        expect(await get(mirror())).toBeUndefined();
        expect(localStorage.getItem(primary())).toBeNull();
    });

    it('does not publish the primary when purge begins after the mirror readback', async () => {
        const nativeGet = vi.mocked(get).getMockImplementation()!;
        vi.mocked(get).mockImplementationOnce(nativeGet).mockImplementationOnce(async (...args) => {
            const result = await nativeGet(...args);
            beginLocalPurge(owner);
            return result;
        });
        await expect(publishVaultControl(owner, control)).rejects.toBeInstanceOf(LocalPurgePendingError);
        expect(await get(mirror())).toEqual(control);
        expect(localStorage.getItem(primary())).toBeNull();
    });

    it('does not restore mirror-only metadata if purge starts while authenticating the key', async () => {
        await set(mirror(), control);
        const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
        const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
            const result = await decrypt(...args);
            beginLocalPurge(owner);
            return result;
        });
        await expect(reconcileVaultControl(owner)).rejects.toBeInstanceOf(LocalPurgePendingError);
        spy.mockRestore();
        expect(localStorage.getItem(primary())).toBeNull();
        expect(await get(mirror())).toEqual(control);
    });
});
