import { describe, expect, it } from 'vitest';
import { healthConsentReleaseEnabled } from '../server/healthConsent/launch';
import { healthConsentLaunchAvailable } from '../src/lib/healthConsentLaunch';

describe('deferred health consent release safety', () => {
  it('has a closed real backend release gate', () => {
    expect(healthConsentReleaseEnabled()).toBe(false);
  });

  it('allows frontend flow execution in synthetic Vitest mode only', () => {
    expect(healthConsentLaunchAvailable()).toBe(true);
  });
});
