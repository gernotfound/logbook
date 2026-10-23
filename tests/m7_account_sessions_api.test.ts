import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ verifyDeletionRequester: vi.fn() }));
const sessions = vi.hoisted(() => ({ revokeAllUserSessions: vi.fn() }));

vi.mock('../server/accountDeletion/httpAuth', () => {
  class RequestAuthError extends Error {
    constructor(message: string, readonly status: 401 | 403 = 401) { super(message); }
  }
  return { RequestAuthError, verifyDeletionRequester: auth.verifyDeletionRequester };
});
vi.mock('../server/accountDeletion/sessionRevocation', () => sessions);

import { OPTIONS, POST } from '../api/account-sessions';
import { RequestAuthError } from '../server/accountDeletion/httpAuth';

function request(origin = 'https://thelogbook.web.app', method = 'POST'): Request {
  return new Request('https://logbook-gnf.vercel.app/api/account-sessions', {
    method,
    headers: {
      origin,
      authorization: 'Bearer id-token',
      'x-firebase-appcheck': 'limited-use-app-check',
    },
  });
}

describe('global session revocation API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyDeletionRequester.mockResolvedValue({ uid: 'verified-uid' });
    sessions.revokeAllUserSessions.mockResolvedValue(undefined);
  });

  it('derives the owner from the upstream verified requester and dispatches only that UID', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'revoked' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(auth.verifyDeletionRequester).toHaveBeenCalledTimes(1);
    expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith('verified-uid');
  });

  it('rejects requests from an unapproved origin before token validation', async () => {
    const response = await POST(request('https://attacker.example'));
    expect(response.status).toBe(403);
    expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
    expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked or expired token', 401],
    ['rejected App Check token', 403],
  ] as const)('preserves the %s rejection status without revoking sessions', async (_reason, status) => {
    auth.verifyDeletionRequester.mockRejectedValueOnce(new RequestAuthError('Authentication rejected', status));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
  });

  it('does not advertise success after an ambiguous revocation backend failure', async () => {
    sessions.revokeAllUserSessions.mockRejectedValueOnce(new Error('Internal Firebase Admin details'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Revoca non confermata. Potrebbe essere stata eseguita; rieffettua l’accesso per verificare.',
    });
  });

  it('exposes a strict CORS preflight only to the authorized app origin', async () => {
    const response = await OPTIONS(request());
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://thelogbook.web.app');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-firebase-appcheck');
    expect((await OPTIONS(request('https://attacker.example'))).status).toBe(403);
  });
});
