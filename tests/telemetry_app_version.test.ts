import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';
import { APP_VERSION, getTelemetryContext } from '../src/lib/telemetrySanitizer';

describe('telemetry app version', () => {
  it('uses the Vite build version instead of a hardcoded telemetry version', () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(getTelemetryContext().appVersion).toBe(packageJson.version);
  });
});
