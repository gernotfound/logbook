import { describe, expect, it, vi } from 'vitest';
import type { HealthConsentTestContext } from './m7_health_consent.test';

export function registerConsentHttpCases({
  GET, OPTIONS, POST, auth, acceptance, erasureWorker, req, storage,
  readHealthConsentState, recordInitialHealthConsentAcceptance,
  recordHealthConsentWithdrawal,
}: HealthConsentTestContext): void {
  describe('HTTP input validation and verified initial registration', () => {
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

  it('enforces allowed origin before authenticated work', async () => {
    expect((await OPTIONS(req('OPTIONS', undefined, 'https://evil.example'))).status).toBe(403);
    expect((await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }, 'https://evil.example'))).status).toBe(403);
    expect(auth.verifyHealthConsentRequester).not.toHaveBeenCalled();
  });

  describe('trusted initial account health consent registration', () => {
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
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'active', revision: 1,
      privacyVersion: acceptance.privacyVersion,
      termsVersion: acceptance.termsVersion,
    });
    expect(auth.verifyHealthConsentRequester).toHaveBeenCalledTimes(1);
  });
  });
  });
}
