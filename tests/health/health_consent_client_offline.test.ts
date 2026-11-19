import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '../../src/lib/firebase';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { user, key, accepted, trustedConsentResponse } from './healthConsentClientFixture';

// Exercise the actual consent policy while isolating only external Firebase/App Check adapters.
vi.unmock('../../src/lib/healthConsent');
vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn(async () => {}) }));
vi.mock('../../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: vi.fn(async () => 'fresh-limited-use') }));

import { beginHealthConsentVerification, currentHealthConsentStatus, isHealthConsentWritable, isHealthConsentCloudWritable, getVerifiedHealthConsentRevision, refreshHealthConsent, withdrawHealthConsent } from '../../src/lib/healthConsent';

beforeEach(() => { lockAllVaults(); localStorage.clear(); vi.unstubAllGlobals(); (auth as { currentUser: unknown }).currentUser = null; });
afterEach(() => lockAllVaults());

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

describe('account offline withdrawal always suspends old data', () => {
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
      const { getLimitedUseAppCheckToken } = await import('../../src/lib/appCheck');
      vi.mocked(getLimitedUseAppCheckToken).mockClear();
      await expect(withdrawHealthConsent(actor)).resolves.toBeUndefined();
      expect(localStorage.getItem(key(uid))).toBe('pending:1');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
      expect(requests).toHaveBeenCalledTimes(1);
      expect(getLimitedUseAppCheckToken).not.toHaveBeenCalled();
    } finally { online.mockRestore(); }
  });


  it('does not authorize device editing after a pending offline revocation', async () => {
    const uid = 'blocked-reaccept-' + crypto.randomUUID();
    await createAndMigrateVault('user:' + uid);
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    const online = vi.spyOn(navigator, 'onLine', 'get');
    vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 })));
    try {
      online.mockReturnValue(true);
      beginHealthConsentVerification(uid);
      expect(await refreshHealthConsent(actor)).toBe('active');
      online.mockReturnValue(false);
      await withdrawHealthConsent(actor);
      expect(currentHealthConsentStatus(uid)).toBe('pending');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(await refreshHealthConsent(actor)).toBe('pending');
      expect(isHealthConsentWritable('user:' + uid)).toBe(false);
      expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    } finally { online.mockRestore(); }
  });
});
