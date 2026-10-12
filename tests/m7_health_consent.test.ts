import { beforeEach, describe, expect, it, vi } from 'vitest';

type Stored = Record<string, unknown>;
const storage = vi.hoisted(() => ({ documents: new Map<string, Stored>() }));
const auth = vi.hoisted(() => ({
  verifyRecoveryRegistrationRequester: vi.fn(async () => ({ uid: 'account-1' })),
  RequestAuthError: class RequestAuthError extends Error {
    constructor(message: string, public readonly status: 401 | 403 = 401) {
      super(message);
    }
  },
}));

vi.mock('../server/accountDeletion/httpAuth', () => auth);
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
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
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      get: (ref: { key: string }) => {
        const item = storage.documents.get(ref.key);
        return Promise.resolve({ exists: !!item, data: () => item });
      },
      create: (ref: { key: string }, data: Stored) => {
        if (storage.documents.has(ref.key)) throw new Error('Already exists');
        storage.documents.set(ref.key, data);
      },
      update: (ref: { key: string }, data: Stored) => {
        const old = storage.documents.get(ref.key);
        if (!old) throw new Error('Not found');
        storage.documents.set(ref.key, { ...old, ...data });
      },
    }),
  }),
}));

import { GET, OPTIONS, POST } from '../api/health-consent';
import {
  readHealthConsentState, recordHealthConsentWithdrawal,
  recordHealthConsentReacceptance, removeHealthConsentStateForDeletedAccount,
} from '../server/healthConsent/withdrawal';

function req(method: 'GET' | 'POST' | 'OPTIONS', body?: unknown, origin = 'https://thelogbook.web.app'): Request {
  return new Request('https://backend.test/api/health-consent', {
    method, headers: { origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const acceptance = {
  acceptedTerms: true as const, acceptedHealthData: true as const,
  privacyVersion: '1.3.2', termsVersion: '1.2.0',
};

describe('trusted health consent boundary', () => {
  beforeEach(() => { storage.documents.clear(); vi.clearAllMocks(); });

  it('does not expose records as personal business documents before withdrawal', async () => {
    expect(await readHealthConsentState('account-1')).toEqual({ status: 'active', revision: 0 });
    const response = await GET(req('GET'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'active', revision: 0 });
    expect(auth.verifyRecoveryRegistrationRequester).toHaveBeenCalledTimes(1);
  });

  it('records withdrawal idempotently, monotonically and keeps the data intact', async () => {
    const first = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'withdrawn', revision: 1 });
    expect(await recordHealthConsentWithdrawal('account-1', 0)).toEqual({ status: 'withdrawn', revision: 1 });
    const state = storage.documents.get('health_consent_withdrawals/account-1');
    expect(state).toMatchObject({ uid: 'account-1', revision: 1, status: 'withdrawn' });
    expect(storage.documents.size).toBe(1);
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
    const accepted = await recordHealthConsentReacceptance('account-1', acceptance, 1);
    expect(accepted).toMatchObject({ status: 'active', revision: 2, acceptedAt: expect.any(String) });
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 1)).toEqual(accepted);
    expect(await recordHealthConsentWithdrawal('account-1', 2)).toEqual({ status: 'withdrawn', revision: 3 });
  });

  it('will not resume or withdraw when account deletion has started', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.set('account_deletions/account-1', { status: 'requested' });
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1)).rejects.toThrow('Cancellazione');
    await expect(recordHealthConsentWithdrawal('account-1', 0)).rejects.toThrow('Cancellazione');
  });

  it('cleanup erases only the specific account consent marker', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    await recordHealthConsentWithdrawal('account-2', 0);
    await removeHealthConsentStateForDeletedAccount('account-1');
    expect(storage.documents.has('health_consent_withdrawals/account-1')).toBe(false);
    expect(storage.documents.has('health_consent_withdrawals/account-2')).toBe(true);
  });

  it('enforces allowed origin before authenticated work', async () => {
    expect((await OPTIONS(req('OPTIONS', undefined, 'https://evil.example'))).status).toBe(403);
    expect((await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }, 'https://evil.example'))).status).toBe(403);
    expect(auth.verifyRecoveryRegistrationRequester).not.toHaveBeenCalled();
  });
});

describe('withdrawal revision concurrency', () => {
  it('refuses a delayed revocation request after another device reaccepted', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    await recordHealthConsentReacceptance('account-1', acceptance, 1);
    const stale = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    expect((await readHealthConsentState('account-1')).status).toBe('active');
    expect(await recordHealthConsentWithdrawal('account-1', 2)).toEqual({ status: 'withdrawn', revision: 3 });
  });
});

describe('reacceptance compare-and-set', () => {
  it('refuses an old delayed acceptance after a later withdrawal', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    await recordHealthConsentReacceptance('account-1', acceptance, 1);
    await recordHealthConsentWithdrawal('account-1', 2);
    const response = await POST(req('POST', { action: 'reaccept', acceptance, expectedRevision: 1 }));
    expect(response.status).toBe(409);
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 3)).toMatchObject({ status: 'active', revision: 4 });
  });
});
