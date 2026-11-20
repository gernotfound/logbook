import { describe, expect, it, vi } from 'vitest';
import { deletionMocks, context, disk } from './accountDeletionFixture';
import { get, set } from 'idb-keyval';
import { purgeCompletedAccountLocalData, resumeAccountDeletion } from '../../../src/lib/db/db_account';
import { createLocalKeyVault, deviceVaultKeyId } from '../../../src/lib/sync/secureArchiveKeys';
import { isVaultUnlocked } from '../../../src/lib/sync/secureArchiveSession';
import { assertNoLocalPurge, isLocalPurgePending } from '../../../src/lib/sync/localPurgeFence';
import { sealLocalText } from '../../../src/lib/sync/secureArchiveCipher';
import { markAccountDeletion, readAccountDeletionMarker } from '../../../src/lib/sync/accountGate';

const boundary = deletionMocks.boundary;

describe('Deletion: encrypted owner purge and interrupted recovery', () => {
it('does not sign out a replacement account while a stale logout preflight is pending', async () => {
    const { logoutAndPurgeAccount } = await import('../../../src/lib/db/db_account');
    const localRepository = await import('../../../src/lib/sync/localRepository');
    // This fixture stores a placeholder IndexedDB value; the logout preflight
    // is only meant to model an otherwise clean, readable journal.
    vi.spyOn(localRepository, 'readLocal').mockResolvedValue(undefined);
    let entered!: () => void;
    let release!: () => void;
    const enteredPreflight = new Promise<void>(resolve => { entered = resolve; });
    const continuePreflight = new Promise<void>(resolve => { release = resolve; });
    const verifyCurrentDrafts = vi.fn(async () => { entered(); await continuePreflight; });
    const signOut = vi.fn(async () => { boundary.auth.currentUser = null; });

    const operation = logoutAndPurgeAccount('user:a', signOut, false, verifyCurrentDrafts);
    await enteredPreflight;
    boundary.auth.currentUser = { uid: 'b' };
    release();

    await expect(operation).rejects.toThrow('La pulizia locale resta sospesa');
    expect(signOut).not.toHaveBeenCalled();
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(isLocalPurgePending('user:a')).toBe(false);
});

it('does not invoke a retired owner sign-out callback for a different current account', async () => {
    const { logoutAndPurgeAccount } = await import('../../../src/lib/db/db_account');
    await purgeCompletedAccountLocalData('user:a');
    expect(isLocalPurgePending('user:a')).toBe(true);

    boundary.auth.currentUser = { uid: 'b' };
    const signOut = vi.fn(async () => { boundary.auth.currentUser = null; });

    await expect(logoutAndPurgeAccount('user:a', signOut)).rejects.toThrow('La pulizia locale resta sospesa');
    expect(signOut).not.toHaveBeenCalled();
    expect(boundary.auth.currentUser?.uid).toBe('b');
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(isLocalPurgePending('user:a')).toBe(true);
});

it('drains owner-scoped keys discovered during a previous localStorage purge pass', async () => {
    const owner = 'user:a';
    const first = 'logbook:v2:user:a:sealed:workout';
    const late = 'logbook:v2:user:a:sealed:late-workout';
    const unrelated = 'logbook:v2:user:b:sealed:workout';
    const control = 'logbook:v2:user:a:secure-vault-control';
    disk.set(first, 'tlb-sealed:v1:original');
    disk.set(control, 'owner-a-wrapping-key');
    disk.set(unrelated, 'owner-b-ciphertext');
    const remove = localStorage.removeItem.bind(localStorage);
    let introduced = false;
    const intercepted = vi.spyOn(localStorage, 'removeItem').mockImplementation((key: string) => {
        remove(key);
        if (key === first && !introduced) {
            introduced = true;
            disk.set(late, 'tlb-sealed:v1:delayed-write');
        }
    });

    try {
        await purgeCompletedAccountLocalData(owner);
    } finally {
        intercepted.mockRestore();
    }

    expect(introduced).toBe(true);
    expect(disk.has(first)).toBe(false);
    expect(disk.has(late)).toBe(false);
    expect(disk.has(control)).toBe(false);
    expect(disk.get(unrelated)).toBe('owner-b-ciphertext');
    expect(isLocalPurgePending(owner)).toBe(true);
});

it('never destroys the device wrapping key if a changing localStorage index hides ciphertext', async () => {
    const owner = 'user:a';
    const decoy = 'logbook:unrelated-index';
    const control = 'logbook:v2:user:a:secure-vault-control';
    const ciphertext = 'logbook:v2:user:a:sealed:workout';
    const { vault, dataKey } = await createLocalKeyVault(owner);
    disk.set(decoy, 'not-owner-data');
    disk.set(ciphertext, sealLocalText(dataKey, owner, ciphertext, '{"weight":"80"}'));
    disk.set(control, JSON.stringify({
        format: 'thelogbook-local-vault-control', version: 2,
        owner, phase: 'active', epoch: 'a'.repeat(32), wrappedKey: vault,
    }));
    let concurrentShift = true;
    vi.stubGlobal('localStorage', {
        get length() {
            // Simulate another realm inserting a non-owner key before each
            // enumeration. Removing it at index 0 shifts the ciphertext to
            // the already-visited position without deleting the ciphertext.
            if (concurrentShift && !disk.has(decoy)) disk = new Map([[decoy, 'not-owner-data'], ...disk]);
            return disk.size;
        },
        key: (index: number) => {
            const observed = [...disk.keys()][index] ?? null;
            if (concurrentShift && index === 0 && observed === decoy) disk.delete(decoy);
            return observed;
        },
        getItem: (key: string) => disk.get(key) ?? null,
        setItem: (key: string, value: string) => disk.set(key, value),
        removeItem: (key: string) => disk.delete(key),
    });

    await expect(purgeCompletedAccountLocalData(owner)).rejects.toThrow('Pulizia locale incompleta');
    expect(disk.get(ciphertext)).toContain('tlb-sealed:');
    expect(disk.has(control)).toBe(true);
    expect(await get(deviceVaultKeyId(owner))).toBeDefined();
    expect(isLocalPurgePending(owner)).toBe(true);

    // When the competing tab stops mutating keys, the same fenced purge can
    // finish; a failed inventory must not require destroying the ciphertext.
    concurrentShift = false;
    await purgeCompletedAccountLocalData(owner);
    expect(disk.has(ciphertext)).toBe(false);
    expect(disk.has(control)).toBe(false);
    expect(await get(deviceVaultKeyId(owner))).toBeUndefined();
});

it('keeps the encryption control and purge fence when new storage keys keep reappearing', async () => {
    const owner = 'user:a';
    const rotating = 'logbook:v2:user:a:sealed:reappearing';
    const control = 'logbook:v2:user:a:secure-vault-control';
    disk.set(rotating, 'tlb-sealed:v1:recoverable');
    disk.set(control, 'wrapped-key-must-survive');
    const remove = localStorage.removeItem.bind(localStorage);
    const intercepted = vi.spyOn(localStorage, 'removeItem').mockImplementation((key: string) => {
        remove(key);
        if (key === rotating) disk.set(rotating, 'tlb-sealed:v1:recoverable');
    });

    try {
        await expect(purgeCompletedAccountLocalData(owner)).rejects.toThrow('Pulizia locale incompleta');
        expect(disk.get(control)).toBe('wrapped-key-must-survive');
        expect(disk.has(rotating)).toBe(true);
        expect(isLocalPurgePending(owner)).toBe(true);
    } finally {
        intercepted.mockRestore();
    }

    await purgeCompletedAccountLocalData(owner);
    expect(disk.has(rotating)).toBe(false);
    expect(disk.has(control)).toBe(false);
});

it('retains the wrapped data-encryption key when a sealed local snapshot cannot be purged', async () => {
    const control = 'logbook:v2:user:a:secure-vault-control';
    const sealedWorkout = 'logbook:v2:user:a:sealed:workout';
    disk.set(control, '{"wrappedKey":"recoverable-when-storage-fails"}');
    disk.set(sealedWorkout, 'tlb-sealed:v1:original-sealed-workout');
    const originalRemove = localStorage.removeItem.bind(localStorage);
    const failDeviceRemoval = vi.spyOn(localStorage, 'removeItem').mockImplementation((key: string) => {
        if (key === sealedWorkout) throw new Error('Quota or device removal denied');
        originalRemove(key);
    });

    await expect(purgeCompletedAccountLocalData('user:a')).rejects.toThrow('Pulizia locale incompleta');
    expect(disk.get(control)).toContain('recoverable-when-storage-fails');
    expect(disk.get(sealedWorkout)).toBe('tlb-sealed:v1:original-sealed-workout');
    failDeviceRemoval.mockRestore();

    await purgeCompletedAccountLocalData('user:a');
    expect(disk.has(sealedWorkout)).toBe(false);
    expect(disk.has(control)).toBe(false);
});

it('keeps an interrupted purge fenced until the remaining ciphertext has been removed', async () => {
    const owner = 'user:a';
    const { vault } = await createLocalKeyVault(owner);
    disk.set('logbook:v2:user:a:secure-vault-control', JSON.stringify({
        format: 'thelogbook-local-vault-control', version: 2,
        owner, phase: 'active', epoch: 'a'.repeat(32), wrappedKey: vault,
    }));
    const protectedKey = 'logbook:v2:user:a:sealed:workout';
    disk.set(protectedKey, 'tlb-sealed:v1:protected');
    const originalRemove = localStorage.removeItem.bind(localStorage);
    const failing = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
        if (key === protectedKey) throw new Error('device denied');
        originalRemove(key);
    });
    await expect(purgeCompletedAccountLocalData(owner)).rejects.toThrow('Pulizia locale incompleta');
    expect(isLocalPurgePending(owner)).toBe(true);
    expect(() => assertNoLocalPurge(owner)).toThrow('Pulizia archivio locale');
    expect(await get(deviceVaultKeyId(owner))).toBeDefined();
    failing.mockRestore();
    await purgeCompletedAccountLocalData(owner);
    expect(await get(deviceVaultKeyId(owner))).toBeUndefined();
    expect(isLocalPurgePending(owner)).toBe(true);
});

