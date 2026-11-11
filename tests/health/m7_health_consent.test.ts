import { LEGAL_VERSIONS } from '../../src/lib/legalVersions';
import { adminDb } from '../../server/accountDeletion/firebaseAdmin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('trusted health consent boundary', () => {
  beforeEach(() => { storage.documents.clear(); vi.clearAllMocks(); transactionFixture.failErasureSetOnce = false; transactionFixture.overlap = null; transactionFixture.retries = 0; });

  it('treats an absent trusted consent record as unregistered for every API request', async () => {
    expect(await readHealthConsentState('account-1')).toEqual({ status: 'unregistered', revision: 0 });
    const response = await GET(req('GET'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'unregistered', revision: 0 });
    expect(auth.verifyHealthConsentRequester).toHaveBeenCalledTimes(1);
  });

  it('fails closed on active consent records missing the acceptance proof or with another UID', async () => {
    const key = 'health_consent_withdrawals/account-1';
    for (const state of [
      { uid: 'account-1', status: 'active', revision: 1 },
      { uid: 'other', status: 'active', revision: 1, acceptedAt: '2026-10-13T10:00:00.000Z', ...acceptance },
      { uid: 'account-1', status: 'active', revision: 1, acceptedAt: 'invalid', privacyVersion: acceptance.privacyVersion, termsVersion: acceptance.termsVersion },
    ]) {
      storage.documents.set(key, state);
      expect((await GET(req('GET'))).status).toBe(503);
    }
    storage.documents.clear();
  });

  it.each(['accept-initial', 'reaccept'] as const)(
    'rejects %s retries on a foreign or malformed trusted active record without writing',
    async action => {
      const key = 'health_consent_withdrawals/account-1';
      const revision = action === 'accept-initial' ? 1 : 2;
      const expectedRevision = revision - 1;
      const valid = {
        uid: 'account-1', status: 'active', revision,
        acceptedAt: '2026-10-13T10:00:00.000Z',
        privacyVersion: acceptance.privacyVersion,
        termsVersion: acceptance.termsVersion,
      };
      for (const malformed of [
        { ...valid, uid: 'another-account' },
        { ...valid, acceptedAt: 'not-a-date' },
        { ...valid, erasedBeforeRevision: revision },
      ]) {
        storage.documents.set(key, malformed);
        const original = structuredClone(malformed);
        expect((await GET(req('GET'))).status).toBe(503);
        const retry = await POST(req('POST', { action, expectedRevision, acceptance }));
        expect(retry.status).toBe(503);
        expect(await retry.json()).toHaveProperty('error');
        expect(storage.documents.get(key)).toEqual(original);
        expect(storage.documents.size).toBe(1);
      }
    },
  );

  it('keeps consent-status and withdrawal rights but forbids acceptance without verified email', async () => {
    auth.verifyHealthConsentRequester.mockResolvedValueOnce({ uid: 'account-1', emailVerified: false });
    const status = await GET(req('GET'));
    expect(status.status).toBe(200);

    auth.verifyHealthConsentRequester.mockResolvedValueOnce({ uid: 'account-1', emailVerified: false });
    const withdrawal = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(withdrawal.status).toBe(200);
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');

    auth.verifyHealthConsentRequester.mockResolvedValueOnce({ uid: 'account-1', emailVerified: false });
    const reaccept = await POST(req('POST', { action: 'reaccept', expectedRevision: 1, acceptance }));
    expect(reaccept.status).toBe(403);
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');

    storage.documents.clear();
    auth.verifyHealthConsentRequester.mockResolvedValueOnce({ uid: 'account-1', emailVerified: false });
    const initial = await POST(req('POST', { action: 'accept-initial', expectedRevision: 0, acceptance }));
    expect(initial.status).toBe(403);
    expect(storage.documents.size).toBe(0);
    expect(auth.requireVerifiedHealthConsentWrite).toHaveBeenCalledTimes(2);
  });

  it('maps a terminal erasure job conflict to 409 without retrying the worker', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    const jobPath = 'health_data_erasures/account-1';
    const job = storage.documents.get(jobPath)!;
    storage.documents.set(jobPath, { ...job, status: 'failed', retryable: false });

    const response = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toHaveProperty('error', expect.stringContaining('controllo'));
    expect(erasureWorker.process).not.toHaveBeenCalled();
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'withdrawn', revision: 1,
    });
    expect(storage.documents.get(jobPath)).toMatchObject({ status: 'failed', retryable: false });
  });

  it('confirms a durably queued withdrawal even if immediate erasure processing fails', async () => {
    erasureWorker.process.mockRejectedValueOnce(new Error('injected worker failure'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'withdrawn', revision: 1 });
      expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
        uid: 'account-1', status: 'requested', consentRevision: 1,
      });
      expect(errorLog).toHaveBeenCalledWith('[health-consent] erasure handoff failed', { kind: 'Error' });
    } finally {
      errorLog.mockRestore();
    }
  });

  it.each([
    ['missing JSON body', undefined],
    ['array JSON body', []],
    ['unknown action', { action: 'unknown' }],
    ['withdraw without revision', { action: 'withdraw' }],
    ['withdraw with fractional revision', { action: 'withdraw', expectedRevision: 0.5 }],
    ['withdraw with negative revision', { action: 'withdraw', expectedRevision: -1 }],
    ['withdraw with string revision', { action: 'withdraw', expectedRevision: '0' }],
    ['withdraw with unsafe revision', { action: 'withdraw', expectedRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ['reacceptance with zero revision', { action: 'reaccept', expectedRevision: 0, acceptance }],
    ['reacceptance with fractional revision', { action: 'reaccept', expectedRevision: 1.5, acceptance }],
    ['reacceptance with string revision', { action: 'reaccept', expectedRevision: '1', acceptance }],
    ['initial consent with incorrect revision', { action: 'accept-initial', expectedRevision: 1, acceptance }],
    ['reacceptance without revision', { action: 'reaccept', acceptance }],
  ])('rejects %s without changing consent or enqueuing erasure', async (_case, body) => {
    const response = await POST(req('POST', body));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(storage.documents.size).toBe(0);
    expect(erasureWorker.process).not.toHaveBeenCalled();
  });


  it.each([
    ['unknown action', { action: 'missing' }],
    ['invalid initial acceptance', { action: 'accept-initial', expectedRevision: 0, acceptance: null }],
    ['invalid initial revision', { action: 'accept-initial', expectedRevision: 1, acceptance }],
    ['invalid withdrawal revision', { action: 'withdraw', expectedRevision: -1 }],
    ['invalid reacceptance', { action: 'reaccept', expectedRevision: 1, acceptance: { ...acceptance, termsVersion: 'obsolete' } }],
  ])('rejects %s before App Check/Auth or Firestore work', async (_case, body) => {
    const response = await POST(req('POST', body));
    expect(response.status).toBe(400);
    expect(auth.verifyHealthConsentRequester).not.toHaveBeenCalled();
    expect(storage.documents.size).toBe(0);
    expect(erasureWorker.process).not.toHaveBeenCalled();
  });

  it.each([
    ['declared', new Request('https://backend.test/api/health-consent', {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app', 'content-length': '9000' },
    })],
    ['actual', req('POST', { action: 'withdraw', expectedRevision: 0, padding: 'x'.repeat(9_000) })],
  ])('rejects %s oversized body before consuming App Check or writing consent', async (_case, request) => {
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Richiesta di consenso troppo grande.' });
    expect(auth.verifyHealthConsentRequester).not.toHaveBeenCalled();
    expect(storage.documents.size).toBe(0);
    expect(erasureWorker.process).not.toHaveBeenCalled();
  });

  it('checks actual stream size rather than trusting a smaller declared length', async () => {
    const request = new Request('https://backend.test/api/health-consent', {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app', 'content-length': '1' },
      body: JSON.stringify({ action: 'withdraw', expectedRevision: 0, padding: 'z'.repeat(9_000) }),
    });
    expect((await POST(request)).status).toBe(413);
    expect(auth.verifyHealthConsentRequester).not.toHaveBeenCalled();
    expect(storage.documents.size).toBe(0);
  });

  it.each(['stalled', 'empty-chunk-then-stalled'] as const)(
    'refuses %s POST streams within the body deadline without changing consent',
    async scenario => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (scenario === 'empty-chunk-then-stalled') controller.enqueue(new Uint8Array(0));
          },
        });
        const request = new Request('https://backend.test/api/health-consent', {
          method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
          body: stream, duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        const pending = POST(request);
        await vi.advanceTimersByTimeAsync(2_100);
        const response = await pending;
        expect(response.status).toBe(408);
        expect(await response.json()).toEqual({ error: 'Lettura della richiesta scaduta. Riprova.' });
        expect(auth.verifyHealthConsentRequester).not.toHaveBeenCalled();
        expect(storage.documents.size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('bounds streams made solely of empty chunks without running consent transitions', async () => {
    const request = new Request('https://backend.test/api/health-consent', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 17; i++) controller.enqueue(new Uint8Array(0));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect((await POST(request)).status).toBe(408);
    expect(auth.verifyHealthConsentRequester).not.toHaveBeenCalled();
    expect(storage.documents.size).toBe(0);
  });

  it('accepts a valid consent instruction split across binary chunks', async () => {
    const raw = new TextEncoder().encode(JSON.stringify({ action: 'withdraw', expectedRevision: 0 }));
    const request = new Request('https://backend.test/api/health-consent', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(raw.subarray(0, 8));
          controller.enqueue(new Uint8Array(0));
          controller.enqueue(raw.subarray(8));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'withdrawn', revision: 1 });
    expect(auth.verifyHealthConsentRequester).toHaveBeenCalledTimes(1);
    expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
      uid: 'account-1', status: 'requested', consentRevision: 1,
    });
  });

  it('atomically queues health erasure with the withdrawal and keeps Auth/business data until the worker completes', async () => {
    const first = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'withdrawn', revision: 1 });
    expect(await recordHealthConsentWithdrawal('account-1', 0)).toEqual({ status: 'withdrawn', revision: 1 });
    const state = storage.documents.get('health_consent_withdrawals/account-1');
    expect(state).toMatchObject({ uid: 'account-1', revision: 1, status: 'withdrawn' });
    expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
      uid: 'account-1', status: 'requested', consentRevision: 1,
    });
    expect(storage.documents.size).toBe(2);
    expect(erasureWorker.process).toHaveBeenCalledWith('account-1', expect.any(Number));
  });

  it('rolls back consent withdrawal if erasure enqueue fails in the transaction', async () => {
    await recordInitialHealthConsentAcceptance('account-1', acceptance);
    transactionFixture.failErasureSetOnce = true;
    await expect(recordHealthConsentWithdrawal('account-1', 1))
      .rejects.toThrow('transactional erasure job');
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      status: 'active', revision: 1,
    });
    expect(storage.documents.has('health_data_erasures/account-1')).toBe(false);
    expect(await recordHealthConsentWithdrawal('account-1', 1)).toMatchObject({
      status: 'withdrawn', revision: 2,
    });
    expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
      status: 'requested', consentRevision: 2,
    });
  });

  it('rejects invalid and stale version acceptances while withdrawn', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    for (const invalid of [null, {}, { ...acceptance, acceptedHealthData: false }, { ...acceptance, privacyVersion: 'old' }]) {
      const response = await POST(req('POST', { action: 'reaccept', acceptance: invalid, expectedRevision: 1 }));
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty('error');
      expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
    }
  });

  it('reenables only after explicit acceptance; retry is idempotent and later revocation advances revision', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.set('users/account-1', { _schemaVersion: 1, _sync: { writer: { seq: 5 } }, legalConsent: { acceptedAt: 'old' } });
    expect(storage.documents.has('users/account-1')).toBe(true);
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1)).rejects.toThrow('revoca');
    finishErasure(1);
    const accepted = await recordHealthConsentReacceptance('account-1', acceptance, 2);
    expect(storage.documents.has('users/account-1')).toBe(false);
    expect(accepted).toMatchObject({ status: 'active', revision: 3, acceptedAt: expect.any(String) });
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 2)).toEqual(accepted);
    const retry = await POST(req('POST', { action: 'reaccept', expectedRevision: 2, acceptance }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(accepted);
    expect(await recordHealthConsentWithdrawal('account-1', 3)).toEqual({ status: 'withdrawn', revision: 4 });
    const staleSecondCycle = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(staleSecondCycle.status).toBe(409);
    expect(await readHealthConsentState('account-1')).toMatchObject({ status: 'withdrawn', revision: 4 });
    expect(await recordHealthConsentWithdrawal('account-1', 3)).toEqual({ status: 'withdrawn', revision: 4 });
  });

  it('will not resume or withdraw when account deletion has started', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.set('account_deletions/account-1', { status: 'requested' });
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1)).rejects.toThrow('Cancellazione');
    await expect(recordHealthConsentWithdrawal('account-1', 0)).rejects.toThrow('Cancellazione');
  });

  it('does not reaccept while a data-only erasure job is incomplete', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.set('health_data_erasures/account-1', { uid: 'account-1', status: 'deleting', consentRevision: 1 });
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1))
      .rejects.toThrow('revoca');
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');

    finishErasure(1);
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 2))
      .toMatchObject({ status: 'active', revision: 3 });
  });

  it('refuses reacceptance without a durable erasure generation even if the receipt is missing or marked complete', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.delete('health_data_erasures/account-1');
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1))
      .rejects.toBeInstanceOf(HealthConsentRevisionConflictError);

    storage.documents.set('health_data_erasures/account-1', {
      uid: 'account-1', status: 'complete', consentRevision: 1, completedRevision: 2,
    });
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1))
      .rejects.toBeInstanceOf(HealthConsentRevisionConflictError);
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
  });

  it('rejects a mismatched completed erasure receipt even with a valid consent floor', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    const path = 'health_data_erasures/account-1';
    const valid = storage.documents.get(path)!;
    for (const patch of [
      { uid: 'other-account' },
      { consentRevision: 0 },
      { completedRevision: 3 },
    ]) {
      storage.documents.set(path, { ...valid, ...patch });
      await expect(recordHealthConsentReacceptance('account-1', acceptance, 2))
        .rejects.toBeInstanceOf(HealthConsentRevisionConflictError);
      expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
    }
  });

  it('refuses re-consent if the old wrapped cloud key remains after a completed erasure', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    storage.documents.set('user_data_keys/account-1', { uid: 'account-1', ciphertext: 'orphaned-key' });

    const blocked = await POST(req('POST', { action: 'reaccept', expectedRevision: 2, acceptance }));
    expect(blocked.status).toBe(409);
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'withdrawn', revision: 2, erasedBeforeRevision: 1,
    });
    expect(storage.documents.get('user_data_keys/account-1')).toMatchObject({ ciphertext: 'orphaned-key' });

    storage.documents.delete('user_data_keys/account-1');
    const accepted = await POST(req('POST', { action: 'reaccept', expectedRevision: 2, acceptance }));
    expect(accepted.status).toBe(200);
    // A legitimate key provisioned under the new active consent must not
    // invalidate an idempotent retry of that already-confirmed acceptance.
    storage.documents.set('user_data_keys/account-1', { uid: 'account-1', ciphertext: 'new-key' });
    const retry = await POST(req('POST', { action: 'reaccept', expectedRevision: 2, acceptance }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await accepted.json());
  });

  it('accepts re-consent after completed receipt retention only with matching consent erasure proof', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    storage.documents.delete('health_data_erasures/account-1');
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 2))
      .toMatchObject({ status: 'active', revision: 3 });
  });

  it('cleanup erases only the specific account consent marker', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    await recordHealthConsentWithdrawal('account-2', 0);
    await adminDb().runTransaction(async tx => {
      removeHealthConsentStateForDeletedAccount('account-1', tx);
    });
    expect(storage.documents.has('health_consent_withdrawals/account-1')).toBe(false);
    expect(storage.documents.has('health_consent_withdrawals/account-2')).toBe(true);
  });

  it('enforces allowed origin before authenticated work', async () => {
    expect((await OPTIONS(req('OPTIONS', undefined, 'https://evil.example'))).status).toBe(403);
    expect((await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }, 'https://evil.example'))).status).toBe(403);
    expect(auth.verifyHealthConsentRequester).not.toHaveBeenCalled();
  });
});

