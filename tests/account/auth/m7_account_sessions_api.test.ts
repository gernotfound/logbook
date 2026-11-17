import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ verifyDeletionRequester: vi.fn() }));
const sessions = vi.hoisted(() => ({ revokeAllUserSessions: vi.fn() }));

vi.mock('../../../server/accountDeletion/httpAuth', () => {
  class RequestAuthError extends Error {
    constructor(message: string, readonly status: 401 | 403 = 401) { super(message); }
  }
  return { RequestAuthError, verifyDeletionRequester: auth.verifyDeletionRequester };
});
vi.mock('../../../server/accountDeletion/sessionRevocation', () => sessions);

import { OPTIONS, POST } from '../../../api/account-sessions';
import { RequestAuthError } from '../../../server/accountDeletion/httpAuth';

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

  it.each(['not-an-origin', 'http://thelogbook.web.app'])(
    'reports invalid server origin configuration as unavailable rather than blaming the caller: %s',
    async invalidOrigin => {
      const original = process.env.PUBLIC_APP_ORIGIN;
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        process.env.PUBLIC_APP_ORIGIN = invalidOrigin;
        const preflight = await OPTIONS(request('https://thelogbook.web.app', 'OPTIONS'));
        const post = await POST(request());

        expect(preflight.status).toBe(503);
        expect(await preflight.json()).toEqual({ error: 'Servizio di revoca sessioni temporaneamente non disponibile.' });
        expect(post.status).toBe(503);
        expect(await post.json()).toEqual({
          error: 'Revoca non confermata. Potrebbe essere stata eseguita; rieffettua l’accesso per verificare.',
        });
        for (const response of [preflight, post]) {
          expect(response.headers.get('access-control-allow-origin')).toBeNull();
          expect(response.headers.get('cache-control')).toBe('no-store');
        }
        expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
        expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('[account-sessions] preflight failed', { kind: 'Error' });
        expect(JSON.stringify(log.mock.calls)).not.toContain(invalidOrigin);
      } finally {
        if (original === undefined) delete process.env.PUBLIC_APP_ORIGIN;
        else process.env.PUBLIC_APP_ORIGIN = original;
        log.mockRestore();
      }
    },
  );

  it('allows only the explicitly configured second candidate origin, preserving the original one', async () => {
    const previous = process.env.PUBLIC_CANDIDATE_APP_ORIGIN;
    const candidate = 'https://thelogbook-frontend.example.workers.dev';
    try {
      delete process.env.PUBLIC_CANDIDATE_APP_ORIGIN;
      expect((await OPTIONS(request(candidate, 'OPTIONS'))).status).toBe(403);

      process.env.PUBLIC_CANDIDATE_APP_ORIGIN = candidate;
      const preflight = await OPTIONS(request(candidate, 'OPTIONS'));
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(candidate);
      expect(preflight.headers.get('vary')).toBe('Origin');

      const post = await POST(request(candidate));
      expect(post.status).toBe(200);
      expect(post.headers.get('access-control-allow-origin')).toBe(candidate);
      expect(auth.verifyDeletionRequester).toHaveBeenCalledTimes(1);
      expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith('verified-uid');

      expect((await OPTIONS(request('https://thelogbook.web.app', 'OPTIONS'))).status).toBe(204);
      for (const lookalike of [
        'https://evil-thelogbook-frontend.example.workers.dev',
        'https://thelogbook-frontend.example.workers.dev.evil.test',
        'https://thelogbook-frontend.example.workers.dev:444',
      ]) {
        const rejected = await OPTIONS(request(lookalike, 'OPTIONS'));
        expect(rejected.status).toBe(403);
        expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
      }

      delete process.env.PUBLIC_CANDIDATE_APP_ORIGIN;
      expect((await OPTIONS(request(candidate, 'OPTIONS'))).status).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_CANDIDATE_APP_ORIGIN;
      else process.env.PUBLIC_CANDIDATE_APP_ORIGIN = previous;
    }
  });

  it.each([
    'http://thelogbook-frontend.example.workers.dev',
    'https://thelogbook-frontend.example.workers.dev/other',
    'https://user@thelogbook-frontend.example.workers.dev',
    'https://thelogbook-frontend.example.workers.dev?next=trusted',
    'not-an-origin',
  ])('fails closed for invalid candidate origin configuration: %s', async invalidOrigin => {
    const previous = process.env.PUBLIC_CANDIDATE_APP_ORIGIN;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      process.env.PUBLIC_CANDIDATE_APP_ORIGIN = invalidOrigin;
      const preflight = await OPTIONS(request('https://thelogbook.web.app', 'OPTIONS'));
      const post = await POST(request());
      expect(preflight.status).toBe(503);
      expect(post.status).toBe(503);
      for (const response of [preflight, post]) {
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
      expect(auth.verifyDeletionRequester).not.toHaveBeenCalled();
      expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain(invalidOrigin);
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_CANDIDATE_APP_ORIGIN;
      else process.env.PUBLIC_CANDIDATE_APP_ORIGIN = previous;
      log.mockRestore();
    }
  });

  it('exposes a strict CORS preflight only to the authorized app origin', async () => {
    const response = await OPTIONS(request());
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://thelogbook.web.app');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-firebase-appcheck');
    expect((await OPTIONS(request('https://attacker.example'))).status).toBe(403);
  });
});
