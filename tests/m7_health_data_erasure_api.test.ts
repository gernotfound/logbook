import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  verifyDeletionRequester: vi.fn(),
  verifyRecoveryRegistrationRequester: vi.fn(),
}));
const erasure = vi.hoisted(() => ({
  createHealthDataErasureJob: vi.fn(),
  processHealthDataErasure: vi.fn(),
  readHealthDataErasureStatus: vi.fn(),
  HealthDataErasureConflict: class HealthDataErasureConflict extends Error {},
}));

vi.mock('../server/accountDeletion/httpAuth', () => ({
  ...auth, RequestAuthError: class RequestAuthError extends Error { constructor(message: string, public status: number = 401) { super(message); } },
}));
vi.mock('../server/healthConsent/erasure', () => erasure);

import { GET, POST, OPTIONS } from '../api/health-data-erasure';

const request = (method: string) => new Request('https://backend.example/api/health-data-erasure', {
  method,
  headers: { origin: 'https://thelogbook.web.app' },
});

describe('data-only erasure trusted API', () => {
  beforeEach(() => {
    // Mock implementations queued in one test must not leak to the next.
    vi.resetAllMocks();
    auth.verifyDeletionRequester.mockResolvedValue({ uid: 'owner-A' });
    auth.verifyRecoveryRegistrationRequester.mockResolvedValue({ uid: 'owner-A' });
    erasure.processHealthDataErasure.mockResolvedValue('complete');
    erasure.readHealthDataErasureStatus.mockResolvedValue({
      status: 'complete', complete: true, localPurgeAuthorized: true,
    });
  });

  it.each([
    ['unexpected query', 'https://backend.example/api/health-data-erasure?uid=other'],
    ['duplicate query', 'https://backend.example/api/health-data-erasure?token=a&token=b'],
  ])('rejects %s before authentication or job creation', async (_name, url) => {
    const response = await POST(new Request(url, { method: 'POST', headers: { origin: 'https://thelogbook.web.app' } }));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
    expect(erasure.createHealthDataErasureJob).not.toHaveBeenCalled();
  });

  it('rejects an unexpected POST payload before starting an irreversible job', async () => {
    for (const value of ['{"action":"purge"}', 'x']) {
      const response = await POST(new Request('https://backend.example/api/health-data-erasure', {
        method: 'POST', headers: { origin: 'https://thelogbook.web.app' }, body: value,
      }));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'La cancellazione non accetta dati da inviare.' });
    }
    const declared = await POST(new Request('https://backend.example/api/health-data-erasure', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app', 'content-length': '9000' },
    }));
    expect(declared.status).toBe(400);
    expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
    expect(erasure.createHealthDataErasureJob).not.toHaveBeenCalled();
    expect(erasure.processHealthDataErasure).not.toHaveBeenCalled();
  });

  it.each(['stalled', 'empty-chunk-then-stalled'] as const)(
    'rejects %s POST streams without consuming App Check or creating a job',
    async scenario => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const request = new Request('https://backend.example/api/health-data-erasure', {
          method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              if (scenario === 'empty-chunk-then-stalled') controller.enqueue(new Uint8Array(0));
            },
          }),
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        const pending = POST(request);
        await vi.advanceTimersByTimeAsync(2_100);
        const response = await pending;
        expect(response.status).toBe(408);
        expect(await response.json()).toEqual({ error: 'Lettura della richiesta scaduta. Riprova.' });
        expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
        expect(erasure.createHealthDataErasureJob).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('accepts a bodyless streamed POST from an HTTP adapter', async () => {
    const response = await POST(new Request('https://backend.example/api/health-data-erasure', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(0));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }));
    expect(response.status).toBe(200);
    expect(erasure.createHealthDataErasureJob).toHaveBeenCalledWith('owner-A');
  });

  it('delegates destructive-job authorization to the recent-Auth/App Check verifier before creating the job', async () => {
    auth.verifyDeletionRequester.mockRejectedValueOnce(new Error('Authentication failed'));
    const denied = await POST(request('POST'));
    expect(denied.status).toBe(503);
    expect(erasure.createHealthDataErasureJob).not.toHaveBeenCalled();

    const result = await POST(request('POST'));
    expect(result.status).toBe(200);
    expect(erasure.createHealthDataErasureJob).toHaveBeenCalledWith('owner-A');
    expect(erasure.processHealthDataErasure).toHaveBeenCalledWith('owner-A', expect.any(Number));
    expect(auth.verifyDeletionRequester).toHaveBeenCalledTimes(2);
    expect(auth.verifyRecoveryRegistrationRequester).not.toHaveBeenCalled();
  });

  it('does not declare completion when erasure is queued or partially failed', async () => {
    erasure.readHealthDataErasureStatus.mockResolvedValueOnce({ status: 'deleting', complete: false });
    expect((await POST(request('POST'))).status).toBe(202);
    erasure.readHealthDataErasureStatus.mockResolvedValueOnce({
      status: 'failed', complete: false, retryable: false,
    });
    expect((await POST(request('POST'))).status).toBe(202);
  });

  it.each(['POST', 'GET'] as const)(
    'never advertises HTTP completion on %s without the trusted purge proof',
    async method => {
      erasure.readHealthDataErasureStatus.mockResolvedValue({
        status: 'complete', complete: true, localPurgeAuthorized: false,
      });
      const response = method === 'POST' ? await POST(request(method)) : await GET(request(method));
      expect(response.status).toBe(409);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
      if (method === 'GET') expect(erasure.processHealthDataErasure).not.toHaveBeenCalled();
    },
  );

  it('rejects a receipt that disappears between GET reads rather than returning 202 null', async () => {
    erasure.readHealthDataErasureStatus
      .mockResolvedValueOnce({ status: 'deleting', complete: false, localPurgeAuthorized: false })
      .mockResolvedValueOnce(null);
    erasure.processHealthDataErasure.mockResolvedValueOnce('pending');

    const response = await GET(request('GET'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(erasure.readHealthDataErasureStatus).toHaveBeenCalledTimes(2);
    expect(erasure.processHealthDataErasure).toHaveBeenCalledWith('owner-A', expect.any(Number));
  });

  it('returns an explicit not-requested status without starting a destructive worker', async () => {
    erasure.readHealthDataErasureStatus.mockResolvedValueOnce(null);
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'not-requested', complete: false });
    expect(erasure.processHealthDataErasure).not.toHaveBeenCalled();
    expect(erasure.readHealthDataErasureStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 'failed', retryable: false, expectedProcess: false },
    { status: 'failed', retryable: true, expectedProcess: true },
    { status: 'deleting', retryable: undefined, expectedProcess: true },
  ])('preserves pending/failed state and recovery semantics for $status retryable=$retryable',
    async ({ status, retryable, expectedProcess }) => {
      erasure.readHealthDataErasureStatus.mockResolvedValue({
        status, complete: false, localPurgeAuthorized: false,
        ...(retryable === undefined ? {} : { retryable }),
      });
      if (expectedProcess) erasure.processHealthDataErasure.mockResolvedValueOnce('busy');
      const response = await GET(request('GET'));
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ status, complete: false });
      expect(erasure.processHealthDataErasure).toHaveBeenCalledTimes(expectedProcess ? 1 : 0);
    },
  );

  it('does not report completion when a worker fails after the request was durably queued', async () => {
    erasure.processHealthDataErasure.mockRejectedValueOnce(new Error('provider-internal-private'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request('POST'));
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain('provider-internal-private');
      expect(erasure.createHealthDataErasureJob).toHaveBeenCalledWith('owner-A');
      expect(erasure.readHealthDataErasureStatus).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('authenticates status GET independently and never accepts a caller UID', async () => {
    const response = await GET(new Request('https://backend.example/api/health-data-erasure?uid=victim', {
      headers: { origin: 'https://thelogbook.web.app' },
    }));
    expect(response.status).toBe(200);
    expect(erasure.readHealthDataErasureStatus).toHaveBeenCalledWith('owner-A');
    expect(auth.verifyRecoveryRegistrationRequester).toHaveBeenCalledTimes(1);
  });

  it('rejects disallowed origins through the real CORS boundary before authenticating or reading data', async () => {
    const untrustedRequest = (method: string) => new Request('https://backend.example/api/health-data-erasure', {
      method, headers: { origin: 'https://attacker.example' },
    });
    for (const handler of [POST, GET, OPTIONS]) {
      const method = handler === POST ? 'POST' : handler === GET ? 'GET' : 'OPTIONS';
      const response = await handler(untrustedRequest(method));
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
    expect(auth.verifyRecoveryRegistrationRequester).not.toHaveBeenCalled();
    expect(erasure.createHealthDataErasureJob).not.toHaveBeenCalled();
    expect(erasure.readHealthDataErasureStatus).not.toHaveBeenCalled();
  });

  it('advertises real CORS headers for the permitted preflight without invoking erasure', async () => {
    const response = await OPTIONS(request('OPTIONS'));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://thelogbook.web.app');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-firebase-appcheck');
    expect(erasure.createHealthDataErasureJob).not.toHaveBeenCalled();
  });
});
