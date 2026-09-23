import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_RETENTION_DAYS,
  TELEMETRY_RETENTION_MS,
  telemetryExpiresAt,
} from '../src/lib/telemetry/retention';

describe('telemetry retention', () => {
  it('uses a deterministic 30-day expiry from the retention anchor', () => {
    const anchor = Date.UTC(2026, 8, 23, 12, 0, 0);
    const expiresAt = telemetryExpiresAt(anchor);

    expect(TELEMETRY_RETENTION_DAYS).toBe(30);
    expect(TELEMETRY_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(expiresAt).toEqual(new Date(anchor + TELEMETRY_RETENTION_MS));
  });

  it('fails closed instead of inventing an expiry for an invalid anchor', () => {
    expect(() => telemetryExpiresAt(Number.NaN)).toThrow('Telemetry retention anchor must be finite');
    expect(() => telemetryExpiresAt(Number.POSITIVE_INFINITY)).toThrow('Telemetry retention anchor must be finite');
  });

});
