import { afterEach, describe, expect, it, vi } from 'vitest';
import { telemetryHub } from '../src/lib/telemetryHub';
import { getTelemetryContext } from '../src/lib/telemetrySanitizer';
import { initSentry, isSentryReportingDisabled } from '../src/lib/sentryClient';

describe('Telemetry disabled by deployment configuration', () => {
  afterEach(() => {
    telemetryHub.reset();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('retains already queued technical errors without retrying or evicting them when Sentry has no DSN', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', '');
    expect(initSentry()).toBe(false);
    expect(isSentryReportingDisabled()).toBe(true);

    const owner = 'synthetic-test-owner';
    const timestamp = Date.now();
    telemetryHub.setUserId(owner);
    const item = {
      id: 'synthetic-error',
      timestamp,
      itemType: 'error' as const,
      retryCount: 3,
      payload: {
        id: 'synthetic-error',
        timestamp,
        type: 'SyntheticError',
        message: 'Synthetic error from a previous session',
        source: 'custom',
        context: getTelemetryContext(),
        userId: owner,
        sessionId: 'synthetic-session',
        count: 1,
        firstSeen: timestamp,
        lastSeen: timestamp,
      },
    };

    // Exercise the existing legacy migration boundary without touching
    // business storage: locked-vault diagnostics are kept in memory.
    localStorage.setItem(telemetryHub.getQueueStorageKey(), JSON.stringify([item]));
    const dispatch = vi.spyOn(telemetryHub, 'dispatchErrorExternally').mockResolvedValue(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (let attempt = 0; attempt < 5; attempt++) {
      await telemetryHub.flushQueue();
    }

    expect(dispatch).not.toHaveBeenCalled();
    expect(telemetryHub.getQueuedEvents()).toMatchObject([{
      id: 'synthetic-error',
      retryCount: 3,
    }]);
    expect(warn.mock.calls.some(args => String(args[0]).includes('Evicting poison pill'))).toBe(false);
  });
});
