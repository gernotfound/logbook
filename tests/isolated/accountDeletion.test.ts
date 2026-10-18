import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    auth: { currentUser: null as any, signOut: vi.fn() },
    token: vi.fn(),
    appCheck: vi.fn(),
    idle: vi.fn(),
    pending: vi.fn(),
    reset: vi.fn(),
    cancel: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => ({
    auth: boundary.auth,
    getDb: () => ({}),
    ensureAppCheck: async () => {},
    waitForPendingWrites: boundary.pending,
}));
vi.mock('../../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: boundary.appCheck }));
vi.mock('../../src/lib/sync/replicateJournal', () => ({ waitForJournalIdle: boundary.idle }));

import { deleteAccount, purgeAllLocalUserData, purgeCompletedAccountLocalData, purgeCompletedHealthDataLocal, resumeAccountDeletion } from '../../src/lib/db/db_account';
import { invalidateSession } from '../../src/lib/sync/session';
import { createLocalKeyVault, deviceVaultKeyId } from '../../src/lib/sync/secureArchiveKeys';
import { isVaultUnlocked } from '../../src/lib/sync/secureArchiveSession';
import { assertNoLocalPurge, isLocalPurgePending } from '../../src/lib/sync/localPurgeFence';
import { sealLocalText } from '../../src/lib/sync/secureArchiveCipher';
import {
    isAccountDeletionPending,
    markAccountDeletion,
    readAccountDeletionMarker,
} from '../../src/lib/sync/accountGate';

const context = { purgeAllLocalUserData: purgeCompletedAccountLocalData, resetCache: vi.fn(), cancelPendingSyncs: boundary.cancel, resetStore: boundary.reset };
let disk: Map<string, string>;

function response(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
    if (!headers) return null;
    return new Headers(headers).get(name);
}

function installSuccessfulServerFlow(onRequest?: (receiptToken: string) => void) {
    boundary.fetch.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        expect(url).toContain('/api/account-deletion');
        if (init?.method === 'POST') {
            const body = JSON.parse(String(init.body ?? '{}')) as { receiptToken?: string };
            const marker = readAccountDeletionMarker('user:a');
            expect(marker?.receiptToken).toBeTruthy();
            expect(body.receiptToken).toBe(marker?.receiptToken);
            expect(headerValue(init.headers, 'authorization')).toBe('Bearer firebase-id-token');
            expect(headerValue(init.headers, 'x-firebase-appcheck')).toBe('app-check-token');
            onRequest?.(body.receiptToken ?? '');
            return response(202, { uid: 'a', status: 'requested', attempts: 1 });
        }
        expect(init?.method).toBe('GET');
        const marker = readAccountDeletionMarker('user:a');
        expect(headerValue(init?.headers, 'x-firebase-appcheck')).toBe('app-check-token');
        expect(headerValue(init?.headers, 'x-account-deletion-uid')).toBe('a');
        expect(headerValue(init?.headers, 'x-account-deletion-receipt')).toBe(marker?.receiptToken);
        return response(200, { uid: 'a', status: 'complete', attempts: 1 });
    });
}

beforeEach(async () => {
    vi.resetAllMocks();
    await clear();
    invalidateSession();
    disk = new Map();
    vi.stubGlobal('localStorage', {
        get length() { return disk.size; },
        key: (index: number) => [...disk.keys()][index] ?? null,
        getItem: (key: string) => disk.get(key) ?? null,
        setItem: (key: string, value: string) => disk.set(key, value),
        removeItem: (key: string) => disk.delete(key),
    });
    vi.stubGlobal('fetch', boundary.fetch);
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, action: () => Promise<unknown>) => action() } });
    boundary.token.mockResolvedValue({ authTime: new Date().toISOString(), token: 'firebase-id-token' });
    boundary.appCheck.mockResolvedValue('app-check-token');
    boundary.idle.mockResolvedValue(undefined);
    boundary.pending.mockResolvedValue(undefined);
    boundary.auth.signOut.mockResolvedValue(undefined);
    boundary.auth.currentUser = { uid: 'a', getIdTokenResult: boundary.token };
    boundary.cancel.mockImplementation(invalidateSession);
    await set('logbook:v2:user:a', { original: 'recoverable' });
    await set('logbook:v2:user:b', { original: 'other owner' });
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const completeHealthProof = () => response(200, {
    status: 'complete', complete: true, localPurgeAuthorized: true,
});

