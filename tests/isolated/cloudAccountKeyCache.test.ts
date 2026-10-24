import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';

const authHarness = vi.hoisted(() => ({
    auth: { currentUser: { uid: 'account-a' } as { uid: string } | null },
}));
vi.mock('../../src/lib/firebase', () => ({ auth: authHarness.auth }));

import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { deviceVaultKeyId } from '../../src/lib/sync/secureArchiveKeys';
import { lockAllVaults, lockVault, unlockVaultForOwner } from '../../src/lib/sync/secureArchiveSession';
import { purgeOwnerLocalData } from '../../src/lib/db/ownerLocalPurge';
import {
    CloudAccountKeyMismatchError, cloudAccountKeyStorageId,
    readCachedAccountDataKey, rememberAccountDataKey,
} from '../../src/lib/sync/cloudAccountKeyCache';

const owner = 'user:account-a';
const freshKey = () => crypto.getRandomValues(new Uint8Array(32));

beforeEach(async () => {
    lockAllVaults();
    await clear();
    localStorage.clear();
    authHarness.auth.currentUser = { uid: 'account-a' };
    vi.stubGlobal('navigator', {
        locks: { request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback() },
    });
    await createAndMigrateVault(owner);
});

afterEach(() => {
    lockAllVaults();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('owner-scoped cloud ADK cache — device vault safety', () => {
    it('stores ciphertext only and reopens with the existing unlocked local vault offline', async () => {
        const accountKey = freshKey();
        const id = cloudAccountKeyStorageId(owner);
        await expect(readCachedAccountDataKey(owner)).resolves.toBeNull();
        await rememberAccountDataKey(owner, accountKey);
        const raw = await get<unknown>(id);
        expect(typeof raw).toBe('string');
        expect(raw).toMatch(/^tlb-sealed:v1:/);
        expect(raw).not.toContain(Array.from(accountKey).map(byte => byte.toString(16).padStart(2, '0')).join(''));
        lockVault(owner);
        await unlockVaultForOwner(owner);
        const fetchRequest = vi.fn(() => { throw new Error('unexpected network use'); });
        vi.stubGlobal('fetch', fetchRequest);
        await expect(readCachedAccountDataKey(owner)).resolves.toEqual(accountKey);
        expect(fetchRequest).not.toHaveBeenCalled();
    });

    it('rejects a different server key without replacing existing local ciphertext', async () => {
        const original = freshKey();
        await rememberAccountDataKey(owner, original);
        const before = await get<unknown>(cloudAccountKeyStorageId(owner));
        await rememberAccountDataKey(owner, original); // idempotent retry
        expect(await get<unknown>(cloudAccountKeyStorageId(owner))).toBe(before);
        await expect(rememberAccountDataKey(owner, freshKey())).rejects.toBeInstanceOf(CloudAccountKeyMismatchError);
        expect(await get<unknown>(cloudAccountKeyStorageId(owner))).toBe(before);
        await expect(readCachedAccountDataKey(owner)).resolves.toEqual(original);
    });

    it('does not treat malformed ciphertext or unsupported owner as a missing cache', async () => {
        const id = cloudAccountKeyStorageId(owner);
        await set(id, { leaked: 'not-sealed' });
        await expect(readCachedAccountDataKey(owner)).rejects.toThrow();
        await expect(rememberAccountDataKey(owner, freshKey())).rejects.toThrow();
        expect(await get(id)).toEqual({ leaked: 'not-sealed' });
        expect(() => cloudAccountKeyStorageId('guest')).toThrow(CloudAccountKeyMismatchError);
        expect(() => cloudAccountKeyStorageId('user:other/identity')).toThrow(CloudAccountKeyMismatchError);
    });

    it('rejects owner/session switch before access to the former account key', async () => {
        const accountKey = freshKey();
        await rememberAccountDataKey(owner, accountKey);
        authHarness.auth.currentUser = { uid: 'account-b' };
        await expect(readCachedAccountDataKey(owner)).rejects.toBeInstanceOf(CloudAccountKeyMismatchError);
        await expect(rememberAccountDataKey(owner, freshKey())).rejects.toBeInstanceOf(CloudAccountKeyMismatchError);
        authHarness.auth.currentUser = { uid: 'account-a' };
        await expect(readCachedAccountDataKey(owner)).resolves.toEqual(accountKey);
    });

    it('owner purge deletes cloud ADK ciphertext before dropping the device wrapping key', async () => {
        await rememberAccountDataKey(owner, freshKey());
        const id = cloudAccountKeyStorageId(owner);
        expect(await get(id)).toBeDefined();
        expect(await get(deviceVaultKeyId(owner))).toBeDefined();
        await purgeOwnerLocalData(owner);
        expect(await get(id)).toBeUndefined();
        expect(await get(deviceVaultKeyId(owner))).toBeUndefined();
    });
});
