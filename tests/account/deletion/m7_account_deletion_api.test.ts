import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  verifyDeletionRequester: vi.fn(),
  verifyStatusAppCheck: vi.fn(),
  RequestAuthError: class RequestAuthError extends Error {
    constructor(message: string, public readonly status: 401 | 403 = 401) {
      super(message);
      this.name = 'RequestAuthError';
    }
  },
}));

const store = vi.hoisted(() => ({
  createOrRefreshDeletionJob: vi.fn(),
  readAuthorizedDeletionJob: vi.fn(),
  readDeletionStatus: vi.fn(),
  validateReceipt: vi.fn(),
  validateUid: vi.fn(),
}));

const runner = vi.hoisted(() => ({
  processAccountDeletion: vi.fn(),
  progressAndReadStatus: vi.fn(),
}));

vi.mock('../../../server/accountDeletion/httpAuth', () => auth);
vi.mock('../../../server/accountDeletion/jobStore', () => store);
vi.mock('../../../server/accountDeletion/runner', () => runner);

import { GET, POST } from '../../../api/account-deletion';
import {
  ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
  ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS,
} from '../../../server/accountDeletion/budget';

function request(method: 'GET' | 'POST', body?: unknown): Request {
  return new Request('https://example.test/api/account-deletion', {
    method,
    headers: {
      'origin': 'https://thelogbook.web.app',
      'content-type': 'application/json',
      'x-account-deletion-uid': 'u',
      'x-account-deletion-receipt': 'receipt',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('M7 native account deletion HTTP boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyDeletionRequester.mockResolvedValue({ uid: 'u' });
    auth.verifyStatusAppCheck.mockResolvedValue(undefined);
    store.validateUid.mockImplementation(value => String(value));
    store.validateReceipt.mockImplementation(value => {
      if (value !== 'receipt') throw new Error('Ricevuta di cancellazione non valida.');
      return 'receipt';
    });
    store.createOrRefreshDeletionJob.mockResolvedValue(undefined);
    store.readAuthorizedDeletionJob.mockResolvedValue({ uid: 'u', status: 'requested' });
    store.readDeletionStatus.mockResolvedValue({ uid: 'u', status: 'deleting', attempts: 1 });
    runner.processAccountDeletion.mockResolvedValue('pending');
    runner.progressAndReadStatus.mockResolvedValue({ uid: 'u', status: 'deleting', attempts: 1 });
  });

  it('rejects the retired Vercel frontend origin after cutover', async () => {
    const legacy = new Request('https://example.test/api/account-deletion', {
      method: 'POST',
      headers: { origin: 'https://logbook-gnf.vercel.app', 'content-type': 'application/json' },
      body: JSON.stringify({ receiptToken: 'receipt' }),
    });
    const response = await POST(legacy);
    expect(response.status).toBe(403);
    expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects cross-origin callers outside the configured exact origins before auth', async () => {
    const bad = new Request('https://example.test/api/account-deletion', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ receiptToken: 'receipt' }),
    });
    const response = await POST(bad);
    expect(response.status).toBe(403);
    expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each(['{not-json', '', 'null', '[]', '"receipt"', 'true'])(
    'returns 400 for malformed or non-object JSON without creating a deletion job: %s',
    async raw => {
      const response = await POST(new Request('https://example.test/api/account-deletion', {
        method: 'POST',
        headers: { origin: 'https://thelogbook.web.app', 'content-type': 'application/json' },
        body: raw,
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Corpo JSON non valido.' });
      expect(store.createOrRefreshDeletionJob).not.toHaveBeenCalled();
      expect(runner.processAccountDeletion).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it('reports a failed request body stream as a backend failure, never as malformed input', async () => {
    const input = new Request('https://example.test/api/account-deletion', {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        pull() { throw new TypeError('sensitive stream failure detail'); },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await POST(input);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'Servizio di cancellazione temporaneamente non disponibile. La copia locale è stata conservata.',
      });
      expect(log).toHaveBeenCalledWith('[account-deletion] backend failure', { kind: 'TypeError' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive stream failure detail');
      expect(store.createOrRefreshDeletionJob).not.toHaveBeenCalled();
      expect(runner.processAccountDeletion).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally {
      log.mockRestore();
    }
  });

  it('rejects oversized and malformed Content-Length before costly authentication', async () => {
    for (const length of ['8193', 'invalid']) {
      const input = new Request('https://example.test/api/account-deletion', {
        method: 'POST',
        headers: { origin: 'https://thelogbook.web.app', 'content-length': length },
        body: JSON.stringify({ receiptToken: 'receipt' }),
      });
      const response = await POST(input);
      expect(response.status).toBe(length === '8193' ? 413 : 400);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
    expect(store.createOrRefreshDeletionJob).not.toHaveBeenCalled();
  });

  it('bounds the streamed body even when Content-Length is absent or dishonest', async () => {
    for (const contentLength of [null, '2']) {
      const response = await POST(new Request('https://example.test/api/account-deletion', {
        method: 'POST',
        headers: {
          origin: 'https://thelogbook.web.app',
          ...(contentLength === null ? {} : { 'content-length': contentLength }),
        },
        body: 'x'.repeat(8193),
      }));
      expect(response.status).toBe(413);
      expect(store.createOrRefreshDeletionJob).not.toHaveBeenCalled();
    }
  });

  it('prevents caching of successful, absent and rejected owner-specific responses', async () => {
    const accepted = await POST(request('POST', { receiptToken: 'receipt' }));
    const pending = await GET(request('GET'));
    runner.progressAndReadStatus.mockResolvedValueOnce({ uid: 'u', status: 'complete', attempts: 2 });
    const complete = await GET(request('GET'));
    store.readAuthorizedDeletionJob.mockResolvedValueOnce(null);
    const missing = await GET(request('GET'));
    const invalid = await POST(request('POST', { receiptToken: 'bad' }));
    auth.verifyStatusAppCheck.mockRejectedValueOnce(new auth.RequestAuthError('App Check invalid.', 403));
    const denied = await GET(request('GET'));

    expect([accepted.status, pending.status, complete.status, missing.status, invalid.status, denied.status])
      .toEqual([202, 200, 200, 404, 400, 403]);
    for (const response of [accepted, pending, complete, missing, invalid, denied]) {
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('rejects malformed deletion status selectors before consuming App Check or reading jobs', async () => {
    store.validateUid.mockImplementationOnce(() => { throw new Error('Identificativo account non valido.'); });
    const invalidUid = await GET(request('GET'));
    expect(invalidUid.status).toBe(400);
    expect(auth.verifyStatusAppCheck).not.toHaveBeenCalled();

    const invalidReceipt = await GET(new Request('https://example.test/api/account-deletion', {
      method: 'GET',
      headers: {
        origin: 'https://thelogbook.web.app',
        'x-account-deletion-uid': 'u',
        'x-account-deletion-receipt': 'invalid',
      },
    }));
    expect(invalidReceipt.status).toBe(400);
    expect(auth.verifyStatusAppCheck).not.toHaveBeenCalled();
    expect(store.readAuthorizedDeletionJob).not.toHaveBeenCalled();
    expect(runner.progressAndReadStatus).not.toHaveBeenCalled();
  });

  it('returns 400 only for malformed client input', async () => {
    const response = await POST(request('POST', { receiptToken: 'bad' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Ricevuta di cancellazione non valida.' });
    expect(store.createOrRefreshDeletionJob).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking backend error details after validated input', async () => {
    store.createOrRefreshDeletionJob.mockRejectedValueOnce(new Error('firestore unavailable for athlete@example.test with sensitive-marker'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(request('POST', { receiptToken: 'receipt' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('temporaneamente non disponibile') });
    expect(consoleError).toHaveBeenCalledWith('[account-deletion] backend failure', { kind: 'Error' });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('athlete@example.test');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sensitive-marker');
    consoleError.mockRestore();
  });

  it('accepts a valid POST, starts inline processing, and returns the persisted status', async () => {
    const response = await POST(request('POST', { receiptToken: 'receipt' }));
    expect(response.status).toBe(202);
    expect(store.createOrRefreshDeletionJob).toHaveBeenCalledWith('u', 'receipt');
    expect(runner.processAccountDeletion).toHaveBeenCalledWith(
      'u',
      expect.any(Number),
      { safetyBufferMs: ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS },
    );
    expect(await response.json()).toMatchObject({ uid: 'u', status: 'deleting' });
  });

  it('uses a five-second interactive budget with runner headroom smaller than that budget', async () => {
    expect(ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS).toBeLessThan(ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS);
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    try {
      await POST(request('POST', { receiptToken: 'receipt' }));
      await GET(request('GET'));

      expect(runner.processAccountDeletion).toHaveBeenCalledWith(
        'u',
        100_000 + ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
        { safetyBufferMs: ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS },
      );
      expect(runner.progressAndReadStatus).toHaveBeenCalledWith(
        'u',
        'receipt',
        100_000 + ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
        { safetyBufferMs: ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS },
      );
    } finally {
      now.mockRestore();
    }
  });

  it('progresses an authorized incomplete job during GET polling', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(auth.verifyStatusAppCheck).toHaveBeenCalledTimes(1);
    expect(store.readAuthorizedDeletionJob).toHaveBeenCalledWith('u', 'receipt');
    expect(runner.progressAndReadStatus).toHaveBeenCalledWith(
      'u',
      'receipt',
      expect.any(Number),
      { safetyBufferMs: ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS },
    );
  });
});
