import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  class RequestAuthError extends Error {
    constructor(message: string, public readonly status: 401 | 403 = 401) { super(message); }
  }
  return {
    documents: new Map<string, Record<string, unknown>>(),
    verify: vi.fn(async () => ({ uid: 'owner-a', emailVerified: true })),
    wrap: vi.fn(async (uid: string, secret: Buffer) => ({
      format: 'thelogbook-wrapped-account-key' as const, version: 1 as const,
      uid, kmsKeyName: 'test-key', ciphertext: secret.toString('base64'),
    })),
    unwrap: vi.fn(async (_uid: string, wrapped: { ciphertext: string }) => Buffer.from(wrapped.ciphertext, 'base64')),
    RequestAuthError,
  };
});

function ref(key: string) {
  return {
    key,
    async get() {
      const found = harness.documents.get(key);
      return { exists: Boolean(found), data: () => found };
    },
    collection(name: string) {
      return {
        doc: (id: string) => ref(key + '/' + name + '/' + id),
        limit: (_n: number) => ({ prefix: key + '/' + name + '/' }),
      };
    },
  };
}
const db = {
  collection: (name: string) => ({ doc: (id: string) => ref(name + '/' + id) }),
  runTransaction: async (work: (tx: {
    get: (r: ReturnType<typeof ref> | { prefix: string }) => Promise<unknown>;
    create: (r: ReturnType<typeof ref>, d: Record<string, unknown>) => void;
  }) => Promise<unknown>) => work({
    get: async (r) => 'prefix' in r
      ? { empty: ![...harness.documents.keys()].some(k => k.startsWith(r.prefix)) }
      : r.get(),
    create: (r, d) => {
      if (harness.documents.has(r.key)) throw new Error('Concurrent create without transaction retry');
      harness.documents.set(r.key, d);
    },
  }),
};
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({ adminDb: () => db }));
vi.mock('../server/cloudKeys/kmsEnvelope', () => ({
  AccountKeyUnavailableError: class AccountKeyUnavailableError extends Error {},
  wrapAccountDataKey: harness.wrap,
  unwrapAccountDataKey: harness.unwrap,
}));
vi.mock('../server/accountDeletion/httpAuth', () => ({
  RequestAuthError: harness.RequestAuthError,
  verifyHealthConsentRequester: harness.verify,
  requireVerifiedHealthConsentWrite: (id: { emailVerified: boolean }) => {
    if (!id.emailVerified) throw new harness.RequestAuthError('Email not verified', 403);
  },
}));
vi.mock('../server/healthConsent/withdrawal', () => ({
  readHealthConsentState: async (uid: string) => ({
    status: harness.documents.get('health_consent_withdrawals/' + uid)?.status ?? 'unregistered',
    revision: 1,
  }),
}));

import { OPTIONS, POST } from '../api/cloud-key';

const consent = () => ({
  uid: 'owner-a', status: 'active', revision: 1,
  acceptedAt: '2026-10-24T00:00:00.000Z',
  privacyVersion: 'current', termsVersion: 'current',
});
const request = (origin = 'https://thelogbook.web.app', withBody = false) => new Request(
  'https://backend.test/api/cloud-key', {
    method: 'POST',
    headers: { origin, ...(withBody ? { 'content-length': '2' } : {}) },
    ...(withBody ? { body: '{}' } : {}),
  },
);

beforeEach(() => {
  harness.documents.clear();
  vi.clearAllMocks();
  harness.documents.set('health_consent_withdrawals/owner-a', consent());
  harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: true });
  harness.wrap.mockImplementation(async (uid, secret) => ({
    format: 'thelogbook-wrapped-account-key', version: 1, uid,
    kmsKeyName: 'test-key', ciphertext: secret.toString('base64'),
  }));
  harness.unwrap.mockImplementation(async (_uid, wrapped) => Buffer.from(wrapped.ciphertext, 'base64'));
});

