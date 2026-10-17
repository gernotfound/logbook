import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  currentUser: { uid: 'owner', getIdToken: vi.fn(async () => 'valid-token') },
  owner: 'user:owner',
  current: true,
  appCheck: vi.fn(async () => undefined),
  getToken: vi.fn(async () => 'appcheck-limited'),
}));
vi.mock('../src/lib/firebase', () => ({
  auth: { get currentUser() { return state.currentUser; } },
  ensureAppCheck: state.appCheck,
}));
vi.mock('../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: state.getToken }));
vi.mock('../src/lib/sync/session', () => ({
  captureSession: () => ({ owner: state.owner, epoch: 1 }),
  isCurrentSession: () => state.current,
}));

import { assertCurrentHealthDataErasureCompleted, requestHealthDataErasure } from '../src/lib/healthDataErasure';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  state.owner = 'user:owner';
  state.current = true;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => response({
    status: 'complete', complete: true, localPurgeAuthorized: true,
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe('trusted health data erasure client proof', () => {
  it('authenticates the owner and requires a second current-epoch GET before local purge', async () => {
    await expect(assertCurrentHealthDataErasureCompleted('owner')).resolves.toBeUndefined();
    expect(state.currentUser.getIdToken).toHaveBeenCalledWith(true);
    expect(state.getToken).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/health-data-erasure'),
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({
        authorization: 'Bearer valid-token', 'x-firebase-appcheck': 'appcheck-limited',
      }) }));
  });

  it('refuses a stale successful receipt after a later consent cycle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      status: 'complete', complete: true, localPurgeAuthorized: false,
    })));
    await expect(assertCurrentHealthDataErasureCompleted('owner')).rejects.toThrow('non è verificata');
  });

  it('refuses any cross-owner or invalidated session before network access', async () => {
    await expect(assertCurrentHealthDataErasureCompleted('other')).rejects.toThrow('Proprietario');
    expect(fetch).not.toHaveBeenCalled();
    state.current = false;
    await expect(requestHealthDataErasure(state.currentUser as never)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the server error without accepting a failed POST as a successful erasure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'Backend indisponibile.' }, 503)));
    await expect(requestHealthDataErasure(state.currentUser as never)).rejects.toThrow('Backend indisponibile.');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/health-data-erasure'),
      expect.objectContaining({ method: 'POST', cache: 'no-store' }));
  });

  it('rejects an unavailable proof GET before parsing an untrusted error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 503 })));
    await expect(assertCurrentHealthDataErasureCompleted('owner')).rejects.toThrow('Non è stato possibile verificare');
  });

  it('never sends a request if the owner session expires during token retrieval', async () => {
    state.currentUser.getIdToken.mockImplementationOnce(async () => {
      state.current = false;
      return 'valid-token';
    });
    await expect(requestHealthDataErasure(state.currentUser as never)).rejects.toThrow('Sessione cambiata');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not treat a 202 pending server response as complete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      status: 'deleting', complete: false, localPurgeAuthorized: false,
    }, 202)));
    expect(await requestHealthDataErasure(state.currentUser as never)).toMatchObject({ status: 'deleting', complete: false });
    await expect(assertCurrentHealthDataErasureCompleted('owner')).rejects.toThrow('non è verificata');
  });
});
