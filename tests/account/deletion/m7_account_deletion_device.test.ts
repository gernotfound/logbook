import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  registries: new Map<string, Record<string, unknown>>(),
  deletionJobUid: null as string | null,
}));

function registry(uid = 'user-a'): Record<string, unknown> | null {
  return state.registries.get(uid) ?? null;
}

function snapshot(uid: string) {
  const data = registry(uid);
  return { exists: data !== null, data: () => data ?? undefined };
}

function deviceRef(uid: string) {
  return {
    uid,
    async get() { return snapshot(uid); },
  };
}

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    if (name === 'account_deletion_devices') return { doc: (uid: string) => deviceRef(uid) };
    if (name === 'account_deletions') return {
      doc: (uid: string) => ({
        async get() {
          return { exists: state.deletionJobUid === uid, data: () => ({ uid }) };
        },
      }),
    };
    throw new Error('Unexpected collection');
  },
  async runTransaction(work: (tx: any) => Promise<void>) {
    const writes: Array<() => void> = [];
    await work({
      get: (target: { get: () => Promise<unknown> }) => target.get(),
      create: (target: { uid: string }, data: Record<string, unknown>) => {
        if (registry(target.uid)) throw new Error('Already exists');
        writes.push(() => { state.registries.set(target.uid, data); });
      },
      update: (target: { uid: string }, data: Record<string, unknown>) => {
        const old = registry(target.uid);
        if (!old) throw new Error('Missing registry');
        writes.push(() => { state.registries.set(target.uid, { ...old, ...data }); });
      },
    });
    // Transaction writes become visible only after the callback succeeds.
    for (const apply of writes) apply();
  },
}));

const store = vi.hoisted(() => ({
  validateUid: vi.fn((value: unknown) => {
    if (typeof value !== 'string' || value.length < 1 || value.includes('/')) throw new Error('Identificativo account non valido.');
    return value;
  }),
  readDeletionStatusForUid: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  verifyRecoveryRegistrationRequester: vi.fn(),
  verifyStatusAppCheck: vi.fn(),
  RequestAuthError: class RequestAuthError extends Error {
    constructor(message: string, public readonly status: 401 | 403 = 401) {
      super(message);
      this.name = 'RequestAuthError';
    }
  },
}));

vi.mock('../../../server/accountDeletion/firebaseAdmin', () => ({ adminDb: () => fakeDb }));
vi.mock('../../../server/accountDeletion/jobStore', () => store);
vi.mock('../../../server/accountDeletion/httpAuth', () => auth);

import {
  MAX_DELETION_RECOVERY_DEVICES,
  DeletionRecoveryConflictError,
  registerDeletionRecoveryDevice,
  verifyDeletionRecoveryDevice,
} from '../../../server/accountDeletion/deviceRecovery';
import { GET, POST, OPTIONS } from '../../../api/account-deletion-device';

function token(character: string): string {
  return character.repeat(43);
}

function request(method: 'GET' | 'POST', options?: { origin?: string; deviceToken?: string }): Request {
  const origin = options?.origin ?? 'https://thelogbook.web.app';
  const deviceToken = options?.deviceToken ?? token('A');
  return new Request('https://backend.example/api/account-deletion-device', {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      'x-account-deletion-uid': 'user-a',
      'x-account-deletion-device': deviceToken,
    },
    body: method === 'POST' ? JSON.stringify({ deviceToken }) : undefined,
  });
}

