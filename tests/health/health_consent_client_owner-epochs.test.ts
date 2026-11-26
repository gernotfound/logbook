import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import { auth } from '../../src/lib/firebase';
import { UserDataSchema } from '../../src/lib/schema';
import * as localRepository from '../../src/lib/sync/localRepository';
import { initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { invalidateSession } from '../../src/lib/sync/session';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { user, key, accepted, trustedConsentResponse } from './healthConsentClientFixture';
import { installLegacyHealthConsentIdentity } from '../../src/lib/healthConsentLegacyIdentity';

// Exercise the actual consent policy while isolating only external Firebase/App Check adapters.
vi.unmock('../../src/lib/healthConsent');
vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn(async () => {}) }));
vi.mock('../../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: vi.fn(async () => 'fresh-limited-use') }));

import { beginHealthConsentVerification, currentHealthConsentStatus, isHealthConsentWritable, isHealthConsentCloudWritable, reacceptHealthConsent, refreshHealthConsent, withdrawHealthConsent, retainNewerHealthConsent, reconfirmStaleHealthWithdrawal } from '../../src/lib/healthConsent';

let disposeIdentity: () => void;
beforeEach(() => { lockAllVaults(); localStorage.clear(); vi.unstubAllGlobals(); (auth as { currentUser: unknown }).currentUser = null; disposeIdentity = installLegacyHealthConsentIdentity(() => auth.currentUser); });
afterEach(() => { disposeIdentity(); lockAllVaults(); });

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

describe('withdrawal remains bound to the verified Auth generation', () => {
  it('does not transfer a verified local grant to a different User instance with the same UID', async () => {
    const uid = 'new-user-instance-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    await createAndMigrateVault('user:' + uid);
    vi.stubGlobal('fetch', vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 })));
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('active');
    expect(isHealthConsentWritable('user:' + uid)).toBe(true);

    (auth as { currentUser: unknown }).currentUser = user(uid);
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    await expect(withdrawHealthConsent(actor)).rejects.toThrow('Sessione cambiata');
    expect(localStorage.getItem(key(uid))).toBeNull();
  });

  it('does not persist a revocation for an old account after a switch to another UID', async () => {
    const uid = 'withdraw-stale-owner-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    await createAndMigrateVault('user:' + uid);
    const requests = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 }));
    vi.stubGlobal('fetch', requests);
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('active');

    (auth as { currentUser: unknown }).currentUser = user('other-' + crypto.randomUUID());
    // Account A's in-memory approval is not write permission for A under B.
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    invalidateSession();
    await expect(withdrawHealthConsent(actor)).rejects.toThrow('Sessione cambiata');
    expect(localStorage.getItem(key(uid))).toBeNull();
    expect(requests).toHaveBeenCalledOnce();
  });

  it('rejects a revoked Auth epoch even after the same UID returns with the same User instance', async () => {
    const uid = 'withdraw-stale-epoch-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    await createAndMigrateVault('user:' + uid);
    const requests = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 1 }));
    vi.stubGlobal('fetch', requests);
    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('active');
    expect(isHealthConsentWritable('user:' + uid)).toBe(true);

    (auth as { currentUser: unknown }).currentUser = user('other-' + crypto.randomUUID());
    invalidateSession();
    (auth as { currentUser: unknown }).currentUser = actor;
    invalidateSession();
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
    await expect(withdrawHealthConsent(actor)).rejects.toThrow('Verifica prima il consenso');
    expect(localStorage.getItem(key(uid))).toBeNull();
    expect(requests).toHaveBeenCalledOnce();

    beginHealthConsentVerification(uid);
    expect(await refreshHealthConsent(actor)).toBe('active');
    expect(isHealthConsentWritable('user:' + uid)).toBe(true);
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


