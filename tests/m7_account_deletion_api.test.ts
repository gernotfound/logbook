import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  verifyAuthenticatedRequester: vi.fn(),
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
  readDeletionStatusWithRecoveryCredential: vi.fn(),
  registerDeletionRecoveryCredential: vi.fn(),
  validateReceipt: vi.fn(),
  validateRecoveryCredential: vi.fn(),
  validateUid: vi.fn(),
}));

const runner = vi.hoisted(() => ({
  processAccountDeletion: vi.fn(),
  progressAndReadStatus: vi.fn(),
}));

vi.mock('../functions/src/accountDeletion/httpAuth', () => auth);
vi.mock('../functions/src/accountDeletion/jobStore', () => store);
vi.mock('../functions/src/accountDeletion/runner', () => runner);

import {
  handleAccountDeletionGet,
  handleAccountDeletionPost,
  handleAccountDeletionPut,
} from '../functions/src/accountDeletion/http';

function request(
  method: 'GET' | 'POST' | 'PUT',
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://example.test/accountDeletion', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-account-deletion-uid': 'u',
      ...(method === 'GET' ? { 'x-account-deletion-receipt': 'receipt' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('M7 Firebase account deletion HTTP boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyAuthenticatedRequester.mockResolvedValue({ uid: 'u' });
    auth.verifyDeletionRequester.mockResolvedValue({ uid: 'u' });
    auth.verifyStatusAppCheck.mockResolvedValue(undefined);
    store.validateUid.mockImplementation(value => String(value));
    store.validateReceipt.mockImplementation(value => {
      if (value !== 'receipt') throw new Error('Ricevuta di cancellazione non valida.');
      return 'receipt';
    });
    store.validateRecoveryCredential.mockImplementation(value => {
      if (value !== 'recovery') throw new Error('Credenziale di recovery non valida.');
      return 'recovery';
    });
    store.createOrRefreshDeletionJob.mockResolvedValue(undefined);
    store.registerDeletionRecoveryCredential.mockResolvedValue(undefined);
    store.readAuthorizedDeletionJob.mockResolvedValue({ uid: 'u', status: 'requested' });
    store.readDeletionStatus.mockResolvedValue({ uid: 'u', status: 'deleting', attempts: 1 });
    store.readDeletionStatusWithRecoveryCredential.mockResolvedValue({ uid: 'u', status: 'complete', attempts: 2 });
    runner.processAccountDeletion.mockResolvedValue('pending');
    runner.progressAndReadStatus.mockResolvedValue({ uid: 'u', status: 'deleting', attempts: 1 });
  });

  it('returns 400 only for malformed client input', async () => {
    const response = await handleAccountDeletionPost(request('POST', { receiptToken: 'bad' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Ricevuta di cancellazione non valida.' });
    expect(store.createOrRefreshDeletionJob).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking backend error details after validated input', async () => {
    store.createOrRefreshDeletionJob.mockRejectedValueOnce(
      new Error('firestore unavailable for athlete@example.test with sensitive-marker'),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handleAccountDeletionPost(request('POST', { receiptToken: 'receipt' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('temporaneamente non disponibile') });
    expect(consoleError).toHaveBeenCalledWith('[account-deletion] backend failure', { kind: 'Error' });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('athlete@example.test');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sensitive-marker');
    consoleError.mockRestore();
  });

  it('accepts a valid POST, starts inline processing, and returns the persisted status', async () => {
    const response = await handleAccountDeletionPost(request('POST', { receiptToken: 'receipt' }));
    expect(response.status).toBe(202);
    expect(store.createOrRefreshDeletionJob).toHaveBeenCalledWith('u', 'receipt');
    expect(runner.processAccountDeletion).toHaveBeenCalledWith('u', expect.any(Number));
    expect(await response.json()).toMatchObject({ uid: 'u', status: 'deleting' });
  });

  it('preregisters a device recovery credential without starting deletion', async () => {
    const response = await handleAccountDeletionPut(request('PUT', { recoveryCredential: 'recovery' }));

    expect(response.status).toBe(204);
    expect(auth.verifyAuthenticatedRequester).toHaveBeenCalledTimes(1);
    expect(store.registerDeletionRecoveryCredential).toHaveBeenCalledWith('u', 'recovery');
    expect(store.createOrRefreshDeletionJob).not.toHaveBeenCalled();
    expect(runner.processAccountDeletion).not.toHaveBeenCalled();
  });

  it('progresses an authorized incomplete job during receipt GET polling', async () => {
    const response = await handleAccountDeletionGet(request('GET'));
    expect(response.status).toBe(200);
    expect(auth.verifyStatusAppCheck).toHaveBeenCalledTimes(1);
    expect(store.readAuthorizedDeletionJob).toHaveBeenCalledWith('u', 'receipt');
    expect(runner.progressAndReadStatus).toHaveBeenCalledWith('u', 'receipt', expect.any(Number));
  });

  it('uses preregistered recovery as proof-only status access and never advances deletion', async () => {
    const response = await handleAccountDeletionGet(request('GET', undefined, {
      'x-account-deletion-receipt': '',
      'x-account-deletion-recovery': 'recovery',
    }));

    expect(response.status).toBe(200);
    expect(store.readDeletionStatusWithRecoveryCredential).toHaveBeenCalledWith('u', 'recovery');
    expect(store.readAuthorizedDeletionJob).not.toHaveBeenCalled();
    expect(runner.progressAndReadStatus).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ uid: 'u', status: 'complete' });
  });

  it('rejects ambiguous GET proof headers', async () => {
    const response = await handleAccountDeletionGet(request('GET', undefined, {
      'x-account-deletion-recovery': 'recovery',
    }));
    expect(response.status).toBe(400);
    expect(runner.progressAndReadStatus).not.toHaveBeenCalled();
  });
});