describe('M7 account deletion recovery device registry', () => {
  beforeEach(() => {
    state.registries.clear();
    state.deletionJobUid = null;
    vi.clearAllMocks();
    auth.verifyRecoveryRegistrationRequester.mockResolvedValue({ uid: 'user-a' });
    auth.verifyStatusAppCheck.mockResolvedValue(undefined);
    store.readDeletionStatusForUid.mockResolvedValue({ uid: 'user-a', status: 'complete' });
  });

  it.each(['{broken json', 'null', '[]', '"invalid shape"', '42', 'true'])(
    'classifies invalid POST JSON as HTTP 400 after authenticating the requester: %s',
    async raw => {
      const response = await POST(new Request('https://backend.example/api/account-deletion-device', {
        method: 'POST',
        headers: { origin: 'https://thelogbook.web.app', 'content-type': 'application/json' },
        body: raw,
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Corpo JSON non valido.' });
      expect(auth.verifyRecoveryRegistrationRequester).toHaveBeenCalledTimes(1);
      expect(registry()).toBeNull();
    },
  );

  it('preserves a real backend exception as a generic 500 after valid input', async () => {
    const registryError = vi.spyOn(fakeDb, 'runTransaction')
      .mockRejectedValueOnce(new Error('internal DB connection detail'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await POST(request('POST'));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Servizio recovery temporaneamente non disponibile.' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('internal DB connection detail');
    } finally {
      registryError.mockRestore();
      log.mockRestore();
    }
  });

  it('rejects a registration authenticated before account deletion but committed afterwards', async () => {
    auth.verifyRecoveryRegistrationRequester.mockImplementationOnce(async () => {
      state.deletionJobUid = 'user-a';
      return { uid: 'user-a' };
    });
    const response = await POST(request('POST'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Registrazione dispositivo non consentita: cancellazione account già avviata.',
    });
    expect(registry()).toBeNull();
  });

  it('retains existing recovery proof but forbids new hashes or recency updates after deletion starts', async () => {
    const original = token('A');
    await registerDeletionRecoveryDevice('user-a', original);
    const snapshotBefore = registry();
    state.deletionJobUid = 'user-a';

    await expect(registerDeletionRecoveryDevice('user-a', token('B')))
      .rejects.toBeInstanceOf(DeletionRecoveryConflictError);
    await expect(registerDeletionRecoveryDevice('user-a', original))
      .rejects.toBeInstanceOf(DeletionRecoveryConflictError);
    expect(registry()).toBe(snapshotBefore);
    expect(await verifyDeletionRecoveryDevice('user-a', original)).toBe(true);
    expect(await verifyDeletionRecoveryDevice('user-a', token('B'))).toBe(false);
  });

  it('does not block the same registration if another owner is being deleted', async () => {
    state.deletionJobUid = 'user-b';
    await expect(registerDeletionRecoveryDevice('user-a', token('A'))).resolves.toBeUndefined();
    expect(registry()?.uid).toBe('user-a');
  });

  it('stores only token hashes and verifies the matching account/device pair', async () => {
    const raw = token('A');
    await registerDeletionRecoveryDevice('user-a', raw);

    expect(JSON.stringify(registry())).not.toContain(raw);
    expect(registry()?.tokenHashes).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
    await expect(verifyDeletionRecoveryDevice('user-a', raw)).resolves.toBe(true);
    await expect(verifyDeletionRecoveryDevice('user-a', token('B'))).resolves.toBe(false);
    await expect(verifyDeletionRecoveryDevice('user-b', raw)).resolves.toBe(false);
  });

  it('keeps two owners recovery registries independent across registration and verification', async () => {
    const a = token('A');
    const b = token('B');
    await registerDeletionRecoveryDevice('user-a', a);
    await registerDeletionRecoveryDevice('user-b', b);
    expect(registry('user-a')?.uid).toBe('user-a');
    expect(registry('user-b')?.uid).toBe('user-b');
    expect(await verifyDeletionRecoveryDevice('user-a', b)).toBe(false);
    expect(await verifyDeletionRecoveryDevice('user-b', a)).toBe(false);
    expect(await verifyDeletionRecoveryDevice('user-a', a)).toBe(true);
    expect(registry('user-a')?.uid).toBe('user-a');
  });

  it('keeps the registry bounded and evicts the least recently registered token instead of exhausting it', async () => {
    await registerDeletionRecoveryDevice('user-a', token('A'));
    await registerDeletionRecoveryDevice('user-a', token('A'));
    expect((registry()?.tokenHashes as string[])).toHaveLength(1);

    for (let index = 1; index < MAX_DELETION_RECOVERY_DEVICES; index += 1) {
      await registerDeletionRecoveryDevice('user-a', token(String.fromCharCode(65 + index)));
    }
    expect((registry()?.tokenHashes as string[])).toHaveLength(MAX_DELETION_RECOVERY_DEVICES);

    // Touch A so it is no longer the least-recently registered credential.
    await registerDeletionRecoveryDevice('user-a', token('A'));
    await registerDeletionRecoveryDevice('user-a', token('Z'));

    expect((registry()?.tokenHashes as string[])).toHaveLength(MAX_DELETION_RECOVERY_DEVICES);
    await expect(verifyDeletionRecoveryDevice('user-a', token('A'))).resolves.toBe(true);
    await expect(verifyDeletionRecoveryDevice('user-a', token('B'))).resolves.toBe(false);
    await expect(verifyDeletionRecoveryDevice('user-a', token('Z'))).resolves.toBe(true);
  });

  it('rejects unauthorized origins before auth or recovery work', async () => {
    const response = await POST(request('POST', { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
    expect(auth.verifyRecoveryRegistrationRequester).not.toHaveBeenCalled();
  });

  it('restricts CORS preflight to the exact app origin before any authentication', async () => {
    const allowed = await OPTIONS(new Request('https://backend.example/api/account-deletion-device', {
      method: 'OPTIONS',
      headers: { origin: 'https://thelogbook.web.app', 'access-control-request-method': 'GET' },
    }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://thelogbook.web.app');
    expect(allowed.headers.get('access-control-allow-headers')).toContain('x-account-deletion-device');

    const denied = await OPTIONS(new Request('https://backend.example/api/account-deletion-device', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    expect(auth.verifyStatusAppCheck).not.toHaveBeenCalled();
    expect(auth.verifyRecoveryRegistrationRequester).not.toHaveBeenCalled();
  });

  it('rejects a foreign GET origin before App Check or UID/token lookup', async () => {
    const response = await GET(request('GET', { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(auth.verifyStatusAppCheck).not.toHaveBeenCalled();
    expect(store.readDeletionStatusForUid).not.toHaveBeenCalled();
  });

  it('binds registration to the verified token UID rather than a forged body UID', async () => {
    const response = await POST(new Request('https://backend.example/api/account-deletion-device', {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app', 'content-type': 'application/json' },
      body: JSON.stringify({ uid: 'user-b', deviceToken: token('A') }),
    }));
    expect(response.status).toBe(200);
    expect(registry('user-a')?.uid).toBe('user-a');
    expect(registry('user-b')).toBeNull();
  });

  it('refuses credentials when a Firestore transaction retries after a concurrent deletion job', async () => {
    const original = fakeDb.runTransaction.bind(fakeDb);
    const retry = vi.spyOn(fakeDb, 'runTransaction').mockImplementationOnce(async work => {
      // Firestore aborts a transaction if a read document changes before commit.
      // Simulate that retry, rather than pretending the first read was authoritative.
      await expect(original(async tx => {
        await work(tx);
        state.deletionJobUid = 'user-a';
        throw new Error('ABORTED: concurrent deletion job');
      })).rejects.toThrow('ABORTED');
      return original(work);
    });
    try {
      const response = await POST(request('POST'));
      expect(response.status).toBe(409);
      expect(registry()).toBeNull();
    } finally {
      retry.mockRestore();
    }
  });

  it('does not overwrite malformed recovery registry state', async () => {
    state.registries.set('user-a', { uid: 'user-a', tokenHashes: ['invalid'] });
    const before = registry();
    const registration = await POST(request('POST'));
    expect(registration.status).toBe(500);
    expect(await registration.json()).toEqual({ error: 'Servizio recovery temporaneamente non disponibile.' });
    expect(registry()).toBe(before);

    const status = await GET(request('GET'));
    expect(status.status).toBe(404);
    expect(store.readDeletionStatusForUid).not.toHaveBeenCalled();
    expect(registry()).toBe(before);
  });

  it('never caches positive, absent or rejected device-recovery status responses', async () => {
    await registerDeletionRecoveryDevice('user-a', token('A'));
    store.readDeletionStatusForUid.mockResolvedValueOnce(null);
    const none = await GET(request('GET'));
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ status: 'none' });
    expect(none.headers.get('cache-control')).toBe('no-store');

    const complete = await GET(request('GET'));
    expect(complete.status).toBe(200);
    expect((await complete.json()).status).toBe('complete');
    expect(complete.headers.get('cache-control')).toBe('no-store');

    const missing = await GET(request('GET', { deviceToken: token('B') }));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');

    const registered = await POST(request('POST'));
    expect(registered.status).toBe(200);
    expect(registered.headers.get('cache-control')).toBe('no-store');

    auth.verifyStatusAppCheck.mockRejectedValueOnce(new auth.RequestAuthError('App Check non valido.', 403));
    const denied = await GET(request('GET'));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('cache-control')).toBe('no-store');
    expect(store.readDeletionStatusForUid).toHaveBeenCalledTimes(2);
  });

  it('returns 404 for an invalid recovery credential without exposing account state', async () => {
    const response = await GET(request('GET', { deviceToken: token('B') }));
    expect(response.status).toBe(404);
    expect(store.readDeletionStatusForUid).not.toHaveBeenCalled();
  });

  it('returns the deletion status only after App Check and device proof succeed', async () => {
    const raw = token('A');
    await registerDeletionRecoveryDevice('user-a', raw);
    const response = await GET(request('GET', { deviceToken: raw }));
    expect(response.status).toBe(200);
    expect(auth.verifyStatusAppCheck).toHaveBeenCalledTimes(1);
    expect(store.readDeletionStatusForUid).toHaveBeenCalledWith('user-a');
    expect(await response.json()).toMatchObject({ status: 'complete' });
  });

  it('maps unexpected backend failures to a generic 500 without leaking details', async () => {
    const raw = token('A');
    await registerDeletionRecoveryDevice('user-a', raw);
    store.readDeletionStatusForUid.mockRejectedValueOnce(new Error('private backend detail'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET(request('GET', { deviceToken: raw }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Servizio recovery temporaneamente non disponibile.' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private backend detail');
    error.mockRestore();
  });
});