it('purges server-confirmed deleted account ciphertext without unlocking its protected DEK', async () => {
    const owner = 'user:a';
    const { vault, dataKey } = await createLocalKeyVault(owner);
    const control = 'logbook:v2:user:a:secure-vault-control';
    const workout = 'logbook:v2:user:a:sealed:workout';
    disk.set(control, JSON.stringify({
        format: 'thelogbook-local-vault-control', version: 2,
        owner, phase: 'active', epoch: 'a'.repeat(32), wrappedKey: vault,
    }));
    disk.set(workout, sealLocalText(dataKey, owner, workout, '{"heartRate":145}'));
    await set('logbook:v2:user:a', sealLocalText(dataKey, owner, 'logbook:v2:user:a', '{"pending":[1]}'));
    expect(isVaultUnlocked(owner)).toBe(false);

    // A server-complete deletion must not require any password/recovery code.
    await purgeCompletedAccountLocalData(owner);
    expect(disk.has(control)).toBe(false);
    expect(disk.has(workout)).toBe(false);
    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(await get(deviceVaultKeyId(owner))).toBeUndefined();
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
});

it.each([
    { status: 503, json: 'null', error: 'Impossibile verificare lo stato' },
    { status: 200, json: 'null', error: 'Stato della cancellazione non coerente' },
    { status: 200, json: '[]', error: 'Stato della cancellazione non coerente' },
    { status: 200, json: '"complete"', error: 'Stato della cancellazione non coerente' },
    { status: 200, json: '{"uid":"a","status":"unexpected"}', error: 'Stato della cancellazione non coerente' },
])('preserves receipt and archive when deletion GET returns invalid JSON ($status: $json)', async ({ status, json, error }) => {
    const marker = markAccountDeletion('user:a', { receiptToken: 'durable-client-receipt' });
    boundary.fetch.mockResolvedValueOnce(new Response(json, {
        status, headers: { 'content-type': 'application/json' },
    }));
    await expect(resumeAccountDeletion(context)).rejects.toThrow(error);
    expect(readAccountDeletionMarker('user:a')?.receiptToken).toBe(marker.receiptToken);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
    expect(boundary.reset).not.toHaveBeenCalled();
});
});
