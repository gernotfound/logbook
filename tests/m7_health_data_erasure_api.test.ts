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
    vi.clearAllMocks();
    auth.verifyDeletionRequester.mockResolvedValue({ uid: 'owner-A' });
    auth.verifyRecoveryRegistrationRequester.mockResolvedValue({ uid: 'owner-A' });
    erasure.processHealthDataErasure.mockResolvedValue('complete');
    erasure.readHealthDataErasureStatus.mockResolvedValue({ status: 'complete', complete: true });
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
