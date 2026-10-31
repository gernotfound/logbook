import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import { auth } from '../src/lib/firebase';
import { getLimitedUseAppCheckToken } from '../src/lib/appCheck';
import { UserDataSchema } from '../src/lib/schema';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { invalidateSession } from '../src/lib/sync/session';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../src/lib/sync/secureArchiveSession';
// Unlike the rest of the UI fixture, this suite exercises the real policy module.
vi.unmock('../src/lib/healthConsent');

vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn(async () => {}) }));
vi.mock('../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: vi.fn(async () => 'fresh-limited-use') }));

import {
  beginHealthConsentVerification, currentHealthConsentStatus,
  finishHealthConsentReacceptance, isHealthConsentWritable, isHealthConsentCloudWritable, getServerConfirmedLegalConsent,
  getVerifiedHealthConsentRevision,
  reacceptHealthConsent, reacceptHealthConsentLocally, isHealthConsentLocalOnly, refreshHealthConsent, registerInitialHealthConsent, requireHealthConsentWritable,
  withdrawHealthConsent, retainNewerHealthConsent, reconfirmStaleHealthWithdrawal,
  withdrawGuestHealthConsent, beginGuestHealthReacceptance,
  completeGuestHealthReacceptance, getGuestHealthConsentStatus,
} from '../src/lib/healthConsent';

const user = (uid: string) => ({ uid, getIdToken: vi.fn(async () => 'id-token') }) as any;
const key = (uid: string) => `logbook:v2:user:${uid}:health-consent-withdrawal`;
const accepted = { acceptedTerms: true as const, acceptedHealthData: true as const, privacyVersion: '1.3.4', termsVersion: '1.2.1' };
// A trusted GET has complete acceptance evidence. Keep the fixture realistic
// rather than silently teaching the client that active/revision alone is proof.
const trustedConsentResponse = (payload: Record<string, unknown>, init?: ResponseInit): Response => {
  if (payload.status !== 'active' || typeof payload.revision !== 'number' || payload.revision < 1) {
    return Response.json(payload, init);
  }
  return Response.json({
    acceptedAt: '2026-10-13T10:00:00.000Z',
    privacyVersion: accepted.privacyVersion,
    termsVersion: accepted.termsVersion,
    ...payload,
  }, init);
};

beforeEach(() => { lockAllVaults(); localStorage.clear(); vi.unstubAllGlobals(); (auth as { currentUser: unknown }).currentUser = null; });
afterEach(() => lockAllVaults());

describe('bounded cold-start consent verification', () => {
  it('fails closed after a stalled token and permits a fresh retry', async () => {
    const uid = 'consent-stalled-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const limitedUse = vi.mocked(getLimitedUseAppCheckToken);
    limitedUse.mockImplementationOnce(() => new Promise<string>(() => {}));
    beginHealthConsentVerification(uid);
    vi.useFakeTimers();
    try {
      const check = refreshHealthConsent(actor);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await check).toBe('error');
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      limitedUse.mockResolvedValue('fresh-limited-use');
    }
    expect(localStorage.getItem(key(uid))).toBeNull();
    expect(await refreshHealthConsent(actor)).toBe('active');
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);
  });
});

describe('first trusted consent registration', () => {
  it('denies cloud and offline data access before first server acceptance', async () => {
    const uid = 'unregistered-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async () => trustedConsentResponse({ status: 'unregistered', revision: 0 }));
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
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => init.method === 'POST'
      ? trustedConsentResponse({ status: 'active', revision: 1, acceptedAt: '2026-10-13T10:00:00.000Z' })
      : trustedConsentResponse(fetchMock.mock.calls.length <= 1 ? { status: 'unregistered', revision: 0 }
        : { status: 'active', revision: 1, acceptedAt: '2026-10-13T10:00:00.000Z',
          privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion }));
    vi.stubGlobal('fetch', fetchMock);
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('unregistered');
    expect(await registerInitialHealthConsent(actor, accepted)).toBe('2026-10-13T10:00:00.000Z');
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer id-token' });
    expect(await refreshHealthConsent(actor)).toBe('active');
    expect(getVerifiedHealthConsentRevision(uid)).toBe(1);
    expect(getServerConfirmedLegalConsent(uid)).toMatchObject({ hasAcceptedTerms: true,
      hasAcceptedHealthData: true, acceptedAt: '2026-10-13T10:00:00.000Z',
      privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion });
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);
  });

  it('rejects contradictory server states and a changed Firebase owner', async () => {
    const uid = 'invalid-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 0 })));
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('error');
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    await expect(registerInitialHealthConsent(actor, accepted)).rejects.toThrow();
  });
});

