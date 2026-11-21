import { beforeEach, describe, vi } from 'vitest';
import { registerLegacyCloudKeyTransportCases } from './legacyCloudKeyTransportCases';
import { registerLegacyCloudKeyCustodyCases } from './legacyCloudKeyCustodyCases';
import { registerLegacyCloudKeyConcurrencyCases } from './legacyCloudKeyConcurrencyCases';

const harness = vi.hoisted(() => {
  class RequestAuthError extends Error {
    constructor(message: string, public readonly status: 401 | 403 = 401) { super(message); }
  }
  return {
    documents: new Map<string, Record<string, unknown>>(),
    documentReads: new Map<string, number>(),
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
      harness.documentReads.set(key, (harness.documentReads.get(key) ?? 0) + 1);
      const found = harness.documents.get(key);
      return { exists: Boolean(found), data: () => found };
    },
    async listCollections() {
      const prefix = key + '/';
      // Include ghost parents: Firestore can retain descendants of a deleted doc.
      const names = new Set([...harness.documents.keys()]
        .filter(path => path.startsWith(prefix))
        .map(path => path.slice(prefix.length).split('/')[0]));
      return [...names].map(name => ({ id: name }));
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
        ? { empty: ![...harness.documents.keys()].some(k => k.startsWith(r.prefix)
          && k.slice(r.prefix.length).split('/').length === 1) }
        : r.get(),
      create: (r, d) => {
        if (harness.documents.has(r.key)) throw new Error('Concurrent create without transaction retry');
        pendingCreates.push({ key: r.key, data: d });
      },
    });
    // A rejected transaction must not publish staged credentials.
    for (const entry of pendingCreates) harness.documents.set(entry.key, entry.data);
    // Only a write transaction can attest successful key creation.
    if (pendingCreates.length > 0) {
      const after = harness.afterTransaction;
      harness.afterTransaction = null;
      after?.();
    }
    return result;
  },
};
vi.mock('../../server/accountDeletion/firebaseAdmin', () => ({ adminDb: () => db }));
vi.mock('../../server/cloudKeys/accountKeyEnvelope', () => ({
  AccountKeyUnavailableError: class AccountKeyUnavailableError extends Error {},
  wrapAccountDataKey: harness.wrap,
  unwrapAccountDataKey: harness.unwrap,
}));
vi.mock('../../server/accountDeletion/httpAuth', () => ({
  RequestAuthError: harness.RequestAuthError,
  verifyHealthConsentRequester: harness.verify,
  requireVerifiedHealthConsentWrite: (id: { emailVerified: boolean }) => {
    if (!id.emailVerified) throw new harness.RequestAuthError('Email not verified', 403);
  },
}));
vi.mock('../../server/healthConsent/withdrawal', () => ({
  readHealthConsentState: async (uid: string) => {
    const state = harness.documents.get('health_consent_withdrawals/' + uid);
    if (state && (state.uid !== uid || !Number.isSafeInteger(state.revision))) {
      throw new Error('Stato consenso server non valido.');
    }
    return { status: state?.status ?? 'unregistered', revision: state?.revision ?? 0 };
  },
}));

import { OPTIONS, POST } from '../../api/cloud-key';

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
  harness.documentReads.clear();
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

const context = { harness, consent, request, OPTIONS, POST };
export type LegacyCloudKeyTestContext = typeof context;

describe('legacy Firebase/Vercel cloud account key API (not the Workers/D1 boundary)', () => {
  registerLegacyCloudKeyTransportCases(context);
  registerLegacyCloudKeyCustodyCases(context);
  registerLegacyCloudKeyConcurrencyCases(context);
});
