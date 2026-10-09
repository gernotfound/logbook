import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  owner: 'user:owner-a',
  currentSession: true,
  user: {
    uid: 'owner-a',
    getIdToken: vi.fn(),
  },
  getLimitedUseAppCheckToken: vi.fn(),
  ensureAppCheck: vi.fn(),
}));

vi.mock('../src/lib/firebase', () => ({
  auth: { currentUser: state.user },
  ensureAppCheck: state.ensureAppCheck,
}));
vi.mock('../src/lib/appCheck', () => ({
  getLimitedUseAppCheckToken: state.getLimitedUseAppCheckToken,
}));
vi.mock('../src/lib/sync/session', () => ({
  captureSession: () => ({ owner: state.owner, epoch: 1 }),
  isCurrentSession: (session: { owner: string }) => session.owner === state.owner && state.currentSession,
  storageOwner: () => state.owner,
}));

import { requestHealthConsentRevocation } from '../src/lib/requestHealthConsentRevocation';
import { readHealthConsentRevocation } from '../src/lib/healthConsentRevocation';

describe('health consent revocation API client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    state.owner = 'user:owner-a';
    state.currentSession = true;
    state.user.getIdToken.mockResolvedValue('synthetic-id-token');
    state.getLimitedUseAppCheckToken.mockResolvedValue('synthetic-app-check');
    state.ensureAppCheck.mockResolvedValue(undefined);
  });

  it('persists a blocking local intent before the network request', async () => {
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      expect(readHealthConsentRevocation('user:owner-a')).toBe('pending');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        authorization: 'Bearer synthetic-id-token',
        'x-firebase-appcheck': 'synthetic-app-check',
      });
      return Response.json({ revoked: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    await requestHealthConsentRevocation();
    expect(readHealthConsentRevocation('user:owner-a')).toBe('confirmed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('finishes a revocation after the local cleanup invalidates the sync epoch, without switching the owner', async () => {
    state.user.getIdToken.mockImplementationOnce(async () => {
      state.currentSession = false;
      return 'synthetic-id-token';
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ revoked: true, erasure: 'pending' })));
    await requestHealthConsentRevocation();
    expect(readHealthConsentRevocation('user:owner-a')).toBe('confirmed');
  });

  it('stops after a real account switch while the token is loading', async () => {
    state.user.getIdToken.mockImplementationOnce(async () => {
      state.owner = 'user:other-account';
      return 'synthetic-id-token';
    });
    const post = vi.fn();
    vi.stubGlobal('fetch', post);
    await expect(requestHealthConsentRevocation()).rejects.toThrow('Sessione cambiata');
    expect(post).not.toHaveBeenCalled();
    expect(readHealthConsentRevocation('user:owner-a')).toBe('pending');
  });

  it('retains pending state when server acknowledgement is uncertain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network unavailable'); }));
    await expect(requestHealthConsentRevocation()).rejects.toThrow('network unavailable');
    expect(readHealthConsentRevocation('user:owner-a')).toBe('pending');
  });

  it('never marks server confirmation when the response is not valid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ revoked: false })));
    await expect(requestHealthConsentRevocation()).rejects.toThrow('Risposta del server non verificata');
    expect(readHealthConsentRevocation('user:owner-a')).toBe('pending');
  });

  it('handles guest-only suspension without server requests', async () => {
    state.owner = 'guest';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await requestHealthConsentRevocation();
    expect(readHealthConsentRevocation('guest')).toBe('confirmed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