it('revalidates health-erasure completion only after acquiring the owner lock', async () => {
    let unlock!: () => void;
    const locked = new Promise<void>(resolve => { unlock = resolve; });
    let lockEntered = false;
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, action: () => Promise<unknown>) => {
        await locked;
        lockEntered = true;
        return action();
    } } });
    boundary.auth.currentUser.getIdToken = vi.fn(async () => 'firebase-id-token');
    boundary.fetch.mockResolvedValueOnce(completeHealthProof())
        .mockResolvedValueOnce(response(200, {
            status: 'complete', complete: true, localPurgeAuthorized: false,
        }));

    const work = purgeCompletedHealthDataLocal('user:a');
    await vi.waitFor(() => expect(boundary.fetch).toHaveBeenCalledTimes(1));
    expect(lockEntered).toBe(false);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    unlock();

    await expect(work).rejects.toThrow('non è verificata');
    expect(boundary.fetch).toHaveBeenCalledTimes(2);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(isLocalPurgePending('user:a')).toBe(false);
});

it('preserves the original archive if the trusted recheck under lock is unavailable', async () => {
    boundary.auth.currentUser.getIdToken = vi.fn(async () => 'firebase-id-token');
    boundary.fetch.mockResolvedValueOnce(completeHealthProof())
        .mockResolvedValueOnce(response(503, { error: 'Temporaneamente non disponibile' }));

    await expect(purgeCompletedHealthDataLocal('user:a'))
        .rejects.toThrow('Non è stato possibile verificare la ricevuta');
    expect(boundary.fetch).toHaveBeenCalledTimes(2);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(isLocalPurgePending('user:a')).toBe(false);
});

it('finishes data-only erasure after two current trusted proofs, preserving another owner', async () => {
    boundary.auth.currentUser.getIdToken = vi.fn(async () => 'firebase-id-token');
    boundary.fetch.mockImplementation(async () => completeHealthProof());

    await purgeCompletedHealthDataLocal('user:a');

    expect(boundary.fetch).toHaveBeenCalledTimes(2);
    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(isLocalPurgePending('user:a')).toBe(true);
});

it('retains old account ciphertext and shared drafts if another account activates while waiting for the purge lock', async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const requested = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal('navigator', { locks: { request: async (_key: string, _opts: unknown, action: () => Promise<unknown>) => {
        entered();
        await waiting;
        return action();
    } } });
    const sharedKey = 'logbook_local_workout';
    disk.set(sharedKey, 'new-owner-workout');
    const work = purgeCompletedAccountLocalData('user:a');
    await requested;
    boundary.auth.currentUser = { uid: 'b' };
    release();
    await expect(work).rejects.toThrow('La pulizia locale resta sospesa');
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(disk.get(sharedKey)).toBe('new-owner-workout');
    expect(isLocalPurgePending('user:a')).toBe(false);
});

