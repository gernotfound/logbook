import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import { auth } from '../../src/lib/firebase';
import { getLimitedUseAppCheckToken } from '../../src/lib/appCheck';
import { UserDataSchema } from '../../src/lib/schema';
import { initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { invalidateSession } from '../../src/lib/sync/session';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { user, key, accepted, trustedConsentResponse } from './healthConsentClientFixture';

// Exercise the actual consent policy while isolating only external Firebase/App Check adapters.
vi.unmock('../../src/lib/healthConsent');
vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn(async () => {}) }));
vi.mock('../../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: vi.fn(async () => 'fresh-limited-use') }));

import { beginHealthConsentVerification, currentHealthConsentStatus, isVerifiedHealthWithdrawal, isHealthConsentWritable, isHealthConsentCloudWritable, getServerConfirmedLegalConsent, getVerifiedHealthConsentRevision, refreshHealthConsent, registerInitialHealthConsent, retainNewerHealthConsent } from '../../src/lib/healthConsent';

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

describe('trusted withdrawal evidence for automatic erasure', () => {
  it('never treats a cross-tab withdrawn marker as confirmed before the trusted GET', async () => {
    const uid = 'withdraw-proof-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    beginHealthConsentVerification(uid);
    localStorage.setItem(key(uid), 'withdrawn');
    expect(currentHealthConsentStatus(uid)).toBe('withdrawn');
    expect(isVerifiedHealthWithdrawal(uid)).toBe(false);
    const fetchMock = vi.fn(async () => trustedConsentResponse({ status: 'withdrawn', revision: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshHealthConsent(actor)).toBe('withdrawn');
    expect(isVerifiedHealthWithdrawal(uid)).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    beginHealthConsentVerification(uid);
    expect(isVerifiedHealthWithdrawal(uid)).toBe(false);
  });
});

describe('unsupported consent markers fail closed without migrations', () => {
  it('does not authorize cloud or local fitness or contact the backend for an unknown marker', async () => {
    const uid = 'unsupported-marker-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    localStorage.setItem(key(uid), 'unsupported-legacy-state');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('error');
    expect(currentHealthConsentStatus(uid)).toBe('error');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(key(uid))).toBe('unsupported-legacy-state');
  });
});
