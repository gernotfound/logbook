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

vi.mock('../server/accountDeletion/httpAuth', () => auth);
vi.mock('../server/accountDeletion/jobStore', () => store);
vi.mock('../server/accountDeletion/runner', () => runner);

import { GET, POST } from '../api/account-deletion';

function request(method: 'GET' | 'POST', body?: unknown): Request {
  return new Request('https://example.test/api/account-deletion', {
    method,
    headers: {
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
    expect(runner.processAccountDeletion).toHaveBeenCalledWith('u', expect.any(Number));
    expect(await response.json()).toMatchObject({ uid: 'u', status: 'deleting' });
  });

  it('progresses an authorized incomplete job during GET polling', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(auth.verifyStatusAppCheck).toHaveBeenCalledTimes(1);
    expect(store.readAuthorizedDeletionJob).toHaveBeenCalledWith('u', 'receipt');
    expect(runner.progressAndReadStatus).toHaveBeenCalledWith('u', 'receipt', expect.any(Number));
  });
});