describe('incomplete active trusted proof is never usable', () => {
  it('refuses apparently active HTTP 200 missing acceptance metadata, without publishing a cloud epoch', async () => {
    const uid = 'incomplete-proof-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'active', revision: 1 })));
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('error');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    expect(getServerConfirmedLegalConsent(uid)).toBeNull();
  });
});

describe('same-UID consent check session fencing', () => {
  it('never publishes the old session approval after reauthentication with the same UID', async () => {
    const uid = 'consent-aba-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    beginHealthConsentVerification(uid);
    let resolveGet!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { resolveGet = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const previous = refreshHealthConsent(actor);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    invalidateSession();
    (auth as { currentUser: unknown }).currentUser = user(uid);
    resolveGet(trustedConsentResponse({ status: 'active', revision: 1,
      acceptedAt: '2026-10-20T10:00:00.000Z',
      privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion }));
    await previous;

    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    expect(getServerConfirmedLegalConsent(uid)).toBeNull();
    expect(localStorage.getItem('logbook:v2:user:' + uid + ':health-consent-generation')).toBeNull();
  });

  it('does not submit a stale initial-consent POST after same-UID reauthentication during token acquisition', async () => {
    const uid = 'consent-aba-post-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async () => trustedConsentResponse({ status: 'unregistered', revision: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('unregistered');
    let releaseToken!: (token: string) => void;
    actor.getIdToken = vi.fn(() => new Promise<string>(resolve => { releaseToken = resolve; }));
    const post = registerInitialHealthConsent(actor, accepted);
    await vi.waitFor(() => expect(actor.getIdToken).toHaveBeenCalledOnce());

    invalidateSession();
    (auth as { currentUser: unknown }).currentUser = user(uid);
    releaseToken('stale-id-token');

    await expect(post).rejects.toThrow('Sessione cambiata');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('erased acknowledged local consent generation', () => {
  it('fences an ACKed erased archive after remote reacceptance and on repeated checks', async () => {
    const uid = 'erased-' + crypto.randomUUID();
    const owner = 'user:' + uid;
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    await createAndMigrateVault(owner);
    await initializeLocal(owner, UserDataSchema.parse({ profile: { height: '180' } }) as any);
    expect(await get('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
    const original = await readLocal(owner);
    expect(original?.pending).toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({
      status: 'active', revision: 4, erasedBeforeRevision: 2,
      acceptedAt: '2026-10-12T05:00:00.000Z',
      privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion,
    })));
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('erasure-required');
    expect(currentHealthConsentStatus(uid)).toBe('erasure-required');
    expect(isHealthConsentWritable(owner)).toBe(false);
    expect(isHealthConsentCloudWritable(owner)).toBe(false);
    expect(await readLocal(owner)).toEqual(original);
    expect(localStorage.getItem('logbook:v2:' + owner + ':health-consent-generation')).toBe('4');

    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('erasure-required');
    expect(await readLocal(owner)).toEqual(original);
  });

  it('does not let an explicit KEEP silently reauthorize a clean erased local copy', async () => {
    const uid = 'erased-keep-' + crypto.randomUUID();
    const owner = 'user:' + uid;
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    await createAndMigrateVault(owner);
    await initializeLocal(owner, UserDataSchema.parse({ profile: { height: '180' } }) as any);
    expect(await get('logbook:v2:' + owner)).toMatch(/^tlb-sealed:v1:/);
    const original = await readLocal(owner);
    localStorage.setItem(key(uid), 'withdrawn');
    vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({
      status: 'active', revision: 4, erasedBeforeRevision: 2,
      acceptedAt: '2026-10-12T05:00:00.000Z',
    })));
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('stale-request');
    expect(await retainNewerHealthConsent(actor)).toBe('erasure-required');
    expect(isHealthConsentWritable(owner)).toBe(false);
    expect(await readLocal(owner)).toEqual(original);
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
      return trustedConsentResponse(init.method === 'GET'
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
    vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({ status: 'withdrawn', revision: 1 })));
    expect(await refreshHealthConsent(user(uid))).toBe('withdrawn');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('keeps revocation durable across uncertain server failures', async () => {
    const uid = 'offline-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    await initializeLocal('user:' + uid, UserDataSchema.parse({ profile: { height: '180' } }) as any);
    expect(await get('logbook:v2:user:' + uid)).toMatch(/^tlb-sealed:v1:/);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, request: RequestInit) => {
      if (request.method === 'GET') return trustedConsentResponse({ status: 'active', revision: 1 });
      throw new Error('offline');
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    await expect(withdrawHealthConsent(user(uid))).rejects.toThrow('offline');
    expect(localStorage.getItem(key(uid))).toBe('pending:1');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect((await readLocal('user:' + uid))?.consentRevision).toBe(1);
    expect(await get('logbook:v2:user:' + uid)).toMatch(/^tlb-sealed:v1:/);
  });

  it('requires a server-confirmed explicit reacceptance before unlocking', async () => {
    const uid = 'reactivate-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    localStorage.setItem(key(uid), 'reaccepting:1');
    vi.stubGlobal('fetch', vi.fn(async () =>
      trustedConsentResponse({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' })));
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
    await createAndMigrateVault('user:' + uid);
    localStorage.setItem(key(uid), 'withdrawn');
    let resolveOld!: (response: Response) => void;
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') return trustedConsentResponse({
        status: 'active', revision: 2, acceptedAt: '2026-10-12T05:00:00.000Z',
      });
      reads += 1;
      if (reads === 1) return new Promise<Response>(resolve => { resolveOld = resolve; });
      if (reads === 2) return trustedConsentResponse({ status: 'withdrawn', revision: 1 });
      return trustedConsentResponse({ status: 'active', revision: 2, acceptedAt: '2026-10-12T05:00:00.000Z' });
    }));
    const olderCheck = refreshHealthConsent(user(uid));
    await reacceptHealthConsent(user(uid), accepted);
    expect(localStorage.getItem(key(uid))).toBe('reaccepting:1');
    resolveOld(trustedConsentResponse({ status: 'withdrawn', revision: 1 }));
    expect(await olderCheck).toBe('reaccepting');
    expect(localStorage.getItem(key(uid))).toBe('reaccepting:1');
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    finishHealthConsentReacceptance(uid);
  });
});

describe('overlapping consent verification', () => {
  it('ignores an older withdrawn response after a newer active response', async () => {
    const uid = 'overlap-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    let resolveOlder!: (response: Response) => void;
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      if (requests === 1) return new Promise<Response>(resolve => { resolveOlder = resolve; });
      return trustedConsentResponse({ status: 'active', revision: 1 });
    }));
    const older = refreshHealthConsent(user(uid));
    await vi.waitFor(() => expect(requests).toBe(1));
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    resolveOlder(trustedConsentResponse({ status: 'withdrawn', revision: 1 }));
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
      if (requests === 1) return trustedConsentResponse({ status: 'active', revision: 2 });
      return new Promise<Response>(resolve => { resolveServer = resolve; });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('stale-request');
    const retaining = retainNewerHealthConsent(user(uid));
    await vi.waitFor(() => expect(requests).toBe(2));
    localStorage.setItem(key(uid), 'pending:2');
    resolveServer(trustedConsentResponse({ status: 'active', revision: 2 }));
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
      if (methods.length === 1) return trustedConsentResponse({ status: 'active', revision: 2 });
      return new Promise<Response>(resolve => { resolveCheck = resolve; });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('stale-request');
    const ongoing = reconfirmStaleHealthWithdrawal(user(uid));
    await vi.waitFor(() => expect(methods).toHaveLength(2));
    localStorage.setItem(key(uid), 'withdrawn');
    resolveCheck(trustedConsentResponse({ status: 'active', revision: 2 }));
    await expect(ongoing).rejects.toThrow('scelta locale è cambiata');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(methods).toEqual(['GET', 'GET']);
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });
});

