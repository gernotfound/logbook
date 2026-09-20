import { describe, expect, it } from 'vitest';
import { sanitizeTelemetryDetails } from '../src/lib/telemetry/detailSanitizer';

describe('telemetry event detail sanitization', () => {
  it('scrubs sensitive strings recursively while preserving technical scalars', () => {
    const input = {
      routineId: 'routine-1',
      routineName: 'Contatto athlete@example.com Bearer secret-token',
      offline: true,
      durationMinutes: 45,
      nested: {
        source: 'token="private-value"',
      },
    };

    const output = sanitizeTelemetryDetails(input);

    expect(output.routineId).toBe('routine-1');
    expect(output.routineName).toContain('[REDACTED_EMAIL]');
    expect(output.routineName).toContain('Bearer [REDACTED_TOKEN]');
    expect(output.routineName).not.toContain('athlete@example.com');
    expect(output.offline).toBe(true);
    expect(output.durationMinutes).toBe(45);
    expect(output.nested.source).not.toContain('private-value');
  });
});
