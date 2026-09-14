import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    getIdTokenResult: vi.fn(),
    signOut: vi.fn(),
    ensureAppCheck: vi.fn(),
    waitForPendingWrites: vi.fn(),
    waitForJournalIdle: vi.fn(),
    getAppCheckToken: vi.fn(),
    cancelPendingSyncs: vi.fn(),
    resetStore: vi.fn(),
}));

vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: {
            uid: 'test-user-id',
            getIdTokenResult: boundary.getIdTokenResult,
        },
        signOut: boundary.signOut,
    },
    getDb: vi.fn(() => ({})),
    ensureAppCheck: boundary.ensureAppCheck,
    waitForPendingWrites: boundary.waitForPendingWrites,
}));

vi.mock('../src/lib/appCheck', () => ({
    getAppCheckToken: boundary.getAppCheckToken,
}));

vi.mock('../src/lib/sync/replicateJournal', () => ({
    waitForJournalIdle: boundary.waitForJournalIdle,
}));

vi.mock('../src/lib/sync/session', () => ({
    storageOwner: () => 'user:test-user-id',
    captureSession: () => ({ owner: 'user:test-user-id', epoch: 1 }),
    isCurrentSession: (session: { owner: string }) => session.owner === 'user:test-user-id',
}));

vi.mock('../src/store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({
            cancelPendingSyncs: boundary.cancelPendingSyncs,
            resetStore: boundary.resetStore,
        }),
    },
}));

import { auth } from '../src/lib/firebase';
import { deleteAccount } from '../src/lib/db/db_account';
import { isAccountDeletionPending, readAccountDeletionMarker } from '../src/lib/sync/accountGate';

function response(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function context() {
    return {
        purgeAllLocalUserData: vi.fn().mockResolvedValue(undefined),
        resetCache: vi.fn(),
    };
}

describe('M7 client boundary: durable server-coordinated account deletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        boundary.getIdTokenResult.mockResolvedValue({
            authTime: new Date().toISOString(),
            token: 'firebase-id-token',
        });
        boundary.signOut.mockResolvedValue(undefined);
        boundary.ensureAppCheck.mockResolvedValue(undefined);
        boundary.waitForPendingWrites.mockResolvedValue(undefined);
        boundary.waitForJournalIdle.mockResolvedValue(undefined);
        boundary.getAppCheckToken.mockResolvedValue('app-check-token');
        auth.currentUser = {
            uid: 'test-user-id',
            getIdTokenResult: boundary.getIdTokenResult,
        } as typeof auth.currentUser;
        vi.stubGlobal('fetch', vi.fn());
    });

    it('sends recent Firebase Auth + App Check, stores receipt before the request, and purges only after server complete', async () => {
        const fetchMock = vi.mocked(fetch);
        let markerSeenDuringRequest = false;
        fetchMock.mockImplementationOnce(async (_input, init) => {
            markerSeenDuringRequest = isAccountDeletionPending('user:test-user-id');
            expect(init?.headers).toMatchObject({
                authorization: 'Bearer firebase-id-token',
                'x-firebase-appcheck': 'app-check-token',
            });
            const body = JSON.parse(String(init?.body)) as { receiptToken: string };
            expect(body.receiptToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect(readAccountDeletionMarker('user:test-user-id')?.receiptToken).toBe(body.receiptToken);
            return response(202, { accepted: true, status: 'requested' });
        });
        fetchMock.mockResolvedValueOnce(response(200, { uid: 'test-user-id', status: 'complete', attempts: 1 }));

        const ctx = context();
        await expect(deleteAccount(ctx)).resolves.toEqual({ status: 'complete' });

        expect(markerSeenDuringRequest).toBe(true);
        expect(boundary.cancelPendingSyncs).toHaveBeenCalledTimes(1);
        expect(boundary.signOut).toHaveBeenCalledTimes(1);
        expect(ctx.purgeAllLocalUserData).toHaveBeenCalledWith('user:test-user-id');
        expect(ctx.resetCache).toHaveBeenCalledTimes(1);
        expect(boundary.resetStore).toHaveBeenCalledTimes(1);
        expect(isAccountDeletionPending('user:test-user-id')).toBe(false);
    });

    it('retains the receipt after a lost acknowledgement so a reload can recover the server job', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network lost after request'));
        const ctx = context();

        await expect(deleteAccount(ctx)).rejects.toThrow(/network lost after request/);

        const marker = readAccountDeletionMarker('user:test-user-id');
        expect(marker?.receiptToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(boundary.cancelPendingSyncs).toHaveBeenCalledTimes(1);
        expect(ctx.purgeAllLocalUserData).not.toHaveBeenCalled();
        expect(boundary.signOut).not.toHaveBeenCalled();
    });

    it('clears a pre-request marker on definitive authentication/App Check rejection', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(response(401, { error: 'Sessione non valida.' }));
        const ctx = context();

        await expect(deleteAccount(ctx)).rejects.toThrow('Sessione non valida.');
        expect(isAccountDeletionPending('user:test-user-id')).toBe(false);
        expect(ctx.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('fails closed with the mandatory partial-cloud warning when the durable job reports failed', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(response(202, { accepted: true, status: 'requested' }));
        fetchMock.mockResolvedValueOnce(response(200, {
            uid: 'test-user-id',
            status: 'failed',
            attempts: 2,
            error: 'Cancellazione cloud incompleta. Alcuni dati potrebbero essere già stati eliminati; riprova dalle impostazioni.',
        }));
        const ctx = context();

        await expect(deleteAccount(ctx)).rejects.toThrow(/Alcuni dati potrebbero essere già stati eliminati/);
        expect(isAccountDeletionPending('user:test-user-id')).toBe(true);
        expect(ctx.purgeAllLocalUserData).not.toHaveBeenCalled();
        expect(boundary.signOut).not.toHaveBeenCalled();
    });

    it('rejects stale authentication before creating a deletion marker or calling the backend', async () => {
        boundary.getIdTokenResult.mockResolvedValue({
            authTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            token: 'stale-token',
        });
        const ctx = context();

        await expect(deleteAccount(ctx)).rejects.toThrow('Per eliminare l’account devi effettuare di nuovo il login. Nessun dato è stato cancellato.');
        expect(fetch).not.toHaveBeenCalled();
        expect(isAccountDeletionPending('user:test-user-id')).toBe(false);
        expect(boundary.cancelPendingSyncs).not.toHaveBeenCalled();
    });

    it('requires App Check before freezing writers or creating the durable receipt marker', async () => {
        boundary.getAppCheckToken.mockResolvedValue(null);
        const ctx = context();

        await expect(deleteAccount(ctx)).rejects.toThrow('Verifica App Check non disponibile. Cancellazione non avviata.');
        expect(fetch).not.toHaveBeenCalled();
        expect(isAccountDeletionPending('user:test-user-id')).toBe(false);
        expect(boundary.cancelPendingSyncs).not.toHaveBeenCalled();
    });
});