it('keeps an interrupted deletion fenced when a guest starts before retry', async () => {
    disk.set('logbook_is_guest', 'true');
    disk.set('logbook_local_workout', 'guest-workout');
    await expect(purgeCompletedAccountLocalData('user:a')).rejects.toThrow('La pulizia locale resta sospesa');
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(disk.get('logbook_local_workout')).toBe('guest-workout');
    expect(isLocalPurgePending('user:a')).toBe(false);
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

it('persists a recovery receipt before POST and purges only after server completion', async () => {
    installSuccessfulServerFlow();

    await expect(deleteAccount(context)).resolves.toEqual({ status: 'complete' });

    expect(boundary.fetch).toHaveBeenCalledTimes(2);
    expect(boundary.auth.signOut).toHaveBeenCalledTimes(1);
    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(isAccountDeletionPending('user:a')).toBe(false);
    expect(boundary.reset).toHaveBeenCalledTimes(1);
});

it('keeps a server-accepted receipt if the subsequent status check is unavailable', async () => {
    boundary.fetch.mockResolvedValueOnce(response(202, { uid: 'a', status: 'requested' }));
    boundary.fetch.mockResolvedValueOnce(response(503, { error: 'Stato cancellazione non disponibile.' }));

    await expect(deleteAccount(context)).rejects.toThrow('Stato cancellazione non disponibile.');

    expect(readAccountDeletionMarker('user:a')?.serverAcceptedAt).toBeTypeOf('number');
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(await get('logbook:v2:user:a')).toBeDefined();
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
});

it('checks recent authentication before App Check or any server request', async () => {
    boundary.token.mockResolvedValue({ authTime: '2020-01-01T00:00:00Z', token: 'stale-token' });

    await expect(deleteAccount(context)).rejects.toThrow('Nessun dato');

    expect(boundary.appCheck).not.toHaveBeenCalled();
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(isAccountDeletionPending('user:a')).toBe(false);
});

it('fails closed when App Check is unavailable without creating a deletion marker', async () => {
    boundary.appCheck.mockResolvedValue(null);

    await expect(deleteAccount(context)).rejects.toThrow('Verifica App Check non disponibile');

    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(isAccountDeletionPending('user:a')).toBe(false);
    expect(await get('logbook:v2:user:a')).toBeDefined();
});

it('keeps the same receipt across a lost POST acknowledgement and an idempotent retry', async () => {
    let firstReceipt = '';
    boundary.fetch.mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as { receiptToken?: string };
        firstReceipt = body.receiptToken ?? '';
        expect(readAccountDeletionMarker('user:a')?.receiptToken).toBe(firstReceipt);
        throw new Error('network-lost');
    });

    await expect(deleteAccount(context)).rejects.toThrow('network-lost');
    await Promise.resolve();

    const pending = readAccountDeletionMarker('user:a');
    expect(firstReceipt).toBeTruthy();
    expect(pending?.receiptToken).toBe(firstReceipt);
    expect(await get('logbook:v2:user:a')).toBeDefined();
    expect(boundary.auth.signOut).not.toHaveBeenCalled();

    boundary.fetch.mockReset();
    installSuccessfulServerFlow(receipt => expect(receipt).toBe(firstReceipt));

    await expect(deleteAccount(context)).resolves.toEqual({ status: 'complete' });
    expect(isAccountDeletionPending('user:a')).toBe(false);
});

