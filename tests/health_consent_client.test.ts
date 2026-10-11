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
    localStorage.setItem(key(uid), 'pending');
    expect(currentHealthConsentStatus(uid)).toBe('pending');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('does not discard an unsent withdrawal when the server initially reports active', async () => {
    const uid = 'pending-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'pending');
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
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(withdrawHealthConsent(user(uid))).rejects.toThrow('offline');
    expect(localStorage.getItem(key(uid))).toBe('pending');
    expect(isHealthConsentWritable('user:' + uid)).toBe(false);
  });

  it('requires a server-confirmed explicit reacceptance before unlocking', async () => {
    const uid = 'reactivate-' + crypto.randomUUID();
    localStorage.setItem(key(uid), 'withdrawn');
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ status: 'active', revision: 2, acceptedAt: '2026-10-12T00:00:00.000Z' })));
    expect(await reacceptHealthConsent(user(uid), accepted)).toBe('2026-10-12T00:00:00.000Z');
    expect(currentHealthConsentStatus(uid)).toBe('reaccepting');
    // During this narrow phase the explicit consent commit is allowed, while
    // the suspended UI still hides all ordinary fitness operations.
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
