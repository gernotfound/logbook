import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, signOut } from '../src/lib/firebase';
import { activateGuestSession } from '../src/lib/sync/session';
import { deleteAccount } from '../src/lib/db/db_account';
import { idbStore } from './setup';

vi.mock('../src/lib/appCheck', async importOriginal => ({
    ...await importOriginal<typeof import('../src/lib/appCheck')>(),
    getLimitedUseAppCheckToken: vi.fn(async () => 'limited-use-test-token'),
}));

const context = {
    purgeAllLocalUserData: vi.fn(async (_owner: string) => undefined),
    resetCache: vi.fn(),
    resetStore: vi.fn(),
    cancelPendingSyncs: vi.fn(),
};

const makeUser = (uid: string) => ({
    uid,
    getIdTokenResult: vi.fn(async () => ({
        token: 'firebase-test-id-token',
        authTime: new Date().toISOString(),
    })),
});

const mutableAuth = auth as { currentUser: typeof auth.currentUser };
let priorUser: typeof auth.currentUser;

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    priorUser = auth.currentUser;
    mutableAuth.currentUser = makeUser('pre-consent-account') as unknown as typeof auth.currentUser;
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem('logbook_guest_session_id_v1', 'guest-pre-consent-session');
    activateGuestSession('guest-pre-consent-session');
    idbStore['logbook:v2:guest'] = { sentinel: 'guest-archive-must-survive' };
});

afterEach(() => {
    mutableAuth.currentUser = priorUser;
    vi.unstubAllGlobals();
});

describe('account deletion before guest-to-account migration', () => {
    it('uses the authenticated UID and leaves guest storage intact after trusted server completion', async () => {
        const fetchMock = vi.fn(async (_url: RequestInfo | URL, options: RequestInit) =>
            Response.json(options.method === 'POST'
                ? { uid: 'pre-consent-account', status: 'requested' }
                : { uid: 'pre-consent-account', status: 'complete' },
                { status: options.method === 'POST' ? 202 : 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await deleteAccount(context);

        expect(result.status).toBe('pending');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
            authorization: 'Bearer firebase-test-id-token',
            'x-firebase-appcheck': 'limited-use-test-token',
        });
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toHaveProperty('receiptToken');
        expect(context.purgeAllLocalUserData).not.toHaveBeenCalled();
        expect(context.cancelPendingSyncs).not.toHaveBeenCalled();
        expect(idbStore['logbook:v2:guest']).toEqual({ sentinel: 'guest-archive-must-survive' });
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(localStorage.getItem('logbook:v2:user:pre-consent-account:account-deletion')).not.toBeNull();
        expect(vi.mocked(signOut)).toHaveBeenCalledTimes(1);
    });

    it('refuses a guest session revoked by another tab before touching the server', async () => {
        localStorage.setItem('logbook_guest_revoked_v1', 'remote-revocation');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(deleteAccount(context)).rejects.toThrow('Sessione non valida');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(context.purgeAllLocalUserData).not.toHaveBeenCalled();
        expect(idbStore['logbook:v2:guest']).toBeDefined();
    });

    it('rejects an authenticated UID change while preparing deletion', async () => {
        const signedIn = makeUser('pre-consent-account');
        signedIn.getIdTokenResult.mockImplementation(async () => {
            mutableAuth.currentUser = makeUser('other-account') as unknown as typeof auth.currentUser;
            return { token: 'firebase-test-id-token', authTime: new Date().toISOString() };
        });
        mutableAuth.currentUser = signedIn as unknown as typeof auth.currentUser;
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(deleteAccount(context)).rejects.toThrow('Sessione cambiata');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(context.purgeAllLocalUserData).not.toHaveBeenCalled();
    });
});
