import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryErrorPayload } from '../src/lib/telemetry/contracts';

const sentry = vi.hoisted(() => {
  const scope = {
    setFingerprint: vi.fn(),
    setTag: vi.fn(),
    setContext: vi.fn(),
  };
  return {
    scope,
    init: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn((callback: (value: typeof scope) => void) => callback(scope)),
  };
});

vi.mock('@sentry/react', () => sentry);

describe('Sentry technical error privacy boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1');
    vi.stubEnv('PROD', true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('never sends raw secrets through exception, stack or fallback fingerprint', async () => {
    const { initSentry, sendTelemetryToSentry } = await import('../src/lib/sentryClient');
    expect(initSentry()).toBe(true);
    const payload = {
      type: 'Error',
      message: 'Failure {"api_key":"SYNTH_SECRET"}',
      stack: 'Error at C:\\USERS\\Synthetic\\source.ts:12',
      source: 'window_error',
      hash: 'Authorization: Basic SYNTH_FINGERPRINT',
      sessionId: 'synthetic-session',
      count: 1,
      firstSeen: 10,
      lastSeen: 20,
      context: { appVersion: 'test', platform: 'other', displayMode: 'browser', online: true },
    } as unknown as TelemetryErrorPayload;

    expect(await sendTelemetryToSentry('error', payload)).toBe(true);
    const error = sentry.captureException.mock.calls[0]?.[0] as Error;
    expect(error.message).toContain('[REDACTED]');
    expect(error.message).not.toContain('SYNTH_SECRET');
    expect(error.stack).toContain('[REDACTED_PATH]');
    expect(error.stack).not.toContain('Synthetic');
    expect(JSON.stringify(sentry.scope.setFingerprint.mock.calls)).not.toContain('SYNTH_SECRET');
    expect(JSON.stringify(sentry.scope.setFingerprint.mock.calls)).not.toContain('SYNTH_FINGERPRINT');

    const config = sentry.init.mock.calls[0]?.[0] as {
      beforeSend: (event: { message?: string; exception?: { values: Array<{ value?: string }> } }) =>
        { message?: string; exception?: { values: Array<{ value?: string }> } };
    };
    const event = config.beforeSend({
      message: 'Failure {"client_secret":"SYNTH_SECRET"}',
      exception: { values: [{ value: 'C:\\USERS\\Synthetic\\app.ts' }] },
    });
    expect(JSON.stringify(event)).not.toContain('SYNTH_SECRET');
    expect(JSON.stringify(event)).not.toContain('Synthetic');
  });
});
