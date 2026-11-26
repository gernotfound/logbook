import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import { auth } from '../../src/lib/firebase';
import { UserDataSchema } from '../../src/lib/schema';
import { initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY } from '../../src/lib/sync/session';
import { user, key, accepted, trustedConsentResponse } from './healthConsentClientFixture';
import { installLegacyHealthConsentIdentity } from '../../src/lib/healthConsentLegacyIdentity';

// Exercise the actual consent policy while isolating only external Firebase/App Check adapters.
vi.unmock('../../src/lib/healthConsent');
vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn(async () => {}) }));
vi.mock('../../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: vi.fn(async () => 'fresh-limited-use') }));

import { beginHealthConsentVerification, currentHealthConsentStatus, finishHealthConsentReacceptance, isHealthConsentWritable, reacceptHealthConsent, refreshHealthConsent, requireHealthConsentWritable, withdrawHealthConsent, retainNewerHealthConsent, reconfirmStaleHealthWithdrawal, withdrawGuestHealthConsent, getGuestHealthConsentStatus } from '../../src/lib/healthConsent';

let disposeIdentity: () => void;
const testAccounts = new Map<string, ReturnType<typeof user>>();
function actingAs(uid: string) {
  const active = auth.currentUser;
  if (active?.uid === uid) return active;
  let account = testAccounts.get(uid);
  if (!account) { account = user(uid); testAccounts.set(uid, account); }
  (auth as { currentUser: unknown }).currentUser = account;
  return account;
}
beforeEach(() => { lockAllVaults(); localStorage.clear(); vi.unstubAllGlobals(); (auth as { currentUser: unknown }).currentUser = null; testAccounts.clear(); disposeIdentity = installLegacyHealthConsentIdentity(() => auth.currentUser); });
afterEach(() => { disposeIdentity(); lockAllVaults(); });

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
    expect(await refreshHealthConsent(actingAs(uid))).toBe('withdrawn');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(calls).toEqual(['GET', 'POST']);
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('recognizes a remote revocation and prevents normal writes', async () => {
    const uid = 'remote-' + crypto.randomUUID();
    vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({ status: 'withdrawn', revision: 1 })));
    expect(await refreshHealthConsent(actingAs(uid))).toBe('withdrawn');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('keeps revocation durable across uncertain server failures', async () => {
    const uid = 'offline-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    await createAndMigrateVault('user:' + uid);
    await initializeLocal('user:' + uid, UserDataSchema.parse({ profile: { height: '180' } }) as any);
    expect(await get('logbook:v2:user:' + uid)).toMatch(/^tlb-sealed:v1:/);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, request: RequestInit) => {
      if (request.method === 'GET') return trustedConsentResponse({ status: 'active', revision: 1 });
      throw new Error('offline');
    }));
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('active');
    await expect(withdrawHealthConsent(actor)).rejects.toThrow('offline');
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
    expect(await reacceptHealthConsent(actingAs(uid), accepted)).toBe('2026-10-12T00:00:00.000Z');
    expect(currentHealthConsentStatus(uid)).toBe('reaccepting');
    // An acknowledged server action alone does NOT make the old local journal
    // writable. The generation handshake is a separate durable step.
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(await refreshHealthConsent(actingAs(uid))).toBe('active');
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
    const olderCheck = refreshHealthConsent(actingAs(uid));
    await reacceptHealthConsent(actingAs(uid), accepted);
    expect(localStorage.getItem(key(uid))).toBe('reaccepting:1');
    resolveOld(trustedConsentResponse({ status: 'withdrawn', revision: 1 }));
    expect(await olderCheck).toBe('reaccepting');
    expect(localStorage.getItem(key(uid))).toBe('reaccepting:1');
    expect(await refreshHealthConsent(actingAs(uid))).toBe('active');
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
    const older = refreshHealthConsent(actingAs(uid));
    await vi.waitFor(() => expect(requests).toBe(1));
    expect(await refreshHealthConsent(actingAs(uid))).toBe('active');
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
    expect(await refreshHealthConsent(actingAs(uid))).toBe('stale-request');
    const retaining = retainNewerHealthConsent(actingAs(uid));
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
    expect(await refreshHealthConsent(actingAs(uid))).toBe('stale-request');
    const ongoing = reconfirmStaleHealthWithdrawal(actingAs(uid));
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
    expect(await refreshHealthConsent(actingAs(uid))).toBe('stale-request');
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(await retainNewerHealthConsent(actingAs(uid))).toBe('active');
    expect(localStorage.getItem(key(uid))).toBeNull();
  });
});

describe('withdrawal acknowledgement racing with a newer consent', () => {
  it('offers an explicit stale-request decision instead of trapping the device in withdrawn state', async () => {
    const uid = 'late-ack-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
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
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('active');
    await withdrawHealthConsent(actor);
    expect(localStorage.getItem(key(uid))).toBe('pending:1');
    expect(currentHealthConsentStatus(uid)).toBe('stale-request');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(await retainNewerHealthConsent(actingAs(uid))).toBe('active');
  });
});

describe('local-only guest consent lifecycle', () => {
  it('requires a live guest generation even when no withdrawal marker exists', () => {
    expect(getGuestHealthConsentStatus()).toBe('active');
    expect(isHealthConsentWritable('guest')).toBe(false);
    expect(() => requireHealthConsentWritable('guest')).toThrow('Accesso fitness sospeso');

    localStorage.setItem('logbook_is_guest', 'true');
    expect(isHealthConsentWritable('guest')).toBe(false);
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-consent-session-a');
    activateGuestSession('guest-consent-session-a');
    expect(isHealthConsentWritable('guest')).toBe(true);

    localStorage.setItem(GUEST_SESSION_KEY, 'guest-consent-session-b');
    expect(isHealthConsentWritable('guest')).toBe(false);
    localStorage.setItem(GUEST_REVOCATION_KEY, 'revoked-in-another-tab');
    expect(isHealthConsentWritable('guest')).toBe(false);
  });

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
    expect(await refreshHealthConsent(actingAs(uid))).toBe('stale-request');
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
    expect(await refreshHealthConsent(actingAs(uid))).toBe('stale-request');
    expect(await retainNewerHealthConsent(actingAs(uid))).toBe('active');
    expect(isHealthConsentWritable('user:' + uid)).toBe(true);
    expect(localStorage.getItem(key(uid))).toBeNull();
    expect(methods).toEqual(['GET', 'GET']);
  });
});
