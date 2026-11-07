import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  class RequestAuthError extends Error {
    constructor(message: string, public readonly status: 401 | 403 = 401) { super(message); }
  }
  return {
    documents: new Map<string, Record<string, unknown>>(),
    beforeTransaction: null as null | (() => void),
    afterTransaction: null as null | (() => void),
    verify: vi.fn(async () => ({ uid: 'owner-a', emailVerified: true })),
    wrap: vi.fn(async (uid: string, secret: Buffer) => ({
      format: 'thelogbook-wrapped-account-key' as const, version: 1 as const,
      uid, keyVersion: 1 as const, iv: Buffer.alloc(12, 1).toString('base64'),
      tag: Buffer.alloc(16, 2).toString('base64'), ciphertext: secret.toString('base64'),
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
  }) => Promise<unknown>) => {
    const before = harness.beforeTransaction;
    harness.beforeTransaction = null;
    before?.();
    const pendingCreates: Array<{ key: string; data: Record<string, unknown> }> = [];
    const result = await work({
      get: async (r) => 'prefix' in r
        ? { empty: ![...harness.documents.keys()].some(k => k.startsWith(r.prefix)) }
        : r.get(),
      create: (r, d) => {
        if (harness.documents.has(r.key)) throw new Error('Concurrent create without transaction retry');
        pendingCreates.push({ key: r.key, data: d });
      },
    });
    // A rejected transaction must not publish staged credentials.
    for (const entry of pendingCreates) harness.documents.set(entry.key, entry.data);
    const after = harness.afterTransaction;
    harness.afterTransaction = null;
    after?.();
    return result;
  },
};
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({ adminDb: () => db }));
vi.mock('../server/cloudKeys/accountKeyEnvelope', () => ({
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
  harness.beforeTransaction = null;
  harness.afterTransaction = null;
  vi.clearAllMocks();
  harness.documents.set('health_consent_withdrawals/owner-a', consent());
  harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: true });
  harness.wrap.mockImplementation(async (uid, secret) => ({
    format: 'thelogbook-wrapped-account-key', version: 1, uid,
    keyVersion: 1 as const, iv: Buffer.alloc(12, 1).toString('base64'),
      tag: Buffer.alloc(16, 2).toString('base64'), ciphertext: secret.toString('base64'),
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

  it('accepts an empty POST body stream, but never accepts payload bytes', async () => {
    // Vercel's Request adapter can expose a non-null body stream even when
    // the browser sends a bodyless POST.
    const empty = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' }, body: '',
    });
    expect(empty.body).not.toBeNull();
    expect((await POST(empty)).status).toBe(200);

    const zeroChunk = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(0));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect((await POST(zeroChunk)).status).toBe(200);
    expect(harness.wrap).toHaveBeenCalledTimes(1);

    const nonEmpty = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"uid":"attacker"}'));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const verifyCalls = harness.verify.mock.calls.length;
    expect((await POST(nonEmpty)).status).toBe(400);
    expect(harness.verify).toHaveBeenCalledTimes(verifyCalls);

    const declaredNonEmpty = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app', 'content-length': '1' },
    });
    expect((await POST(declaredNonEmpty)).status).toBe(400);
    expect(harness.verify).toHaveBeenCalledTimes(verifyCalls);
  });

  it.each(['stalled', 'empty-chunk-then-stalled'] as const)(
    'bounds %s request-body inspection without running Auth or key provisioning',
    async scenario => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            if (scenario === 'empty-chunk-then-stalled') controller.enqueue(new Uint8Array(0));
          },
        });
        const stalled = new Request('https://backend.test/api/cloud-key', {
          method: 'POST',
          headers: { origin: 'https://thelogbook.web.app' },
          body,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });

        const responsePromise = POST(stalled);
        await vi.advanceTimersByTimeAsync(2_100);
        const response = await responsePromise;
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Questa operazione non accetta dati da inviare.' });
        expect(harness.verify).not.toHaveBeenCalled();
        expect(harness.wrap).not.toHaveBeenCalled();
        expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('accepts a delayed empty body that finishes before the inspection deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) { setTimeout(() => controller.close(), 500); },
      });
      const delayed = new Request('https://backend.test/api/cloud-key', {
        method: 'POST',
        headers: { origin: 'https://thelogbook.web.app' },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });

      const responsePromise = POST(delayed);
      await vi.advanceTimersByTimeAsync(500);
      expect((await responsePromise).status).toBe(200);
      expect(harness.wrap).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a bodyless rights export without provisioning a new key', async () => {
    expect((await POST(request())).status).toBe(200);
    harness.documents.set('health_consent_withdrawals/owner-a', { uid: 'owner-a', status: 'withdrawn', revision: 2 });
    harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: false });
    const rights = new Request('https://backend.test/api/cloud-key?purpose=rights-export', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' }, body: '',
    });
    expect(rights.body).not.toBeNull();
    expect((await POST(rights)).status).toBe(200);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
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
    // Neither invalid consent nor an in-progress deletion spends a secret-dependent
    // wrapping call; the transaction rechecks those fences after preflight.
    expect(harness.wrap).not.toHaveBeenCalled();
  });

  it('does not regenerate malformed envelopes or expose backend key errors', async () => {
    harness.documents.set('user_data_keys/owner-a', { uid: 'owner-a', version: 999, ciphertext: 'invalid' });
    expect((await POST(request())).status).toBe(503);
    expect(harness.wrap).not.toHaveBeenCalled();
    harness.documents.delete('user_data_keys/owner-a');
    harness.wrap.mockRejectedValueOnce(new Error('missing protected server secret'));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('protected server secret');
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

  it('rechecks consent in its transaction after a preflight-to-transaction revocation', async () => {
    harness.beforeTransaction = () => harness.documents.set(
      'health_consent_withdrawals/owner-a', { ...consent(), status: 'withdrawn' },
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });

  it('never releases key bytes if consent is withdrawn immediately after transaction commit', async () => {
    harness.afterTransaction = () => harness.documents.set(
      'health_consent_withdrawals/owner-a', { ...consent(), status: 'withdrawn' },
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.text())).not.toMatch(/[A-Za-z0-9+/]{43}=/);
    // Provisioning was atomic before withdrawal, but the final read must
    // still reject releasing its bytes under now-withdrawn consent.
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(true);
    expect((await POST(request())).status).toBe(503);
  });

  it.each([
    ['client-selected uid', '?uid=another-account'],
    ['client-supplied key', '?key=untrusted'],
    ['unknown purpose', '?purpose=sync'],
    ['duplicate purpose', '?purpose=rights-export&purpose=rights-export'],
    ['empty purpose', '?purpose='],
    ['rights export with uid', '?purpose=rights-export&uid=another-account'],
  ])('rejects %s query before authentication or key access', async (_case, query) => {
    const response = await POST(new Request(`https://backend.test/api/cloud-key${query}`, {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app' },
    }));
    expect(response.status).toBe(400);
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.wrap).not.toHaveBeenCalled();
    expect(harness.unwrap).not.toHaveBeenCalled();
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });

  it('ignores client-supplied uid/key and always uses verified caller identity', async () => {
    const result = await POST(request('https://thelogbook.web.app', true));
    expect(result.status).toBe(400);

    // A request body without Content-Length must also be rejected before Auth.
    const withoutLength = new Request('https://backend.test/api/cloud-key', {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app' },
      body: '{"uid":"another-account"}',
    });
    expect(withoutLength.headers.has('content-length')).toBe(false);
    expect((await POST(withoutLength)).status).toBe(400);

    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });
});