describe('withdrawal revision concurrency', () => {
  beforeEach(() => { transactionFixture.retries = 0; transactionFixture.overlap = null; });
  it('retries overlapping withdrawals against the committed revision, not stale snapshots', async () => {
    storage.documents.clear();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    transactionFixture.overlap = { arrivals: 0, release, gate };
    const [first, second] = await Promise.all([
      recordHealthConsentWithdrawal('account-1', 0),
      recordHealthConsentWithdrawal('account-1', 0),
    ]);
    expect(transactionFixture.overlap.arrivals).toBe(2);
    expect(transactionFixture.retries).toBe(1);
    expect(first).toEqual({ status: 'withdrawn', revision: 1 });
    expect(second).toEqual(first);
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'withdrawn', revision: 1,
    });
    expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
      uid: 'account-1', status: 'requested', consentRevision: 1,
    });
    transactionFixture.overlap = null;
  });

  it('retries overlapping reacceptance against the winning consent revision', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    transactionFixture.overlap = { arrivals: 0, release, gate };
    const [first, second] = await Promise.all([
      recordHealthConsentReacceptance('account-1', acceptance, 2),
      recordHealthConsentReacceptance('account-1', acceptance, 2),
    ]);
    expect(transactionFixture.overlap.arrivals).toBe(2);
    expect(transactionFixture.retries).toBe(1);
    expect(first).toMatchObject({ status: 'active', revision: 3 });
    expect(second).toEqual(first);
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'active', revision: 3,
    });
    transactionFixture.overlap = null;
  });

  it('refuses a delayed revocation request after another device reaccepted', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    await recordHealthConsentReacceptance('account-1', acceptance, 2);
    const stale = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    expect((await readHealthConsentState('account-1')).status).toBe('active');
    expect(await recordHealthConsentWithdrawal('account-1', 3)).toEqual({ status: 'withdrawn', revision: 4 });
  });
});