describe('later reacceptance on another device', () => {
  it('offers a choice when the durable withdrawn marker is older than the active server consent', async () => {
    const uid = 'remote-accept-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    localStorage.setItem(key(uid), 'withdrawn');
    vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({
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
    await createAndMigrateVault('user:' + uid);
    let latestRevision = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        // The withdrawal committed at rev 2, but another device reaccepted
        // at rev 3 before this acknowledgement reached the browser.
        latestRevision = 3;
        return trustedConsentResponse({ status: 'withdrawn', revision: 2 });
      }
      return trustedConsentResponse(latestRevision === 0
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
      return trustedConsentResponse({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' });
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('stale-request');
    expect(calls).toEqual(['GET']);
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });
});

describe('explicit acknowledgement of newer consent from another device', () => {
  it('retains the newer server acceptance without retrying a stale withdrawal', async () => {
    const uid = 'keep-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    localStorage.setItem(key(uid), 'pending:1');
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      methods.push(init.method ?? 'GET');
      return trustedConsentResponse({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' });
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
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    let resolveRecheck!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(trustedConsentResponse({ status: 'active', revision: 1 }))
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
      resolveRecheck(trustedConsentResponse({ status: 'withdrawn', revision: 1 }));
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
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 }));
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
      fetchMock.mockResolvedValueOnce(trustedConsentResponse({ status: 'withdrawn', revision: 1 }));
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
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 2 }));
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
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(trustedConsentResponse({ status: 'active', revision: 1 }))
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
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(trustedConsentResponse({ status: 'active', revision: 1 }))
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

describe('account offline withdrawal and explicit local-only reacceptance', () => {
  it('blocks offline account writes durably without requesting App Check or calling the network', async () => {
    const uid = 'no-offline-network-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const online = vi.spyOn(navigator, 'onLine', 'get');
    const requests = vi.fn(async () => trustedConsentResponse({
      status: 'active', revision: 1, acceptedAt: '2026-10-14T10:00:00.000Z',
      privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion,
    }));
    vi.stubGlobal('fetch', requests);
    try {
      online.mockReturnValue(true);
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(requests).toHaveBeenCalledTimes(1);
      online.mockReturnValue(false);
      const { getLimitedUseAppCheckToken } = await import('../src/lib/appCheck');
      vi.mocked(getLimitedUseAppCheckToken).mockClear();
      await expect(withdrawHealthConsent(actor)).resolves.toBeUndefined();
      expect(localStorage.getItem(key(uid))).toBe('pending:1');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(requests).toHaveBeenCalledTimes(1);
      expect(getLimitedUseAppCheckToken).not.toHaveBeenCalled();
    } finally { online.mockRestore(); }
  });

  it('accepts a server-confirmed online withdrawal locally offline without replaying the withdrawal', async () => {
    const uid = 'server-withdrawn-local-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const actions: string[] = [];
    let state: 'active' | 'withdrawn' = 'active';
    let revision = 1;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const payload = init.body ? JSON.parse(init.body as string) as { action: string } : undefined;
      const action = payload?.action ?? 'GET';
      actions.push(action);
      if (action === 'withdraw') {
        state = 'withdrawn'; revision = 2;
      } else if (action === 'reaccept') {
        state = 'active'; revision = 3;
      }
      return trustedConsentResponse({
        status: state, revision,
        ...(state === 'active'
          ? { acceptedAt: '2026-10-15T09:00:00.000Z',
              privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion }
          : {}),
      });
    }));
    try {
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('active');
      await expect(withdrawHealthConsent(actor)).resolves.toBeUndefined();
      expect(currentHealthConsentStatus(uid)).toBe('withdrawn');
      expect(localStorage.getItem(key(uid))).toBe('withdrawn');
      online.mockReturnValue(false);
      expect(() => reacceptHealthConsentLocally(actor, accepted)).not.toThrow();
      expect(currentHealthConsentStatus(uid)).toBe('active');
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(localStorage.getItem(key(uid))).toContain('offline-reaccepted:1:');
      online.mockReturnValue(true);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(localStorage.getItem(key(uid))).toBeNull();
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);
      expect(actions).toEqual(['GET', 'withdraw', 'GET', 'GET', 'reaccept', 'GET']);
    } finally { online.mockRestore(); }
  });

  it('restores device editing after a pending offline revocation, never cloud, and survives cold boot', async () => {
    const uid = 'local-consent-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const online = vi.spyOn(navigator, 'onLine', 'get');
    const methods: string[] = [];
    let disconnected = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (disconnected) throw new TypeError('Failed to fetch');
      const payload = init.body ? JSON.parse(init.body as string) as { action: string } : null;
      methods.push(payload?.action ?? 'GET');
      if (payload?.action === 'withdraw') return trustedConsentResponse({ status: 'withdrawn', revision: 2 });
      if (payload?.action === 'reaccept') return trustedConsentResponse({
        status: 'active', revision: 3, acceptedAt: '2026-10-15T10:00:00.000Z',
      });
      return trustedConsentResponse({ status: 'active', revision: methods.includes('reaccept') ? 3 : 1,
        acceptedAt: methods.includes('reaccept') ? '2026-10-15T10:00:00.000Z' : '2026-10-14T10:00:00.000Z',
        privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion });
    }));
    try {
      online.mockReturnValue(true);
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);

      online.mockReturnValue(false);
      disconnected = true;
      await expect(withdrawHealthConsent(actor)).resolves.toBeUndefined();
      expect(currentHealthConsentStatus(uid)).toBe('pending');
      expect(() => reacceptHealthConsentLocally(actor, accepted)).not.toThrow();
      expect(currentHealthConsentStatus(uid)).toBe('active');
      expect(isHealthConsentLocalOnly(uid)).toBe(true);
      expect(isHealthConsentWritable('user:' + uid)).toBe(true);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(localStorage.getItem(key(uid))).toBe('offline-reaccepted:1:1.3.4:1.2.1');

      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(isHealthConsentWritable('user:' + uid)).toBe(true);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(methods).toEqual(['GET']);

      online.mockReturnValue(true);
      disconnected = false;
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(methods).toEqual(['GET', 'GET', 'withdraw', 'reaccept', 'GET']);
      expect(getServerConfirmedLegalConsent(uid)).toMatchObject({ privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion });
      expect(localStorage.getItem(key(uid))).toBeNull();
      expect(isHealthConsentLocalOnly(uid)).toBe(false);
      expect(getVerifiedHealthConsentRevision(uid)).toBe(3);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(true);
    } finally { online.mockRestore(); }
  });

  it('finishes a server-confirmed reacceptance after reload without sending another withdrawal', async () => {
    const uid = 'resumed-offline-consent-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    localStorage.setItem(key(uid), 'offline-reaccepted:1:1.3.4:1.2.1');
    localStorage.setItem('logbook:v2:user:' + uid + ':health-consent-generation', '3');
    localStorage.setItem('logbook:v2:user:' + uid + ':health-consent-last-active', '1');
    const fetchMock = vi.fn(async () => trustedConsentResponse({
      status: 'active', revision: 3, acceptedAt: '2026-10-15T10:00:00.000Z',
      privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion,
    }));
    vi.stubGlobal('fetch', fetchMock);
    beginHealthConsentVerification(uid);
    expect(currentHealthConsentStatus(uid)).not.toBe('active');
    expect(await refreshHealthConsent(actor)).toBe('active');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key(uid))).toBeNull();
    expect(getVerifiedHealthConsentRevision(uid)).toBe(3);
  });

  it('asks before keeping an acceptance newer than an offline device decision', async () => {
    const uid = 'newer-online-consent-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      beginHealthConsentVerification(uid);
      vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 })));
      expect(await refreshHealthConsent(actor)).toBe('active');
      online.mockReturnValue(false);
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
      await expect(withdrawHealthConsent(actor)).resolves.toBeUndefined();
      reacceptHealthConsentLocally(actor, accepted);
      online.mockReturnValue(true);
      const network = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 5,
        acceptedAt: '2026-10-15T12:00:00.000Z',
        privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion }));
      vi.stubGlobal('fetch', network);
      expect(await refreshHealthConsent(actor)).toBe('stale-request');
      expect(network).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(key(uid))).toContain('offline-reaccepted:');
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(await retainNewerHealthConsent(actor)).toBe('active');
      expect(localStorage.getItem(key(uid))).toBeNull();
      expect(getVerifiedHealthConsentRevision(uid)).toBe(5);
    } finally { online.mockRestore(); }
  });

  it('preserves local-only use across retryable App Check token outages without allowing cloud', async () => {
    const uid = 'offline-appcheck-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const online = vi.spyOn(navigator, 'onLine', 'get');
    try {
      online.mockReturnValue(true);
      beginHealthConsentVerification(uid);
      vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 })));
      expect(await refreshHealthConsent(actor)).toBe('active');
      online.mockReturnValue(false);
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
      await expect(withdrawHealthConsent(actor)).resolves.toBeUndefined();
      reacceptHealthConsentLocally(actor, accepted);
      online.mockReturnValue(true);
      const { getLimitedUseAppCheckToken } = await import('../src/lib/appCheck');
      vi.mocked(getLimitedUseAppCheckToken).mockRejectedValueOnce(
        Object.assign(new Error('App Check temporairement unavailable'), {
          code: 'app-check-limited-use-unavailable', retryable: true,
        }),
      );
      expect(await refreshHealthConsent(actor)).toBe('active');
      expect(isHealthConsentWritable('user:' + uid)).toBe(true);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(localStorage.getItem(key(uid))).toContain('offline-reaccepted:');
    } finally { online.mockRestore(); }
  });

  it('persists a server CAS conflict as a safe withdrawal barrier across reload', async () => {
    const uid = 'conflict-reconnect-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const online = vi.spyOn(navigator, 'onLine', 'get');
    try {
      online.mockReturnValue(true);
      beginHealthConsentVerification(uid);
      vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 })));
      expect(await refreshHealthConsent(actor)).toBe('active');
      online.mockReturnValue(false);
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
      await expect(withdrawHealthConsent(actor)).resolves.toBeUndefined();
      reacceptHealthConsentLocally(actor, accepted);
      expect(isHealthConsentWritable('user:' + uid)).toBe(true);
      online.mockReturnValue(true);
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) =>
        init.method === 'GET'
          ? trustedConsentResponse({ status: 'active', revision: 1 })
          : trustedConsentResponse({ error: 'consent revision conflict' }, { status: 409 })));
      expect(await refreshHealthConsent(actor)).toBe('pending');
      expect(localStorage.getItem(key(uid))).toBe('pending:1');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      beginHealthConsentVerification(uid);
      vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({
        status: 'active', revision: 5, acceptedAt: '2026-10-15T12:00:00.000Z',
        privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion,
      })));
      expect(await refreshHealthConsent(actor)).toBe('stale-request');
      expect(localStorage.getItem(key(uid))).toBe('pending:1');
    } finally { online.mockRestore(); }
  });

  it('rejects local reopening for unregistered users, stale legal versions and absent cached server proof', () => {
    const uid = 'no-offline-consent-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      localStorage.setItem(key(uid), 'pending:1');
      expect(() => reacceptHealthConsentLocally(actor, accepted)).toThrow('non verificabile');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      localStorage.setItem(key(uid), 'offline-reaccepted:1:0.0.0:1.2.1');
      expect(currentHealthConsentStatus(uid)).not.toBe('active');
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    } finally { onLine.mockRestore(); }
  });

  it('preserves a locally reaccepted withdrawal when another device advanced the cloud epoch', async () => {
    const uid = 'stale-local-reaccept-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const onLine = vi.spyOn(navigator, 'onLine', 'get');
    const fetchMock = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      onLine.mockReturnValue(true);
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('active');
      onLine.mockReturnValue(false);
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
      await expect(withdrawHealthConsent(actor)).resolves.toBeUndefined();
      reacceptHealthConsentLocally(actor, accepted);
      onLine.mockReturnValue(true);
      const newer = vi.fn(async () => trustedConsentResponse({ status: 'withdrawn', revision: 4 }));
      vi.stubGlobal('fetch', newer);
      expect(await refreshHealthConsent(actor)).toBe('withdrawn');
      expect(newer).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(key(uid))).toBe('withdrawn');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    } finally { onLine.mockRestore(); }
  });
});

