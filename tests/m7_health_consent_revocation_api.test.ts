import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  verifyHealthConsentRevocationRequester: vi.fn(),
  RequestAuthError: class RequestAuthError extends Error {
    constructor(message: string, public readonly status: 401 | 403 = 401) {
      super(message);
      this.name = 'RequestAuthError';
    }
  },
}));

const store = vi.hoisted(() => ({
  recordHealthConsentRevocation: vi.fn(),
  RevocationAccountDeletingError: class RevocationAccountDeletingError extends Error {
    constructor() {
      super('La cancellazione account è già in corso.');
      this.name = 'RevocationAccountDeletingError';
    }
  },
}));

vi.mock('../server/accountDeletion/httpAuth', () => auth);
vi.mock('../server/healthConsent/revocation', () => store);

import { OPTIONS, POST } from '../api/health-consent-revocation';

function req(origin = 'https://thelogbook.web.app', method = 'POST'): Request {
  return new Request('https://logbook-gnf.vercel.app/api/health-consent-revocation', {
    method,
    headers: { origin, authorization: 'Bearer synthetic', 'x-firebase-appcheck': 'synthetic' },
  });
}

describe('health consent revocation API boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyHealthConsentRevocationRequester.mockResolvedValue({ uid: 'owner-a' });
    store.recordHealthConsentRevocation.mockResolvedValue(undefined);
  });

  it('rejects untrusted origins before authentication or server mutations', async () => {
    const response = await POST(req('https://malicious.example'));
    expect(response.status).toBe(403);
    expect(auth.verifyHealthConsentRevocationRequester).not.toHaveBeenCalled();
    expect(store.recordHealthConsentRevocation).not.toHaveBeenCalled();
  });

  it('uses only the verified UID, not a client supplied body or path parameter', async () => {
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(store.recordHealthConsentRevocation).toHaveBeenCalledExactlyOnceWith('owner-a');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://thelogbook.web.app');
  });

  it('does not claim revocation after a failed server write', async () => {
    store.recordHealthConsentRevocation.mockRejectedValueOnce(new Error('upstream unavailable, token secret'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(req());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'Impossibile registrare la revoca sul server. Riprova.',
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('token secret');
    } finally {
      log.mockRestore();
    }
  });

  it('returns conflict if account deletion is already active', async () => {
    store.recordHealthConsentRevocation.mockRejectedValueOnce(new store.RevocationAccountDeletingError());
    const response = await POST(req());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('cancellazione account') });
  });

  it('authorizes preflight only from the exact app origin', async () => {
    expect((await OPTIONS(req('https://thelogbook.web.app', 'OPTIONS'))).status).toBe(204);
    expect((await OPTIONS(req('https://old-domain.example', 'OPTIONS'))).status).toBe(403);
  });
});
