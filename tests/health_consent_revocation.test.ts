import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertHealthConsentWritable,
  healthConsentRevocationKey,
  isHealthConsentWriteBlocked,
  markHealthConsentRevocation,
  readHealthConsentRevocation,
} from '../src/lib/healthConsentRevocation';
import { writeDeviceValue } from '../src/lib/sync/deviceStorage';

describe('consent revocation local write barrier', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('preserves pending, confirmed, and no downgrade on retry', () => {
    const owner = 'user:a';
    expect(readHealthConsentRevocation(owner)).toBe('none');
    markHealthConsentRevocation(owner, 'pending');
    expect(localStorage.getItem(healthConsentRevocationKey(owner))).toBe('pending');
    expect(() => assertHealthConsentWritable(owner)).toThrow();
    markHealthConsentRevocation(owner, 'confirmed');
    markHealthConsentRevocation(owner, 'pending');
    expect(readHealthConsentRevocation(owner)).toBe('confirmed');
  });

  it('isolates owners and fails closed on invalid marker', () => {
    markHealthConsentRevocation('user:a', 'confirmed');
    expect(isHealthConsentWriteBlocked('user:a')).toBe(true);
    expect(isHealthConsentWriteBlocked('user:b')).toBe(false);
    localStorage.setItem(healthConsentRevocationKey('user:b'), 'invalid');
    expect(isHealthConsentWriteBlocked('user:b')).toBe(true);
  });

  it('rejects stale device writes but permits cleanup', () => {
    writeDeviceValue('workout', 'original', 'user:a');
    markHealthConsentRevocation('user:a', 'pending');
    expect(() => writeDeviceValue('workout', 'stale', 'user:a')).toThrow();
    expect(localStorage.getItem('logbook:v2:user:a:workout')).toBe('original');
    writeDeviceValue('workout', null, 'user:a');
    expect(localStorage.getItem('logbook:v2:user:a:workout')).toBeNull();
  });
});