describe('consent responses across authenticated owner changes', () => {
  it('does not publish an old trusted response for account A after login to B', async () => {
    const uid = 'late-owner-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    let resolveGet!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { resolveGet = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    beginHealthConsentVerification(uid);
    const pending = refreshHealthConsent(actor);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    (auth as { currentUser: unknown }).currentUser = user('other-account');
    resolveGet(trustedConsentResponse({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' }));
    expect(await pending).not.toBe('active');
    expect(localStorage.getItem('logbook:v2:user:' + uid + ':health-consent-generation')).toBeNull();
    expect(localStorage.getItem('logbook:v2:user:' + uid + ':health-consent-last-active')).toBeNull();
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
  });

  it('preserves a stale KEEP choice after the account changes during GET', async () => {
    const uid = 'keep-owner-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    localStorage.setItem(key(uid), 'pending:1');
    let resolveKeep!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(trustedConsentResponse({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveKeep = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshHealthConsent(actor)).toBe('stale-request');
    const keep = retainNewerHealthConsent(actor);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    (auth as { currentUser: unknown }).currentUser = user('other-account');
    resolveKeep(trustedConsentResponse({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' }));
    await expect(keep).rejects.toThrow('Sessione');
    expect(localStorage.getItem(key(uid))).toBe('pending:1');
    expect(localStorage.getItem('logbook:v2:user:' + uid + ':health-consent-generation')).toBeNull();
  });
});

describe('no trusted consent POST after an authenticated owner switch', () => {
  it('never reaccepts for account A when its GET finishes after login to B', async () => {
    const uid = 'reaccept-switch-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    localStorage.setItem(key(uid), 'withdrawn');
    let resolveRead!: (response: Response) => void;
    const request = vi.fn(() => new Promise<Response>(resolve => { resolveRead = resolve; }));
    vi.stubGlobal('fetch', request);
    const reaccepting = reacceptHealthConsent(actor, accepted);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    (auth as { currentUser: unknown }).currentUser = user('other-account');
    resolveRead(trustedConsentResponse({ status: 'withdrawn', revision: 1 }));
    await expect(reaccepting).rejects.toThrow('Sessione cambiata');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not send an old withdrawal after Firebase token acquisition races with login B', async () => {
    const uid = 'withdraw-token-switch-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    let releaseToken!: (token: string) => void;
    const actor = user(uid);
    const normalGetIdToken = actor.getIdToken;
    actor.getIdToken = vi.fn()
      .mockImplementationOnce(() => normalGetIdToken())
      .mockImplementationOnce(() => new Promise<string>(resolve => { releaseToken = resolve; }));
    (auth as { currentUser: unknown }).currentUser = actor;
    const request = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 }));
    vi.stubGlobal('fetch', request);
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('active');
    const withdrawal = withdrawHealthConsent(actor);
    await vi.waitFor(() => expect(actor.getIdToken).toHaveBeenCalledTimes(2));
    (auth as { currentUser: unknown }).currentUser = user('other-account');
    releaseToken('old-valid-token');
    await expect(withdrawal).rejects.toThrow('Sessione cambiata');
    expect(localStorage.getItem(key(uid))).toBe('pending:1');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not reconfirm a stale withdrawal after its server GET races with login B', async () => {
    const uid = 'reconfirm-switch-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    localStorage.setItem(key(uid), 'pending:1');
    let resolveRead!: (response: Response) => void;
    const request = vi.fn()
      .mockResolvedValueOnce(trustedConsentResponse({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveRead = resolve; }));
    vi.stubGlobal('fetch', request);
    expect(await refreshHealthConsent(actor)).toBe('stale-request');
    const reconfirming = reconfirmStaleHealthWithdrawal(actor);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    (auth as { currentUser: unknown }).currentUser = user('other-account');
    resolveRead(trustedConsentResponse({ status: 'active', revision: 2 }));
    await expect(reconfirming).rejects.toThrow('Sessione cambiata');
    expect(localStorage.getItem(key(uid))).toBe('pending:1');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
