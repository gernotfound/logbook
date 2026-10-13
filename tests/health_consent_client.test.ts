import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '../src/lib/firebase';
// Unlike the rest of the UI fixture, this suite exercises the real policy module.
vi.unmock('../src/lib/healthConsent');

vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn(async () => {}) }));
vi.mock('../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: vi.fn(async () => 'fresh-limited-use') }));

import {
  beginHealthConsentVerification, currentHealthConsentStatus,
  finishHealthConsentReacceptance, isHealthConsentWritable, isHealthConsentCloudWritable,
  getVerifiedHealthConsentRevision,
  reacceptHealthConsent, refreshHealthConsent, registerInitialHealthConsent, requireHealthConsentWritable,
  withdrawHealthConsent, retainNewerHealthConsent, reconfirmStaleHealthWithdrawal,
  withdrawGuestHealthConsent, beginGuestHealthReacceptance,
  completeGuestHealthReacceptance, getGuestHealthConsentStatus,
} from '../src/lib/healthConsent';

const user = (uid: string) => ({ uid, getIdToken: vi.fn(async () => 'id-token') }) as any;
const key = (uid: string) => `logbook:v2:user:${uid}:health-consent-withdrawal`;
const accepted = { acceptedTerms: true as const, acceptedHealthData: true as const, privacyVersion: '1.3.4', termsVersion: '1.2.1' };

beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); (auth as { currentUser: unknown }).currentUser = null; });

describe('first trusted consent registration', () => {
  it('denies cloud and offline data access before first server acceptance', async () => {
    const uid = 'unregistered-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async () => Response.json({ status: 'unregistered', revision: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('unregistered');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    expect(() => getVerifiedHealthConsentRevision(uid)).toThrow();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it('requires a deliberate POST then a fresh server GET before enabling cloud access', async () => {
    const uid = 'initial-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => init.method === 'POST'
      ? Response.json({ status: 'active', revision: 1, acceptedAt: '2026-10-13T10:00:00.000Z' })
      : Response.json(fetchMock.mock.calls.length <= 1 ? { status: 'unregistered', revision: 0 }
        : { status: 'active', revision: 1, acceptedAt: '2026-10-13T10:00:00.000Z' }));
    vi.stubGlobal('fetch', fetchMock);
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('unregistered');
    expect(await registerInitialHealthConsent(actor, accepted)).toBe('2026-10-13T10:00:00.000Z');
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'x-consent-contract': '2' });
    expect(await refreshHealthConsent(actor)).toBe('active');
    expect(getVerifiedHealthConsentRevision(uid)).toBe(1);
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);
  });

  it('rejects contradictory server states and a changed Firebase owner', async () => {
    const uid = 'invalid-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'active', revision: 0 })));
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('error');
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    await expect(registerInitialHealthConsent(actor, accepted)).rejects.toThrow();
  });
});

