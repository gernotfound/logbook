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

import { deleteAccount, purgeAllLocalUserData, purgeCompletedAccountLocalData, resumeAccountDeletion } from '../../src/lib/db/db_account';
import { invalidateSession } from '../../src/lib/sync/session';
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

afterEach(() => { vi.unstubAllGlobals(); });

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

it('reports storage deletion failures while continuing cleanup of other keys', async () => {
    disk.set('logbook:v2:user:a:workout', 'draft');
    disk.set('logbook:v2:user:a:timer_state', 'running');
    vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
        if (key.endsWith(':workout')) throw new Error('blocked');
        disk.delete(key);
    });

    await expect(purgeAllLocalUserData('user:a')).rejects.toThrow('Pulizia locale incompleta');

    expect(disk.has('logbook:v2:user:a:workout')).toBe(true);
    expect(disk.has('logbook:v2:user:a:timer_state')).toBe(false);
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
    vi.useFakeTimers();
    try {
        boundary.auth.currentUser = null;
        markAccountDeletion('user:a', { receiptToken: 'D'.repeat(43) });
        let release!: (value: string) => void;
        boundary.appCheck.mockReturnValue(new Promise<string>(resolve => { release = resolve; }));

        const operation = resumeAccountDeletion(context);
        // The dynamic App Check module import must complete before starting
        // the fake-clock countdown; otherwise the test advances too early.
        await vi.waitFor(() => expect(boundary.appCheck).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(7_500);
        await expect(operation).resolves.toMatchObject({ status: 'pending' });
        release('late-token');
        await Promise.resolve();
        expect(boundary.fetch).not.toHaveBeenCalled();
        expect(await get('logbook:v2:user:a')).toBeDefined();
        expect(isAccountDeletionPending('user:a')).toBe(true);
    } finally {
        vi.useRealTimers();
    }
});

it('bounds receipt body parsing and does not purge on a hanging response.json', async () => {
    vi.useFakeTimers();
    try {
        boundary.auth.currentUser = null;
        markAccountDeletion('user:a', { receiptToken: 'E'.repeat(43) });
        const readBody = vi.fn(() => new Promise<unknown>(() => {}));
        boundary.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: readBody,
        } as Response);

        const operation = resumeAccountDeletion(context);
        await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(7_500);
        await expect(operation).resolves.toMatchObject({ status: 'pending' });
        expect(await get('logbook:v2:user:a')).toBeDefined();
        expect(isAccountDeletionPending('user:a')).toBe(true);
        expect(boundary.auth.signOut).not.toHaveBeenCalled();
    } finally {
        vi.useRealTimers();
    }
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
