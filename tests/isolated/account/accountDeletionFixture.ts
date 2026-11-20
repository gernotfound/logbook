import 'fake-indexeddb/auto';
import { clear, set } from 'idb-keyval';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';

export const boundary = vi.hoisted(() => ({
    auth: { currentUser: null as any, signOut: vi.fn() },
    token: vi.fn(),
    appCheck: vi.fn(),
    idle: vi.fn(),
    pending: vi.fn(),
    reset: vi.fn(),
    cancel: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('../../../src/lib/firebase', () => ({
    auth: boundary.auth,
    getDb: () => ({}),
    ensureAppCheck: async () => {},
    waitForPendingWrites: boundary.pending,
}));
vi.mock('../../../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: boundary.appCheck }));
vi.mock('../../../src/lib/sync/replicateJournal', () => ({ waitForJournalIdle: boundary.idle }));

import { purgeCompletedAccountLocalData } from '../../../src/lib/db/db_account';
import { invalidateSession } from '../../../src/lib/sync/session';
import { readAccountDeletionMarker } from '../../../src/lib/sync/accountGate';

export const context = { purgeAllLocalUserData: purgeCompletedAccountLocalData, cancelPendingSyncs: boundary.cancel, resetStore: boundary.reset };
export let disk: Map<string, string>;

export function response(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

export function headerValue(headers: HeadersInit | undefined, name: string): string | null {
    if (!headers) return null;
    return new Headers(headers).get(name);
}

export function installSuccessfulServerFlow(onRequest?: (receiptToken: string) => void) {
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

beforeEach(() => authenticatedIdentitySource.install(() => boundary.auth.currentUser));
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

export const completeHealthProof = () => response(200, {
    status: 'complete', complete: true, localPurgeAuthorized: true,
});