it('treats a lost POST acknowledgement as pending within the interactive timeout and preserves recovery data', async () => {
    vi.useFakeTimers();
    try {
        boundary.fetch.mockImplementation(() => new Promise<Response>(() => {}));

        const operation = deleteAccount(context);
        await vi.advanceTimersByTimeAsync(0);
        expect(boundary.fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(7_500);
        const outcome = await operation;
        vi.useRealTimers();

        expect(outcome).toMatchObject({ status: 'pending' });
        expect(await get('logbook:v2:user:a')).toBeDefined();
        expect(isAccountDeletionPending('user:a')).toBe(true);
        expect(readAccountDeletionMarker('user:a')?.receiptToken).toBeTruthy();
        expect(boundary.auth.signOut).not.toHaveBeenCalled();
        expect(boundary.reset).not.toHaveBeenCalled();
    } finally {
        vi.useRealTimers();
    }
});

it('bounds auth-less recovery polling and keeps the local copy when the status request hangs', async () => {
    vi.useFakeTimers();
    try {
        boundary.auth.currentUser = null;
        const receipt = 'A'.repeat(43);
        markAccountDeletion('user:a', { receiptToken: receipt });
        boundary.fetch.mockImplementation(() => new Promise<Response>(() => {}));

        const operation = resumeAccountDeletion(context);
        await vi.advanceTimersByTimeAsync(0);
        expect(boundary.fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(7_500);
        const outcome = await operation;
        vi.useRealTimers();

        expect(outcome).toMatchObject({ status: 'pending' });
        expect(await get('logbook:v2:user:a')).toBeDefined();
        expect(isAccountDeletionPending('user:a')).toBe(true);
        expect(boundary.auth.signOut).not.toHaveBeenCalled();
        expect(boundary.reset).not.toHaveBeenCalled();
    } finally {
        vi.useRealTimers();
    }
});

it('preserves local recovery and Auth session when the durable job reports failed', async () => {
    boundary.fetch.mockImplementation(async (_input, init?: RequestInit) => {
        if (init?.method === 'POST') return response(202, { uid: 'a', status: 'requested' });
        return response(200, {
            uid: 'a',
            status: 'failed',
            retryable: false,
            error: 'Cancellazione cloud incompleta. Alcuni dati potrebbero essere già stati eliminati.',
        });
    });

    await expect(deleteAccount(context)).rejects.toThrow('Alcuni dati potrebbero essere già stati eliminati');

    expect(boundary.auth.signOut).not.toHaveBeenCalled();
    expect(await get('logbook:v2:user:a')).toBeDefined();
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(boundary.reset).not.toHaveBeenCalled();
});

it('keeps a pending server deletion recoverable without requiring Firebase Auth', async () => {
    boundary.auth.currentUser = null;
    const receipt = 'A'.repeat(43);
    markAccountDeletion('user:a', { receiptToken: receipt });
    boundary.fetch.mockImplementation(async (_input, init?: RequestInit) => {
        expect(init?.method).toBe('GET');
        expect(headerValue(init?.headers, 'x-account-deletion-uid')).toBe('a');
        expect(headerValue(init?.headers, 'x-account-deletion-receipt')).toBe(receipt);
        return response(200, { uid: 'a', status: 'deleting' });
    });

    await expect(resumeAccountDeletion(context)).resolves.toMatchObject({ status: 'pending' });

    expect(await get('logbook:v2:user:a')).toBeDefined();
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
});

it('waits for earlier writers and rejects an intervening identity change before POST', async () => {
    let release!: () => void;
    boundary.idle.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));

    const operation = deleteAccount(context);
    await vi.waitFor(() => expect(boundary.idle).toHaveBeenCalled());
    expect(boundary.fetch).not.toHaveBeenCalled();

    boundary.auth.currentUser = { uid: 'b' };
    invalidateSession();
    release();

    await expect(operation).rejects.toThrow('Sessione cambiata');
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
});

it('reports storage deletion failures during a verified account-deletion cleanup', async () => {
    disk.set('logbook:v2:user:a:workout', 'draft');
    disk.set('logbook:v2:user:a:timer_state', 'running');
    vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
        if (key.endsWith(':workout')) throw new Error('blocked');
        disk.delete(key);
    });

    await expect(purgeCompletedAccountLocalData('user:a')).rejects.toThrow('Pulizia locale incompleta');

    expect(disk.has('logbook:v2:user:a:workout')).toBe(true);
    expect(disk.has('logbook:v2:user:a:timer_state')).toBe(false);
});

it('never purges an acknowledged local copy under a cloud-integrity fence, even on force logout', async () => {
    const localRepository = await import('../../src/lib/sync/localRepository');
    vi.spyOn(localRepository, 'readLocal').mockResolvedValue({
        pending: [], cloudIntegrityFence: 'remote-missing-shard',
    } as any);
    const { logoutAndPurgeAccount } = await import('../../src/lib/db/db_account');
    const signOut = vi.fn();

    await expect(logoutAndPurgeAccount('user:a', signOut, true)).rejects.toThrow('snapshot cloud non verificato');
    expect(signOut).not.toHaveBeenCalled();
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    await expect(purgeAllLocalUserData('user:a')).rejects.toThrow('snapshot cloud non verificato');
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
});

it('blocks direct ordinary purge while preserving the pending receipt and real IndexedDB envelope', async () => {
    const receipt = 'A'.repeat(43);
    markAccountDeletion('user:a', { receiptToken: receipt, serverAcceptedAt: Date.now() });
    disk.set('logbook:v2:user:a:workout', 'draft');

    await expect(purgeAllLocalUserData('user:a')).rejects.toThrow('Cancellazione account in sospeso');
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(disk.get('logbook:v2:user:a:workout')).toBe('draft');
    expect(readAccountDeletionMarker('user:a')?.receiptToken).toBe(receipt);
});

