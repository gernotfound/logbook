import { describe, expect, it, vi } from 'vitest';
import { boundary, context, response, headerValue, installSuccessfulServerFlow } from './accountDeletionFixture';
import { get } from 'idb-keyval';
import { deleteAccount, resumeAccountDeletion } from '../../../src/lib/db/db_account';
import { isAccountDeletionPending, markAccountDeletion, readAccountDeletionMarker } from '../../../src/lib/sync/accountGate';

describe('Deletion: trusted server receipts, authentication and retry', () => {
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

it('preserves local owner data when the server reports another UID as complete', async () => {
    boundary.fetch.mockImplementation(async (_input, init?: RequestInit) => init?.method === 'POST'
      ? response(202, { uid: 'a', status: 'requested' })
      : response(200, { uid: 'b', status: 'complete' }));
    await expect(deleteAccount(context)).rejects.toThrow('non coerente con l’account richiesto');
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(await get('logbook:v2:user:b')).toEqual({ original: 'other owner' });
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
    expect(boundary.reset).not.toHaveBeenCalled();
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

it.each([
    ['another owner', () => response(202, { uid: 'b', status: 'requested' })],
    ['missing status', () => response(202, { uid: 'a' })],
    ['unknown status', () => response(202, { uid: 'a', status: 'unknown' })],
    ['non-JSON success', () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['JSON null', () => new Response('null', { status: 202, headers: { 'content-type': 'application/json' } })],
    ['unexpected 204', () => new Response(null, { status: 204 })],
] as const)('does not acknowledge a deletion POST with %s', async (_caseName, makeResponse) => {
    boundary.fetch.mockResolvedValueOnce(makeResponse());

    await expect(deleteAccount(context)).rejects.toThrow('Conferma della cancellazione non verificabile');

    const marker = readAccountDeletionMarker('user:a');
    expect(marker?.receiptToken).toBeTruthy();
    expect(marker?.serverAcceptedAt).toBeUndefined();
    expect(await get('logbook:v2:user:a')).toEqual({ original: 'recoverable' });
    expect(isAccountDeletionPending('user:a')).toBe(true);
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(boundary.auth.signOut).not.toHaveBeenCalled();
    expect(boundary.reset).not.toHaveBeenCalled();
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
});
