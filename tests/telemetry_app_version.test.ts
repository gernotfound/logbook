import { describe, expect, it } from 'vitest';
import { APP_VERSION, getTelemetryContext } from '../src/lib/telemetrySanitizer';

describe('telemetry app version', () => {
  it('uses the Vite build version instead of a hardcoded telemetry version', () => {
    expect(APP_VERSION).toBe(__APP_VERSION__);
    expect(getTelemetryContext().appVersion).toBe(__APP_VERSION__);
  });
});
