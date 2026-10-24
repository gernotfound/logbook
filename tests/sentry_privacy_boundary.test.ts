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

  it('exports only structured diagnostics, never arbitrary health notes or user-supplied stack text', async () => {
    const { initSentry, sendTelemetryToSentry } = await import('../src/lib/sentryClient');
    expect(initSentry()).toBe(true);
    const privateNote = 'nota sanitaria: dolore alla spalla destra dopo fisioterapia';
    const payload = {
      type: privateNote,
      message: `Failure ${privateNote} {"api_key":"SYNTH_SECRET"}`,
      stack: `Error: ${privateNote} at C:\\USERS\\Synthetic\\source.ts:12`,
      componentStack: privateNote,
      source: privateNote,
      hash: privateNote,
      sessionId: privateNote,
      count: 1,
      firstSeen: 10,
      lastSeen: 20,
      context: { appVersion: privateNote, platform: 'other', displayMode: 'browser', online: true },
    } as unknown as TelemetryErrorPayload;

    // The SDK spy is the actual capture boundary, not a mock of sendTelemetryToSentry.
    expect(await sendTelemetryToSentry('error', payload)).toBe(true);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const error = sentry.captureException.mock.calls[0][0] as Error;
    expect(error.message).toBe('Technical diagnostic');
    expect(error.name).toBe('Error');
    expect(error.stack).toBe('Error: Technical diagnostic');
    expect(sentry.scope.setFingerprint).toHaveBeenCalledWith([
      'technical-diagnostic', 'Error', 'custom',
    ]);
    expect(sentry.scope.setTag).toHaveBeenCalledWith('source', 'custom');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('app_version', 'unknown');
    expect(sentry.scope.setContext).toHaveBeenCalledWith('logbook', {
      sessionId: undefined, occurrenceCount: 1, firstSeen: 10, lastSeen: 20,
    });

    const sdkCalls = JSON.stringify([
      sentry.captureException.mock.calls,
      sentry.scope.setFingerprint.mock.calls,
      sentry.scope.setTag.mock.calls,
      sentry.scope.setContext.mock.calls,
    ]);
    expect(sdkCalls).not.toContain(privateNote);
    expect(sdkCalls).not.toContain('SYNTH_SECRET');
    expect(sdkCalls).not.toContain('Synthetic');

    const config = sentry.init.mock.calls[0][0] as {
      beforeSend: (event: { message?: string; extra?: unknown; exception?: {
        values: Array<{ type?: string; value?: string; stacktrace?: unknown }>;
      } }) => unknown;
    };
    const received = config.beforeSend({
      message: privateNote,
      extra: { note: privateNote },
      exception: { values: [{ type: privateNote, value: privateNote,
        stacktrace: { frames: [{ filename: privateNote }] } }] },
    });
    expect(JSON.stringify(received)).not.toContain(privateNote);
    expect(JSON.stringify(received)).toContain('Technical diagnostic');
  });

  it('retains technical classifications without reporting arbitrary anomaly reasons', async () => {
    const { initSentry, sendTelemetryToSentry } = await import('../src/lib/sentryClient');
    expect(initSentry()).toBe(true);
    const privateNote = 'nota personale ginocchio sinistro';
    expect(await sendTelemetryToSentry('storage-anomaly', {
      type: 'storage_recovery_anomaly',
      reason: privateNote,
      timestamp: 10, elapsedMs: 20, platform: 'other',
      standalone: false, persisted: false,
    })).toBe(true);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.scope.setFingerprint).toHaveBeenCalledWith([
      'storage-recovery-anomaly', 'other_storage_recovery_anomaly',
    ]);
    expect(sentry.scope.setContext).toHaveBeenCalledWith('logbook',
      expect.objectContaining({ reason: 'other_storage_recovery_anomaly' }));
    expect(JSON.stringify([
      sentry.captureException.mock.calls,
      sentry.scope.setFingerprint.mock.calls,
      sentry.scope.setContext.mock.calls,
    ])).not.toContain(privateNote);
  });



});