describe('explicit KEEP choice across a same-owner session replacement', () => {
  it('preserves the original consent journal when A signs out and back in during epoch adoption', async () => {
    const uid = 'keep-epoch-' + crypto.randomUUID();
    const owner = 'user:' + uid;
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    await createAndMigrateVault(owner);
    await initializeLocal(owner, UserDataSchema.parse({ profile: { height: '175' } }) as any);
    const before = await readLocal(owner);
    const ciphertext = await get('logbook:v2:' + owner);
    localStorage.setItem(key(uid), 'pending:1');
    const network = vi.fn(async () => trustedConsentResponse({ status: 'active', revision: 2 }));
    vi.stubGlobal('fetch', network);
    expect(await refreshHealthConsent(actor)).toBe('stale-request');

    const adopt = localRepository.advanceLocalConsentRevisionIfClean;
    const injection = vi.spyOn(localRepository, 'advanceLocalConsentRevisionIfClean')
      .mockImplementationOnce(async (...args) => {
        // This wait represents IDB scheduling. The actual production adoption
        // and its guard still execute; UID and consent marker remain identical.
        (auth as { currentUser: unknown }).currentUser = user('another-account');
        invalidateSession();
        (auth as { currentUser: unknown }).currentUser = actor;
        invalidateSession();
        return adopt(...args);
      });
    try {
      await expect(retainNewerHealthConsent(actor)).rejects.toThrow('Sessione');
      expect(injection).toHaveBeenCalledOnce();
      expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
      expect(await readLocal(owner)).toEqual(before);
      expect(localStorage.getItem(key(uid))).toBe('pending:1');
      expect(isHealthConsentCloudWritable(owner)).toBe(false);
      expect(currentHealthConsentStatus(uid)).toBe('stale-request');
      expect(network).toHaveBeenCalledTimes(2);
    } finally { injection.mockRestore(); }
  });
});

describe('same-owner Auth epochs cannot complete stale-consent choices', () => {
  it('does not POST an obsolete explicit WITHDRAW choice after A→B→A during GET', async () => {
    const uid = 'reconfirm-epoch-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    localStorage.setItem(key(uid), 'pending:1');
    let finishRead!: (response: Response) => void;
    const network = vi.fn()
      .mockResolvedValueOnce(trustedConsentResponse({ status: 'active', revision: 2 }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishRead = resolve; }));
    vi.stubGlobal('fetch', network);
    expect(await refreshHealthConsent(actor)).toBe('stale-request');

    const reconfirming = reconfirmStaleHealthWithdrawal(actor);
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    (auth as { currentUser: unknown }).currentUser = user('another-account');
    invalidateSession();
    (auth as { currentUser: unknown }).currentUser = actor;
    invalidateSession();
    finishRead(trustedConsentResponse({ status: 'active', revision: 2 }));

    await expect(reconfirming).rejects.toThrow('Sessione cambiata');
    expect(network).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(key(uid))).toBe('pending:1');
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
  });

  it('does not POST obsolete REACCEPT after A→B→A during the trusted GET', async () => {
    const uid = 'reaccept-epoch-' + crypto.randomUUID();
    const actor = user(uid);
    (auth as { currentUser: unknown }).currentUser = actor;
    localStorage.setItem(key(uid), 'withdrawn');
    let finishRead!: (response: Response) => void;
    const network = vi.fn(() => new Promise<Response>(resolve => { finishRead = resolve; }));
    vi.stubGlobal('fetch', network);

    const reaccepting = reacceptHealthConsent(actor, accepted);
    await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
    (auth as { currentUser: unknown }).currentUser = user('another-account');
    invalidateSession();
    (auth as { currentUser: unknown }).currentUser = actor;
    invalidateSession();
    finishRead(trustedConsentResponse({ status: 'withdrawn', revision: 1 }));

    await expect(reaccepting).rejects.toThrow('Sessione cambiata');
    expect(network).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key(uid))).toBe('withdrawn');
    expect(isHealthConsentCloudWritable('user:' + uid)).toBe(false);
  });
});