describe('durable health-consent client barrier', () => {
  it('suspends writes before server verification and when local intent is pending', () => {
    const uid = 'check-' + crypto.randomUUID();
    beginHealthConsentVerification(uid);
    expect(currentHealthConsentStatus(uid)).toBe('checking');
    expect(() => requireHealthConsentWritable('user:' + uid)).toThrow('Accesso fitness sospeso');
    localStorage.setItem(key(uid), 'pending:1');
    expect(currentHealthConsentStatus(uid)).toBe('pending');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('does not discard an unsent withdrawal when the server initially reports active', async () => {
    const uid = 'pending-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'pending:1');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init.method ?? 'GET');
      return Response.json(init.method === 'GET'
        ? { status: 'active', revision: 1 }
        : { status: 'withdrawn', revision: 2 });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('withdrawn');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(calls).toEqual(['GET', 'POST']);
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('recognizes a remote revocation and prevents normal writes', async () => {
    const uid = 'remote-' + crypto.randomUUID();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'withdrawn', revision: 1 })));
    expect(await refreshHealthConsent(user(uid))).toBe('withdrawn');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('keeps revocation durable across uncertain server failures', async () => {
    const uid = 'offline-' + crypto.randomUUID();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, request: RequestInit) => {
      if (request.method === 'GET') return Response.json({ status: 'active', revision: 1 });
      throw new Error('offline');
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    await expect(withdrawHealthConsent(user(uid))).rejects.toThrow('offline');
    expect(localStorage.getItem(key(uid))).toBe('pending:1');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('requires a server-confirmed explicit reacceptance before unlocking', async () => {
    const uid = 'reactivate-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'reaccepting:1');
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' })));
    expect(await reacceptHealthConsent(user(uid), accepted)).toBe('2026-10-12T00:00:00.000Z');
    expect(currentHealthConsentStatus(uid)).toBe('reaccepting');
    // An acknowledged server action alone does NOT make the old local journal
    // writable. The generation handshake is a separate durable step.
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    expect(isHealthConsentWritable('user:' + uid)).toBe(true);
    finishHealthConsentReacceptance(uid);
    expect(localStorage.getItem(key(uid))).toBeNull();
    expect(currentHealthConsentStatus(uid)).toBe('active');
  });

  it('fails closed when the persisted lifecycle marker is corrupt', () => {
    const uid = 'corrupt-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'unexpected');
    expect(currentHealthConsentStatus(uid)).toBe('error');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });
});

  // Across tabs the persisted epoch changes without mutating the original tab's
  // realm. Old in-flight callbacks must fail before touching the journal.

describe('out-of-order consent checks', () => {
  it('does not replace explicit reacceptance with an older withdrawn response', async () => {
    const uid = 'delayed-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'withdrawn');
    let resolveOld!: (response: Response) => void;
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') return Response.json({
        status: 'active', revision: 2, acceptedAt: '2026-10-12T05:00:00.000Z',
      });
      reads += 1;
      if (reads === 1) return new Promise<Response>(resolve => { resolveOld = resolve; });
      if (reads === 2) return Response.json({ status: 'withdrawn', revision: 1 });
      return Response.json({ status: 'active', revision: 2, acceptedAt: '2026-10-12T05:00:00.000Z' });
    }));
    const olderCheck = refreshHealthConsent(user(uid));
    await reacceptHealthConsent(user(uid), accepted);
    expect(localStorage.getItem(key(uid))).toBe('reaccepting:1');
    resolveOld(Response.json({ status: 'withdrawn', revision: 1 }));
    expect(await olderCheck).toBe('reaccepting');
    expect(localStorage.getItem(key(uid))).toBe('reaccepting:1');
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    finishHealthConsentReacceptance(uid);
  });
});

describe('overlapping consent verification', () => {
  it('ignores an older withdrawn response after a newer active response', async () => {
    const uid = 'overlap-' + crypto.randomUUID();
    let resolveOlder!: (response: Response) => void;
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      if (requests === 1) return new Promise<Response>(resolve => { resolveOlder = resolve; });
      return Response.json({ status: 'active', revision: 1 });
    }));
    const older = refreshHealthConsent(user(uid));
    await vi.waitFor(() => expect(requests).toBe(1));
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    resolveOlder(Response.json({ status: 'withdrawn', revision: 1 }));
    expect(await older).toBe('active');
    expect(localStorage.getItem(key(uid))).toBeNull();
    expect(isHealthConsentWritable('user:' + uid)).toBe(true);
  });

  it('preserves a newer pending revocation while keeping remote consent', async () => {
    const uid = 'retain-race-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'pending:1');
    let resolveServer!: (response: Response) => void;
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      if (requests === 1) return Response.json({ status: 'active', revision: 2 });
      return new Promise<Response>(resolve => { resolveServer = resolve; });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('stale-request');
    const retaining = retainNewerHealthConsent(user(uid));
    await vi.waitFor(() => expect(requests).toBe(2));
    localStorage.setItem(key(uid), 'pending:2');
    resolveServer(Response.json({ status: 'active', revision: 2 }));
    await expect(retaining).rejects.toThrow('revoca locale è cambiata');
    expect(localStorage.getItem(key(uid))).toBe('pending:2');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });
});

