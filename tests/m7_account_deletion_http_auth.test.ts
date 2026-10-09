import { beforeEach, describe, expect, it, vi } from 'vitest';

const admin = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminAuth: () => ({ verifyIdToken: admin.verifyIdToken }),
  adminAppCheck: () => ({ verifyToken: admin.verifyToken }),
}));

import {
  RequestAuthError,
  verifyDeletionRequester,
  verifyHealthConsentRevocationRequester,
  verifyRecoveryRegistrationRequester,
  verifyStatusAppCheck,
} from '../server/accountDeletion/httpAuth';

function requesterRequest(): Request {
  return new Request('https://backend.example/api/account-deletion', {
    headers: {
      authorization: 'Bearer id-token',
      'x-firebase-appcheck': 'limited-use-app-check',
    },
  });
}

describe('M7 App Check replay protection for account deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admin.verifyIdToken.mockResolvedValue({
      uid: 'user-a',
      auth_time: Math.floor(Date.now() / 1000),
    });
    admin.verifyToken.mockResolvedValue({ alreadyConsumed: false });
  });

  it('verifies revocation and consumes a limited-use App Check token', async () => {
    await expect(verifyDeletionRequester(requesterRequest())).resolves.toEqual({ uid: 'user-a' });
    expect(admin.verifyIdToken).toHaveBeenCalledWith('id-token', true);
    expect(admin.verifyToken).toHaveBeenCalledWith('limited-use-app-check', { consume: true });
  });

  it('rejects an already consumed App Check token', async () => {
    admin.verifyToken.mockResolvedValueOnce({ alreadyConsumed: true });
    await expect(verifyDeletionRequester(requesterRequest())).rejects.toMatchObject({
      name: 'RequestAuthError',
      status: 403,
    });
  });

  it('uses the same one-time verification for status/recovery calls without Firebase Auth', async () => {
    await expect(verifyStatusAppCheck(new Request('https://backend.example/status', {
      headers: { 'x-firebase-appcheck': 'limited-use-status-token' },
    }))).resolves.toBeUndefined();
    expect(admin.verifyToken).toHaveBeenCalledWith('limited-use-status-token', { consume: true });
    expect(admin.verifyIdToken).not.toHaveBeenCalled();
  });

  it('fails closed when the App Check verifier is unavailable', async () => {
    admin.verifyToken.mockRejectedValueOnce(new Error('upstream unavailable'));
    await expect(verifyStatusAppCheck(new Request('https://backend.example/status', {
      headers: { 'x-firebase-appcheck': 'limited-use-status-token' },
    }))).rejects.toBeInstanceOf(RequestAuthError);
  });

  it('allows recovery-device registration with a valid non-revoked session even when auth_time is old', async () => {
    admin.verifyIdToken.mockResolvedValueOnce({
      uid: 'user-a',
      auth_time: Math.floor(Date.now() / 1000) - 86_400,
    });
    await expect(verifyRecoveryRegistrationRequester(requesterRequest())).resolves.toEqual({ uid: 'user-a' });
    expect(admin.verifyIdToken).toHaveBeenCalledWith('id-token', true);
    expect(admin.verifyToken).toHaveBeenCalledWith('limited-use-app-check', { consume: true });
  });

  it('authorizes revocation with a non-revoked session and consumes one-time App Check', async () => {
    admin.verifyIdToken.mockResolvedValueOnce({
      uid: 'user-a',
      auth_time: Math.floor(Date.now() / 1000) - 86_400,
    });
    await expect(verifyHealthConsentRevocationRequester(requesterRequest())).resolves.toEqual({ uid: 'user-a' });
    expect(admin.verifyIdToken).toHaveBeenCalledWith('id-token', true);
    expect(admin.verifyToken).toHaveBeenCalledWith('limited-use-app-check', { consume: true });
  });

  it('rejects replayed App Check for consent revocation', async () => {
    admin.verifyToken.mockResolvedValueOnce({ alreadyConsumed: true });
    await expect(verifyHealthConsentRevocationRequester(requesterRequest())).rejects.toMatchObject({
      name: 'RequestAuthError',
      status: 403,
    });
  });

  it('rejects stale authentication for the destructive deletion request even with valid one-time App Check', async () => {
    admin.verifyIdToken.mockResolvedValueOnce({
      uid: 'user-a',
      auth_time: Math.floor(Date.now() / 1000) - 301,
    });
    await expect(verifyDeletionRequester(requesterRequest())).rejects.toMatchObject({
      name: 'RequestAuthError',
      status: 401,
    });
  });
});
