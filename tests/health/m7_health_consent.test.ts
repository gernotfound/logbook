import { LEGAL_VERSIONS } from '../../src/lib/legalVersions';
import { adminDb } from '../../server/accountDeletion/firebaseAdmin';
import { beforeEach, describe, vi } from 'vitest';
import { registerConsentHttpCases } from './healthConsentHttpCases';
import { registerConsentErasureCases } from './healthConsentErasureCases';
import { registerConsentConcurrencyCases } from './healthConsentConcurrencyCases';

type Stored = Record<string, unknown>;
const storage = vi.hoisted(() => ({ documents: new Map<string, Stored>() }));
const auth = vi.hoisted(() => ({
  verifyHealthConsentRequester: vi.fn(async () => ({ uid: 'account-1', emailVerified: true })),
  requireVerifiedHealthConsentWrite: vi.fn((identity: { emailVerified: boolean }) => {
    if (!identity.emailVerified) throw new auth.RequestAuthError('Indirizzo email non verificato.', 403);
  }),
  RequestAuthError: class RequestAuthError extends Error {
    constructor(message: string, public readonly status: 401 | 403 = 401) {
      super(message);
    }
  },
}));

const erasureWorker = vi.hoisted(() => ({ process: vi.fn(async () => 'pending' as const) }));
vi.mock('../../server/healthConsent/erasure', async importOriginal => ({
  ...(await importOriginal<typeof import('../../server/healthConsent/erasure')>()),
  processHealthDataErasure: erasureWorker.process,
}));

vi.mock('../../server/accountDeletion/httpAuth', () => auth);
const transactionFixture = vi.hoisted(() => ({
  failErasureSetOnce: false,
  retries: 0,
  overlap: null as null | { arrivals: number; gate: Promise<void>; release: () => void },
}));
vi.mock('../../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => ({
    collection: (name: string) => ({
      doc: (uid: string) => ({
        key: name + '/' + uid,
        async get() {
          const item = storage.documents.get(name + '/' + uid);
          return { exists: !!item, data: () => item };
        },
        async delete() { storage.documents.delete(name + '/' + uid); },
      }),
    }),
    // Optimistic retries model Firestore's read-version validation: overlapping
    // requests must not both commit changes computed from the same snapshot.
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const reads = new Map<string, Stored | undefined>();
        const writes = new Map<string, Stored | null>();
        const result = await fn({
          get: (ref: { key: string }) => {
            const item = storage.documents.get(ref.key);
            reads.set(ref.key, item);
            return Promise.resolve({ exists: !!item, data: () => item });
          },
          create: (ref: { key: string }, data: Stored) => {
            if (storage.documents.has(ref.key)) throw new Error('Already exists');
            writes.set(ref.key, data);
          },
          set: (ref: { key: string }, data: Stored) => writes.set(ref.key, data),
          update: (ref: { key: string }, data: Stored) => {
            const old = storage.documents.get(ref.key);
            if (!old) throw new Error('Not found');
            writes.set(ref.key, { ...old, ...data });
          },
          delete: (ref: { key: string }) => writes.set(ref.key, null),
        });
        if (attempt === 0 && transactionFixture.overlap) {
          const overlap = transactionFixture.overlap;
          overlap.arrivals += 1;
          if (overlap.arrivals === 2) overlap.release();
          await overlap.gate;
        }
        if ([...reads].some(([key, value]) => storage.documents.get(key) !== value)) {
          transactionFixture.retries += 1;
          continue;
        }
        if (transactionFixture.failErasureSetOnce && writes.has('health_data_erasures/account-1')) {
          transactionFixture.failErasureSetOnce = false;
          throw new Error('Injected transactional erasure job write failure');
        }
        for (const [key, value] of writes) {
          if (value === null) storage.documents.delete(key);
          else storage.documents.set(key, value);
        }
        return result;
      }
      throw new Error('Firestore transaction conflict retries exhausted');
    },
  }),
}));

import { GET, OPTIONS, POST } from '../../api/health-consent';
import {
  HealthConsentRevisionConflictError, readHealthConsentState, recordHealthConsentWithdrawal,
  recordInitialHealthConsentAcceptance,
  recordHealthConsentReacceptance, removeHealthConsentStateForDeletedAccount,
} from '../../server/healthConsent/withdrawal';

function req(method: 'GET' | 'POST' | 'OPTIONS', body?: unknown, origin = 'https://thelogbook.web.app'): Request {
  return new Request('https://backend.test/api/health-consent', {
    method, headers: { origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function finishErasure(revision: number): void {
  const consent = storage.documents.get('health_consent_withdrawals/account-1');
  if (!consent) throw new Error('Consent must exist before finishing erasure');
  storage.documents.set('health_consent_withdrawals/account-1', {
    ...consent, status: 'withdrawn', revision: revision + 1, erasedBeforeRevision: revision,
  });
  storage.documents.set('health_data_erasures/account-1', {
    uid: 'account-1', status: 'complete', consentRevision: revision, completedRevision: revision + 1,
  });
  storage.documents.delete('users/account-1');
  storage.documents.delete('user_data_keys/account-1');
}

const acceptance = {
  acceptedTerms: true as const, acceptedHealthData: true as const,
  privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
};
// Keep mocked production imports in the discovered test entrypoint. Re-exporting
// these handlers from a shared vi.mock fixture produced undefined bindings in CI.
const context = {
  GET, OPTIONS, POST, adminDb, auth, erasureWorker, storage, transactionFixture, acceptance, req, finishErasure, HealthConsentRevisionConflictError, readHealthConsentState, recordHealthConsentWithdrawal, recordInitialHealthConsentAcceptance, recordHealthConsentReacceptance, removeHealthConsentStateForDeletedAccount,
};
export type HealthConsentTestContext = typeof context;

describe('trusted health consent boundary', () => {
  beforeEach(() => {
    storage.documents.clear();
    vi.clearAllMocks();
    transactionFixture.failErasureSetOnce = false;
    transactionFixture.overlap = null;
    transactionFixture.retries = 0;
  });
  registerConsentHttpCases(context);
  registerConsentErasureCases(context);
  registerConsentConcurrencyCases(context);
});
