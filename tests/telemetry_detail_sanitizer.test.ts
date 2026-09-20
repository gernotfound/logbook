import { describe, expect, it } from 'vitest';
import { sanitizeTelemetryDetails } from '../src/lib/telemetry/detailSanitizer';

describe('telemetry event detail sanitization', () => {
  it('keeps only bounded technical metadata and drops business/free-form keys', () => {
    const input = {
      routineId: 'routine-1',
      routineName: 'Riabilitazione ginocchio athlete@example.com',
      offline: true,
      durationMinutes: 45,
      source: 'settings Bearer secret-token',
      nested: {
        source: '?token=private-value',
      },
    };

    const output = sanitizeTelemetryDetails(input);

    expect(output.routineId).toBe('routine-1');
    expect(output.offline).toBe(true);
    expect(output.durationMinutes).toBe(45);
    expect(output.source).toContain('Bearer [REDACTED_TOKEN]');
    expect(output.source).not.toContain('secret-token');
    expect(output).not.toHaveProperty('routineName');
    expect(output).not.toHaveProperty('nested');
  });

  it('drops malformed values instead of coercing them into telemetry', () => {
    const output = sanitizeTelemetryDetails({
      offline: 'yes',
      exerciseCount: -1,
      outcome: 'unknown',
      durationSec: Number.NaN,
      promptUsed: true,
    });

    expect(output).toEqual({ promptUsed: true });
  });
});
