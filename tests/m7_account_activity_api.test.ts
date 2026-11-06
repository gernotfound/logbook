import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verified = vi.hoisted(() => ({
  verifyRecoveryRegistrationRequester: vi.fn(),
}));
const tracker = vi.hoisted(() => ({ recordAccountActivity: vi.fn() }));
vi.mock('../server/accountDeletion/httpAuth', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/accountDeletion/httpAuth')>()),
  verifyRecoveryRegistrationRequester: verified.verifyRecoveryRegistrationRequester,
}));
vi.mock('../server/accountInactivity', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/accountInactivity')>()),
  recordAccountActivity: tracker.recordAccountActivity,
}));

import { OPTIONS, POST } from '../api/account-activity';
import { AccountDeletionAlreadyScheduledError } from '../server/accountInactivity';
import { RequestAuthError } from '../server/accountDeletion/httpAuth';

function request(origin = 'https://thelogbook.web.app', body?: unknown): Request {
  return new Request('https://logbook-gnf.vercel.app/api/account-activity', {
    method: 'POST',
    headers: {
      origin,
      authorization: 'Bearer synthetic-token',
      'x-firebase-appcheck': 'one-use-token',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('account activity trusted HTTP boundary', () => {
  const original = process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED;
    verified.verifyRecoveryRegistrationRequester.mockResolvedValue({ uid: 'verified-owner' });
    tracker.recordAccountActivity.mockResolvedValue(undefined);
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED;
    else process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = original;
  });

  it('does not collect any metadata while server rollout is disabled', async () => {
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(verified.verifyRecoveryRegistrationRequester).not.toHaveBeenCalled();
    expect(tracker.recordAccountActivity).not.toHaveBeenCalled();
  });

  it('denies untrusted origins before validating tokens or touching a marker', async () => {
    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    const response = await POST(request('https://attacker.example'));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(verified.verifyRecoveryRegistrationRequester).not.toHaveBeenCalled();
  });

  it('reports only the token-verified UID, ignoring arbitrary client payloads and clocks', async () => {
    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    const response = await POST(request(undefined, { uid: 'attacker', timestamp: '2099-01-01' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://thelogbook.web.app');
    expect(verified.verifyRecoveryRegistrationRequester).toHaveBeenCalledTimes(1);
    expect(tracker.recordAccountActivity).toHaveBeenCalledExactlyOnceWith('verified-owner');
  });

  it('does not mutate storage after Auth/App Check rejects the session', async () => {
    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    verified.verifyRecoveryRegistrationRequester.mockRejectedValueOnce(new RequestAuthError('Token non valido.'));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(tracker.recordAccountActivity).not.toHaveBeenCalled();
  });

  it('fails closed when an inactivity or manual deletion already owns the account', async () => {
    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    tracker.recordAccountActivity.mockRejectedValueOnce(new AccountDeletionAlreadyScheduledError());
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(tracker.recordAccountActivity).toHaveBeenCalledExactlyOnceWith('verified-owner');
  });

  it('masks provider details in backend errors and never acknowledges failed activity', async () => {
    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    tracker.recordAccountActivity.mockRejectedValueOnce(new Error('PRIVATE_ID_AND_EMAIL'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_ID_AND_EMAIL');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_ID_AND_EMAIL');
    } finally {
      log.mockRestore();
    }
  });

  it('preflights only the configured HTTPS origin', async () => {
    expect((await OPTIONS(new Request('https://backend.test/api/account-activity', {
      method: 'OPTIONS', headers: { origin: 'https://thelogbook.web.app' },
    }))).status).toBe(204);
    const bad = await OPTIONS(new Request('https://backend.test/api/account-activity', {
      method: 'OPTIONS', headers: { origin: 'https://attacker.example' },
    }));
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});