describe('stale withdrawal explicit reconfirmation', () => {
  it('does not overwrite a newer local decision when the server check was delayed', async () => {
    const uid = 'stale-reconfirm-race-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'pending:1');
    let resolveCheck!: (response: Response) => void;
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      methods.push(init.method ?? 'GET');
      if (methods.length === 1) return Response.json({ status: 'active', revision: 2 });
      return new Promise<Response>(resolve => { resolveCheck = resolve; });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('stale-request');
    const ongoing = reconfirmStaleHealthWithdrawal(user(uid));
    await vi.waitFor(() => expect(methods).toHaveLength(2));
    localStorage.setItem(key(uid), 'withdrawn');
    resolveCheck(Response.json({ status: 'active', revision: 2 }));
    await expect(ongoing).rejects.toThrow('scelta locale è cambiata');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(methods).toEqual(['GET', 'GET']);
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });
});

describe('later reacceptance on another device', () => {
  it('offers a choice when the durable withdrawn marker is older than the active server consent', async () => {
    const uid = 'remote-accept-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'withdrawn');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      status: 'active', revision: 2, acceptedAt: '2026-10-12T05:00:00.000Z',
    })));
    expect(await refreshHealthConsent(user(uid))).toBe('stale-request');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(await retainNewerHealthConsent(user(uid))).toBe('active');
    expect(localStorage.getItem(key(uid))).toBeNull();
  });
});

describe('withdrawal acknowledgement racing with a newer consent', () => {
  it('offers an explicit stale-request decision instead of trapping the device in withdrawn state', async () => {
    const uid = 'late-ack-' + crypto.randomUUID();
    let latestRevision = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        // The withdrawal committed at rev 2, but another device reaccepted
        // at rev 3 before this acknowledgement reached the browser.
        latestRevision = 3;
        return Response.json({ status: 'withdrawn', revision: 2 });
      }
      return Response.json(latestRevision === 0
        ? { status: 'active', revision: 1 }
        : { status: 'active', revision: 3, acceptedAt: '2026-10-12T05:00:00.000Z' });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    await withdrawHealthConsent(user(uid));
    expect(localStorage.getItem(key(uid))).toBe('pending:1');
    expect(currentHealthConsentStatus(uid)).toBe('stale-request');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(await retainNewerHealthConsent(user(uid))).toBe('active');
  });
});

describe('local-only guest consent lifecycle', () => {
  it('revocation is durable, immediately suspends local writes, and never calls a backend', () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    expect(getGuestHealthConsentStatus()).toBe('active');
    withdrawGuestHealthConsent();
    expect(localStorage.getItem('logbook:v2:guest:health-consent-withdrawal')).toBe('withdrawn');
    expect(getGuestHealthConsentStatus()).toBe('withdrawn');
    expect(isHealthConsentWritable('guest')).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });
  it('permits only an explicit guest reacceptance with its local persistence phase', () => {
    withdrawGuestHealthConsent();
    beginGuestHealthReacceptance();
    expect(getGuestHealthConsentStatus()).toBe('reaccepting');
    expect(isHealthConsentWritable('guest')).toBe(true);
    completeGuestHealthReacceptance(true);
    expect(localStorage.getItem('logbook:v2:guest:health-consent-withdrawal')).toBeNull();
    expect(getGuestHealthConsentStatus()).toBe('active');
  });
  it('reverts to suspended mode after a failed local persistence attempt', () => {
    withdrawGuestHealthConsent();
    beginGuestHealthReacceptance();
    completeGuestHealthReacceptance(false);
    expect(getGuestHealthConsentStatus()).toBe('withdrawn');
    expect(isHealthConsentWritable('guest')).toBe(false);
  });
});

describe('guest reconsent crash recovery', () => {
  it('can explicitly retry after a crash left the guest marker reaccepting', () => {
    localStorage.clear();
    localStorage.setItem('logbook:v2:guest:health-consent-withdrawal', 'reaccepting');
    expect(getGuestHealthConsentStatus()).toBe('reaccepting');
    beginGuestHealthReacceptance();
    completeGuestHealthReacceptance(true);
    expect(getGuestHealthConsentStatus()).toBe('active');
  });
});

