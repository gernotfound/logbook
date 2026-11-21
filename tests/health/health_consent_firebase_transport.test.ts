import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { auth } from '../../src/lib/firebase';
import { invalidateSession } from '../../src/lib/sync/session';
import { requestFirebaseHealthConsent } from '../../src/lib/healthConsentFirebaseTransport';

vi.unmock('../../src/lib/healthConsentFirebaseTransport');
vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn(async () => {}) }));
vi.mock('../../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: vi.fn(async () => 'limited-use-token') }));

const session = () => auth as unknown as { currentUser: User | null };
const actor = (uid: string) => ({ uid, getIdToken: vi.fn(async () => 'id-token') }) as unknown as User;

beforeEach(() => { vi.unstubAllGlobals(); session().currentUser = null; });
afterEach(() => { vi.unstubAllGlobals(); session().currentUser = null; });

describe('Firebase consent HTTP adapter contract', () => {
  it('sends trusted credentials but refuses an incomplete active GET proof', async () => {
    const user = actor('transport-active');
    session().currentUser = user;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ status: 'active', revision: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestFirebaseHealthConsent(user, 'GET')).rejects.toThrow('Prova del consenso server incompleta.');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/health-consent');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      headers: { authorization: 'Bearer id-token', 'x-firebase-appcheck': 'limited-use-token' },
    });
  });

  it('never POSTs after the same UID acquires a different Auth epoch during token acquisition', async () => {
    const uid = 'transport-epoch';
    let releaseToken!: (token: string) => void;
    const user = {
      uid, getIdToken: vi.fn(() => new Promise<string>(resolve => { releaseToken = resolve; })),
    } as unknown as User;
    session().currentUser = user;
    const fetchMock = vi.fn(async () => Response.json({ status: 'active', revision: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = requestFirebaseHealthConsent(user, 'POST', { action: 'withdraw', expectedRevision: 1 });
    await vi.waitFor(() => expect(user.getIdToken).toHaveBeenCalledOnce());
    session().currentUser = actor(uid);
    invalidateSession();
    releaseToken('old-token');

    await expect(request).rejects.toThrow('Sessione cambiata.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
