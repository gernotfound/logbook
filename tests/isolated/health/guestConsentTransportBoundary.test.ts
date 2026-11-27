import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
  throw new Error('Guest consent imported Firebase');
});
vi.mock('../../../src/lib/healthConsentFirebaseTransport', () => {
  throw new Error('Guest consent imported the legacy HTTP transport');
});

import {
  getGuestHealthConsentStatus, isHealthConsentCloudWritable,
  isHealthConsentWritable, withdrawGuestHealthConsent,
} from '../../../src/lib/healthConsent';
import { installLegacyHealthConsentIdentity, readLegacyHealthConsentUser } from '../../../src/lib/healthConsentLegacyIdentity';
import { writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { activateGuestSession, GUEST_SESSION_KEY, revokeGuestSession } from '../../../src/lib/sync/session';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('logbook_is_guest', 'true');
  localStorage.setItem(GUEST_SESSION_KEY, 'guest-consent-test');
  activateGuestSession('guest-consent-test');
});

describe('Consent policy in the guest-only runtime', () => {
  it('checks and revokes local consent without importing a Firebase provider', () => {
    expect(getGuestHealthConsentStatus()).toBe('active');
    expect(isHealthConsentWritable('guest')).toBe(true);
    expect(isHealthConsentCloudWritable('guest')).toBe(false);
    withdrawGuestHealthConsent();
    expect(getGuestHealthConsentStatus()).toBe('withdrawn');
    expect(isHealthConsentWritable('guest')).toBe(false);
  });

  it('does not authorize account data or a revoked guest generation without a provider', () => {
    expect(readLegacyHealthConsentUser()).toBeNull();
    expect(isHealthConsentWritable('user:someone')).toBe(false);
    revokeGuestSession();
    expect(isHealthConsentWritable('guest')).toBe(false);
  });

  it('denies unrecognized and malformed owners even during an active guest session', () => {
    for (const owner of ['', 'other', 'device:other', 'user:', 'user:bad/path']) {
      expect(isHealthConsentWritable(owner), owner).toBe(false);
      expect(isHealthConsentCloudWritable(owner), owner).toBe(false);
    }
    expect(isHealthConsentWritable('guest')).toBe(true);
    expect(isHealthConsentCloudWritable('guest')).toBe(false);
    expect(() => writeDeviceValue('workout', 'private', 'device:other')).toThrow('Accesso fitness sospeso');
    expect(localStorage.getItem('logbook:v2:device:other:workout')).toBeNull();
  });

  it('drops the legacy session reader only after the last provider lease', () => {
    const account = { uid: 'legacy', getIdToken: async () => 'test' } as never;
    const read = () => account;
    const first = installLegacyHealthConsentIdentity(read);
    const second = installLegacyHealthConsentIdentity(read);
    try {
      expect(readLegacyHealthConsentUser()).toBe(account);
      expect(() => installLegacyHealthConsentIdentity(() => account)).toThrow();
      first();
      expect(readLegacyHealthConsentUser()).toBe(account);
    } finally {
      first();
      second();
    }
    expect(readLegacyHealthConsentUser()).toBeNull();
  });
});