describe('stale withdrawal race', () => {
  it('does not retry an outdated withdrawal after another device reaccepted', async () => {
    const uid = 'stale-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'pending:1');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init.method ?? 'GET');
      return Response.json({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('stale-request');
    expect(calls).toEqual(['GET']);
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });
});

describe('explicit acknowledgement of newer consent from another device', () => {
  it('retains the newer server acceptance without retrying a stale withdrawal', async () => {
    const uid = 'keep-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'pending:1');
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      methods.push(init.method ?? 'GET');
      return Response.json({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('stale-request');
    expect(await retainNewerHealthConsent(user(uid))).toBe('active');
    expect(isHealthConsentWritable('user:' + uid)).toBe(true);
    expect(localStorage.getItem(key(uid))).toBeNull();
    expect(methods).toEqual(['GET', 'GET']);
  });
});

describe('offline consent cache and reconnect privacy boundary', () => {
  it('keeps a previously verified local session visible during recheck while fencing cloud writes', async () => {
    const uid = 'recheck-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    let resolveRecheck!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: 'active', revision: 1 }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveRecheck = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);
      const rechecking = refreshHealthConsent(actor);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(currentHealthConsentStatus(uid)).toBe('active');
      expect(isHealthConsentWritable('user:' + uid)).toBe(true);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      resolveRecheck(Response.json({ status: 'withdrawn', revision: 1 }));
      expect(await rechecking).toBe('withdrawn');
      expect(currentHealthConsentStatus(uid)).toBe('withdrawn');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    } finally {
      online.mockRestore();
    }
  });

  it('permits local editing only after a positive server check and never grants cloud writes offline', async () => {
    const uid = 'cached-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async () => Response.json({ status: 'active', revision: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const onLine = vi.spyOn(navigator, 'onLine', 'get');
    try {
      onLine.mockReturnValue(true);
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);

      onLine.mockReturnValue(false);
      beginHealthConsentVerification(uid); // Simulate a new authenticated cold start.
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(isHealthConsentWritable('user:' + uid)).toBe(true);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(() => getVerifiedHealthConsentRevision(uid)).toThrow('Consenso non verificato');
      expect(fetchMock).toHaveBeenCalledTimes(1); // No network attempt while disconnected.

      onLine.mockReturnValue(true);
      fetchMock.mockResolvedValueOnce(Response.json({ status: 'withdrawn', revision: 1 }));
      expect(await refreshHealthConsent(actor)).toBe('withdrawn');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(localStorage.getItem(key(uid))).toBe('withdrawn');

      onLine.mockReturnValue(false);
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).not.toBe('active');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    } finally {
      onLine.mockRestore();
    }
  });

  it('never activates an unverified account or a mismatched consent generation offline', async () => {
    const uid = 'first-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async () => Response.json({ status: 'active', revision: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const onLine = vi.spyOn(navigator, 'onLine', 'get');
    try {
      onLine.mockReturnValue(false);
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('error');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();

      onLine.mockReturnValue(true);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(localStorage.getItem('logbook:v2:user:' + uid + ':health-consent-last-active')).toBe('2');

      // A newer epoch from another tab must fence the old positive cache.
      localStorage.setItem('logbook:v2:user:' + uid + ':health-consent-generation', '3');
      onLine.mockReturnValue(false);
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('error');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    } finally {
      onLine.mockRestore();
    }
  });

  it('keeps local-only access on a transport failure even when navigator incorrectly reports online', async () => {
    const uid = 'transport-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ status: 'active', revision: 1 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch')));
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(isHealthConsentWritable('user:' + uid)).toBe(true);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    } finally {
      onLine.mockRestore();
    }
  });

  it('does not treat an online server failure as proof of active consent', async () => {
    const uid = 'no-reply-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: 'active', revision: 1 }))
      .mockRejectedValueOnce(new Error('unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    const onLine = vi.spyOn(navigator, 'onLine', 'get');
    try {
      onLine.mockReturnValue(true);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(await refreshHealthConsent(actor)).toBe('error');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      onLine.mockReturnValue(false);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    } finally {
      onLine.mockRestore();
    }
  });
});