it('preserves the previously accepted marker after a rejected retry', async () => {
    const receipt = 'B'.repeat(43);
    markAccountDeletion('user:a', { receiptToken: receipt, serverAcceptedAt: Date.now() });
    boundary.fetch.mockResolvedValueOnce(response(403, { error: 'Verifica App Check non valida.' }));

    await expect(deleteAccount(context)).rejects.toThrow('Verifica App Check non valida.');
    expect(readAccountDeletionMarker('user:a')?.receiptToken).toBe(receipt);
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
});

it('keeps a lost-ack receipt on 401 even without serverAcceptedAt', async () => {
    const receipt = 'C'.repeat(43);
    markAccountDeletion('user:a', { receiptToken: receipt });
    boundary.fetch.mockResolvedValueOnce(response(401, { error: 'Token revocato.' }));

    await expect(deleteAccount(context)).rejects.toThrow('Token revocato.');
    expect(readAccountDeletionMarker('user:a')?.receiptToken).toBe(receipt);
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(await get('logbook:v2:user:a')).toBeDefined();
});

it('bounds the App Check provider during receipt polling without starting a late fetch', async () => {
    // Use a shortened real deadline rather than fake timers: dynamic module
    // import and fake IndexedDB each have their own asynchronous scheduling.
    const nativeSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) =>
        nativeSetTimeout(handler, delay === 7_500 ? 350 : delay, ...args));
    boundary.auth.currentUser = null;
    markAccountDeletion('user:a', { receiptToken: 'D'.repeat(43) });
    let release!: (value: string) => void;
    boundary.appCheck.mockReturnValue(new Promise<string>(resolve => { release = resolve; }));

    const operation = resumeAccountDeletion(context);
    await vi.waitFor(() => expect(boundary.appCheck).toHaveBeenCalledTimes(1));
    await expect(operation).resolves.toMatchObject({ status: 'pending' });
    release('late-token');
    await Promise.resolve();
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(await get('logbook:v2:user:a')).toBeDefined();
    expect(isAccountDeletionPending('user:a')).toBe(true);
});

it('bounds receipt body parsing and does not purge on a hanging response.json', async () => {
    const nativeSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) =>
        nativeSetTimeout(handler, delay === 7_500 ? 350 : delay, ...args));
    boundary.auth.currentUser = null;
    markAccountDeletion('user:a', { receiptToken: 'E'.repeat(43) });
    const readBody = vi.fn(() => new Promise<unknown>(() => {}));
    boundary.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: readBody,
    } as unknown as Response);

    const operation = resumeAccountDeletion(context);
    await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
    await expect(operation).resolves.toMatchObject({ status: 'pending' });
    expect(await get('logbook:v2:user:a')).toBeDefined();
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
});

it('completes older owner A even when newer owner B is still deleting', async () => {
    boundary.auth.currentUser = null;
    markAccountDeletion('user:a', { receiptToken: 'A'.repeat(43) });
    disk.set('logbook:v2:user:b:account-deletion', JSON.stringify({
        uid: 'b', owner: 'user:b', startedAt: Date.now() + 1000,
        receiptToken: 'B'.repeat(43),
    }));
    boundary.fetch.mockImplementation(async (_input, init?: RequestInit) => {
        const uid = headerValue(init?.headers, 'x-account-deletion-uid');
        return response(200, { uid, status: uid === 'a' ? 'complete' : 'deleting' });
    });

    await expect(resumeAccountDeletion(context)).resolves.toMatchObject({ status: 'pending' });
    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(isAccountDeletionPending('user:a')).toBe(false);
    expect(isAccountDeletionPending('user:b')).toBe(true);
});

it('reconciles a valid owner without discarding or suppressing a corrupt marker for another owner', async () => {
    boundary.auth.currentUser = null;
    markAccountDeletion('user:a', { receiptToken: 'A'.repeat(43) });
    disk.set('logbook:v2:user:b:account-deletion', '{"startedAt":');
    boundary.fetch.mockResolvedValue(response(200, { uid: 'a', status: 'complete' }));

    await expect(resumeAccountDeletion(context)).rejects.toThrow('Marker di cancellazione account');
    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(isAccountDeletionPending('user:a')).toBe(false);
    expect(isAccountDeletionPending('user:b')).toBe(true);
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
});
