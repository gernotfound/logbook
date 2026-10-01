import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  registry: null as null | Record<string, unknown>,
  deleted: 0,
}));

function snapshot() {
  return {
    exists: state.registry !== null,
    data: () => state.registry ?? undefined,
  };
}

const ref = vi.hoisted(() => ({
  async get() { return snapshot(); },
  async delete() { state.registry = null; state.deleted += 1; },
}));

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    if (name !== 'account_deletion_devices') throw new Error('Unexpected collection');
    return { doc: (_uid: string) => ref };
  },
  async runTransaction(work: (tx: any) => Promise<void>) {
    await work({
      get: async () => snapshot(),
      create: (_ref: unknown, data: Record<string, unknown>) => { state.registry = data; },
      update: (_ref: unknown, data: Record<string, unknown>) => {
        if (!state.registry) throw new Error('Missing registry');
        state.registry = { ...state.registry, ...data };
      },
    });
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

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({ adminDb: () => fakeDb }));
vi.mock('../server/accountDeletion/jobStore', () => store);
vi.mock('../server/accountDeletion/httpAuth', () => auth);

import {
  MAX_DELETION_RECOVERY_DEVICES,
  purgeDeletionRecoveryDevices,
  registerDeletionRecoveryDevice,
  verifyDeletionRecoveryDevice,
} from '../server/accountDeletion/deviceRecovery';
import { GET, POST } from '../api/account-deletion-device';

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
    state.registry = null;
    state.deleted = 0;
    vi.clearAllMocks();
    delete process.env.PUBLIC_APP_LEGACY_ORIGIN;
    auth.verifyRecoveryRegistrationRequester.mockResolvedValue({ uid: 'user-a' });
    auth.verifyStatusAppCheck.mockResolvedValue(undefined);
    store.readDeletionStatusForUid.mockResolvedValue({ uid: 'user-a', status: 'complete' });
  });

  it('stores only token hashes and verifies the matching account/device pair', async () => {
    const raw = token('A');
    await registerDeletionRecoveryDevice('user-a', raw);

    expect(JSON.stringify(state.registry)).not.toContain(raw);
    expect(state.registry?.tokenHashes).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
    await expect(verifyDeletionRecoveryDevice('user-a', raw)).resolves.toBe(true);
    await expect(verifyDeletionRecoveryDevice('user-a', token('B'))).resolves.toBe(false);
    await expect(verifyDeletionRecoveryDevice('user-b', raw)).resolves.toBe(false);
  });

  it('is idempotent and rotates the oldest hash instead of permanently exhausting the bounded registry', async () => {
    await registerDeletionRecoveryDevice('user-a', token('A'));
    await registerDeletionRecoveryDevice('user-a', token('A'));
    expect((state.registry?.tokenHashes as string[])).toHaveLength(1);

    for (let index = 1; index < MAX_DELETION_RECOVERY_DEVICES; index += 1) {
      await registerDeletionRecoveryDevice('user-a', token(String.fromCharCode(65 + index)));
    }
    expect((state.registry?.tokenHashes as string[])).toHaveLength(MAX_DELETION_RECOVERY_DEVICES);
    await expect(verifyDeletionRecoveryDevice('user-a', token('A'))).resolves.toBe(true);

    await registerDeletionRecoveryDevice('user-a', token('Z'));

    expect((state.registry?.tokenHashes as string[])).toHaveLength(MAX_DELETION_RECOVERY_DEVICES);
    await expect(verifyDeletionRecoveryDevice('user-a', token('A'))).resolves.toBe(false);
    await expect(verifyDeletionRecoveryDevice('user-a', token('Z'))).resolves.toBe(true);
  });

  it('purges the bounded registry in one operation', async () => {
    await registerDeletionRecoveryDevice('user-a', token('A'));
    await expect(purgeDeletionRecoveryDevices('user-a')).resolves.toBe(1);
    await expect(purgeDeletionRecoveryDevices('user-a')).resolves.toBe(0);
    expect(state.deleted).toBe(1);
  });

  it('rejects unauthorized origins before auth or recovery work', async () => {
    const response = await POST(request('POST', { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
    expect(auth.verifyRecoveryRegistrationRequester).not.toHaveBeenCalled();
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
