import { describe, expect, it, vi } from 'vitest';
import { deletionMocks, context, disk, response, headerValue, installSuccessfulServerFlow } from './accountDeletionFixture';
import { get } from 'idb-keyval';
import { deleteAccount, purgeAllLocalUserData, purgeCompletedAccountLocalData, resumeAccountDeletion } from '../../../src/lib/db/db_account';
import { invalidateSession } from '../../../src/lib/sync/session';
import { isAccountDeletionPending, markAccountDeletion, readAccountDeletionMarker } from '../../../src/lib/sync/accountGate';

const boundary = deletionMocks.boundary;

describe('Deletion: final recovery, provider failure and parallel owners', () => {
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
    const localRepository = await import('../../../src/lib/sync/localRepository');
    vi.spyOn(localRepository, 'readLocal').mockResolvedValue({
        pending: [], cloudIntegrityFence: 'remote-missing-shard',
    } as any);
    const { logoutAndPurgeAccount } = await import('../../../src/lib/db/db_account');
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

it.each([400, 401, 403])('preserves the initial recovery receipt after a rejected HTTP %i POST', async status => {
    let firstReceipt = '';
    boundary.fetch.mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(init?.method).toBe('POST');
        firstReceipt = (JSON.parse(String(init?.body ?? '{}')) as { receiptToken: string }).receiptToken;
        expect(readAccountDeletionMarker('user:a')?.receiptToken).toBe(firstReceipt);
        return response(status, { error: 'Richiesta di cancellazione rifiutata.' });
    });

    await expect(deleteAccount(context)).rejects.toThrow('Richiesta di cancellazione rifiutata.');
    await Promise.resolve();

    expect(firstReceipt).toBeTruthy();
    expect(readAccountDeletionMarker('user:a')?.receiptToken).toBe(firstReceipt);
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
    expect(boundary.reset).not.toHaveBeenCalled();

    // The same receipt must remain usable for the subsequent trusted retry.
    boundary.fetch.mockReset();
    installSuccessfulServerFlow(receipt => expect(receipt).toBe(firstReceipt));
    await expect(deleteAccount(context)).resolves.toEqual({ status: 'complete' });
    expect(isAccountDeletionPending('user:a')).toBe(false);
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

it('recovers a valid owner even when a different owner receipt is unreadable, keeping the failing copy', async () => {
    boundary.auth.currentUser = null;
    const ownerA = 'user:a';
    const ownerB = 'user:b';
    markAccountDeletion(ownerA, { receiptToken: 'A'.repeat(43) });
    markAccountDeletion(ownerB, { receiptToken: 'B'.repeat(43) });
    const bKey = 'logbook:v2:' + ownerB + ':account-deletion';
    const untouchedB = disk.get(bKey);
    const storage = localStorage;
    const originalRead = storage.getItem.bind(storage);
    vi.stubGlobal('localStorage', {
        get length() { return disk.size; },
        key: (index: number) => [...disk.keys()][index] ?? null,
        getItem: (storageKey: string) => {
            if (storageKey === bKey) throw new DOMException('Read blocked', 'SecurityError');
            return originalRead(storageKey);
        },
        setItem: storage.setItem.bind(storage),
        removeItem: storage.removeItem.bind(storage),
    });
    boundary.fetch.mockResolvedValue(response(200, { uid: 'a', status: 'complete' }));

    await expect(resumeAccountDeletion(context)).rejects.toThrow('Marker di cancellazione account');
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(await get('logbook:v2:user:a')).toBeUndefined();
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(disk.has('logbook:v2:user:a:account-deletion')).toBe(false);
    expect(disk.get(bKey)).toBe(untouchedB);
});
});
