import { beforeEach, describe, expect, it, vi } from 'vitest';
// Unlike the rest of the UI fixture, this suite exercises the real policy module.
vi.unmock('../src/lib/healthConsent');

vi.mock('../src/lib/firebase', () => ({ ensureAppCheck: vi.fn(async () => {}) }));
vi.mock('../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: vi.fn(async () => 'fresh-limited-use') }));

import {
  beginHealthConsentVerification, currentHealthConsentStatus,
  finishHealthConsentReacceptance, isHealthConsentWritable,
  reacceptHealthConsent, refreshHealthConsent, requireHealthConsentWritable,
  withdrawHealthConsent,
  withdrawGuestHealthConsent, beginGuestHealthReacceptance,
  completeGuestHealthReacceptance, getGuestHealthConsentStatus,
} from '../src/lib/healthConsent';

const user = (uid: string) => ({ uid, getIdToken: vi.fn(async () => 'id-token') }) as any;
const key = (uid: string) => `logbook:v2:user:${uid}:health-consent-withdrawal`;
const accepted = { acceptedTerms: true as const, acceptedHealthData: true as const, privacyVersion: '1.3.2', termsVersion: '1.2.0' };

beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('durable health-consent client barrier', () => {
  it('suspends writes before server verification and when local intent is pending', () => {
    const uid = 'check-' + crypto.randomUUID();
    beginHealthConsentVerification(uid);
    expect(currentHealthConsentStatus(uid)).toBe('checking');
    expect(() => requireHealthConsentWritable('user:' + uid)).toThrow('Accesso fitness sospeso');
    localStorage.setItem(key(uid), 'pending:0');
    expect(currentHealthConsentStatus(uid)).toBe('pending');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('does not discard an unsent withdrawal when the server initially reports active', async () => {
    const uid = 'pending-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'pending:0');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init.method ?? 'GET');
      return Response.json(init.method === 'GET'
        ? { status: 'active', revision: 0 }
        : { status: 'withdrawn', revision: 1 });
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
      if (request.method === 'GET') return Response.json({ status: 'active', revision: 0 });
      throw new Error('offline');
    }));
    expect(await refreshHealthConsent(user(uid))).toBe('active');
    await expect(withdrawHealthConsent(user(uid))).rejects.toThrow('offline');
    expect(localStorage.getItem(key(uid))).toBe('pending:0');
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
    localStorage.setItem(key(uid), 'pending:0');
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