describe('reacceptance compare-and-set', () => {
  it('refuses an old delayed acceptance after a later withdrawal', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    await recordHealthConsentReacceptance('account-1', acceptance, 2);
    await recordHealthConsentWithdrawal('account-1', 3);
    const response = await POST(req('POST', { action: 'reaccept', acceptance, expectedRevision: 1 }));
    expect(response.status).toBe(409);
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 4)).rejects.toThrow('revoca');
    finishErasure(4);
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 5)).toMatchObject({ status: 'active', revision: 6 });
  });
});


// New clients use the explicit server registration contract; legacy GET is
// retained only during the staged rollout before Rules enforce a record.
describe('trusted initial account health consent registration', () => {
  beforeEach(() => { storage.documents.clear(); vi.clearAllMocks(); });

  it('distinguishes unregistered users without disclosing anyone else\'s state', async () => {
    const request = new Request('https://backend.test/api/health-consent', {
      method: 'GET',
      headers: { origin: 'https://thelogbook.web.app', 'x-consent-contract': '2' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'unregistered', revision: 0 });
    expect(storage.documents.size).toBe(0);
  });

  it('accepts initial consent once, with server time, legal versions and owned UID', async () => {
    const response = await POST(req('POST', { action: 'accept-initial', expectedRevision: 0, acceptance }));
    expect(response.status).toBe(200);
    const value = await response.json() as { status: string; revision: number; acceptedAt: string };
    expect(value).toMatchObject({ status: 'active', revision: 1, acceptedAt: expect.any(String) });
    const record = storage.documents.get('health_consent_withdrawals/account-1');
    expect(record).toMatchObject({ uid: 'account-1', status: 'active', revision: 1,
      privacyVersion: acceptance.privacyVersion, termsVersion: acceptance.termsVersion,
      acceptedAt: value.acceptedAt });
    expect(await recordInitialHealthConsentAcceptance('account-1', acceptance)).toEqual(value);
    const retry = await POST(req('POST', { action: 'accept-initial', expectedRevision: 0, acceptance }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(value);
    expect(await readHealthConsentState('account-1')).toMatchObject({ status: 'active', revision: 1,
      acceptedAt: value.acceptedAt, privacyVersion: acceptance.privacyVersion, termsVersion: acceptance.termsVersion });
    expect(storage.documents.size).toBe(1);
  });

  it('rejects forged/incomplete acceptance, deletion, withdrawal and an old registration replay', async () => {
    for (const a of [null, {}, { ...acceptance, acceptedHealthData: false }, { ...acceptance, termsVersion: 'old' }]) {
      const response = await POST(req('POST', { action: 'accept-initial', expectedRevision: 0, acceptance: a }));
      expect(response.status).toBe(400);
    }
    storage.documents.set('account_deletions/account-1', { status: 'requested' });
    await expect(recordInitialHealthConsentAcceptance('account-1', acceptance)).rejects.toThrow('Cancellazione');
    storage.documents.delete('account_deletions/account-1');
    await recordInitialHealthConsentAcceptance('account-1', acceptance);
    expect(await recordHealthConsentWithdrawal('account-1', 1)).toEqual({ status: 'withdrawn', revision: 2 });
    const stale = await POST(req('POST', { action: 'accept-initial', expectedRevision: 0, acceptance }));
    expect(stale.status).toBe(409);
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
  });

  it('does not allow account-specific fields to choose the owner instead of the verified token', async () => {
    const response = await POST(req('POST', { action: 'accept-initial', uid: 'other', expectedRevision: 0, acceptance }));
    expect(response.status).toBe(200);
    expect(storage.documents.has('health_consent_withdrawals/other')).toBe(false);
    expect(storage.documents.has('health_consent_withdrawals/account-1')).toBe(true);
  });
});