describe('authenticated cloud account key API', () => {
  it('creates one wrapped server-only key then returns same key on next login without re-encrypting', async () => {
    const first = await POST(request());
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('no-store');
    const a = await first.json();
    expect(a).toMatchObject({ format: 'thelogbook-account-data-key', version: 1 });
    expect(Buffer.from(a.key as string, 'base64')).toHaveLength(32);
    const stored = harness.documents.get('user_data_keys/owner-a');
    expect(stored?.ciphertext).toBeTruthy();
    expect(stored).not.toHaveProperty('plaintext');
    const second = await POST(request());
    expect(second.status).toBe(200);
    expect((await second.json()).key).toBe(a.key);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
    expect(harness.unwrap).toHaveBeenCalledTimes(2);
  });

  it('rejects foreign Origin and unverified email before any key material is accessed', async () => {
    expect((await POST(request('https://attacker.example'))).status).toBe(403);
    expect(harness.verify).not.toHaveBeenCalled();
    harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: false });
    expect((await POST(request())).status).toBe(403);
    expect(harness.wrap).not.toHaveBeenCalled();
    expect((await OPTIONS(new Request('https://backend.test/api/cloud-key', {
      method: 'OPTIONS', headers: { origin: 'https://thelogbook.web.app' },
    }))).status).toBe(204);
  });

  it('refuses provisioning over ANY existing plaintext or encrypted cloud state', async () => {
    for (const path of [
      'users/owner-a',
      'users/owner-a/sync_control/state',
      'users/owner-a/history_months/2026-10',
      'users/owner-a/nutrition_months/2026-10',
    ]) {
      harness.documents.set(path, { _sealed: 'existing-patient-data' });
      expect((await POST(request())).status).toBe(409);
      expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
      harness.documents.delete(path);
    }
  });

  it('blocks missing/withdrawn consent, account deletion and incomplete erasure', async () => {
    harness.documents.delete('health_consent_withdrawals/owner-a');
    expect((await POST(request())).status).toBe(503);
    harness.documents.set('health_consent_withdrawals/owner-a', { ...consent(), status: 'withdrawn' });
    expect((await POST(request())).status).toBe(503);
    harness.documents.set('health_consent_withdrawals/owner-a', consent());
    harness.documents.set('account_deletions/owner-a', { status: 'requested' });
    expect((await POST(request())).status).toBe(503);
    harness.documents.delete('account_deletions/owner-a');
    harness.documents.set('health_data_erasures/owner-a', { status: 'deleting' });
    expect((await POST(request())).status).toBe(503);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
    // Neither invalid consent nor an in-progress deletion spends a KMS
    // encrypt call; the transaction rechecks those fences after preflight.
    expect(harness.wrap).not.toHaveBeenCalled();
  });

  it('does not regenerate an existing malformed envelope or expose key material after KMS failure', async () => {
    harness.documents.set('user_data_keys/owner-a', { uid: 'owner-a', version: 999, ciphertext: 'invalid' });
    expect((await POST(request())).status).toBe(503);
    expect(harness.wrap).not.toHaveBeenCalled();
    harness.documents.delete('user_data_keys/owner-a');
    harness.wrap.mockRejectedValueOnce(new Error('KMS credentials unavailable'));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('KMS credentials');
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });

  it('permits authenticated rights-only recovery after withdrawal without ever provisioning a new key', async () => {
    const first = await POST(request());
    expect(first.status).toBe(200);
    const original = (await first.json() as { key: string }).key;
    harness.documents.set('health_consent_withdrawals/owner-a', {
      uid: 'owner-a', status: 'withdrawn', revision: 2,
    });
    harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: false });
    const rights = await POST(new Request('https://backend.test/api/cloud-key?purpose=rights-export', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
    }));
    expect(rights.status).toBe(200);
    expect((await rights.json() as { key: string }).key).toBe(original);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
    expect((await POST(request())).status).toBe(403);

    harness.documents.delete('user_data_keys/owner-a');
    const missing = await POST(new Request('https://backend.test/api/cloud-key?purpose=rights-export', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
    }));
    expect(missing.status).toBe(503);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });

  it('ignores client-supplied uid/key and always uses verified caller identity', async () => {
    const result = await POST(request('https://thelogbook.web.app', true));
    expect(result.status).toBe(400);
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });
});
