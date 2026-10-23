import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import {
  telemetryHub,
  MAX_ACTIVE_RATE_LIMITERS,
  RATE_LIMIT_WINDOW_MS,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';

describe('Milestone 4 Challenger: Empirical Stress & Burst Verification', () => {
  let mockSentryTransport: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    mockSentryTransport = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);

    telemetryHub.reset();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    telemetryHub.reset();
  });

  it('Stress 2a: 1,500 deterministic distinct errors cap active rate limiters at 1,000', async () => {
    vi.useFakeTimers();

    telemetryHub.init();
    telemetryHub.setUserId('user_distinct_stress_2a');

    // Pre-warm
    for (let i = 0; i < 20; i++) {
      telemetryHub.trackError(new Error(`warmup_${i}`));
    }
    telemetryHub.clearRateLimiters();

    // 1,500 deterministic fingerprints exercise the 1,000-entry limiter cap.
    for (let i = 0; i < 1500; i++) {
      telemetryHub.trackError(new Error(`Distinct unique error #${i}`));
    }
    // Verify rate limiters count NEVER exceeds MAX_ACTIVE_RATE_LIMITERS (1000)
    expect(telemetryHub.getActiveRateLimiterCount()).toBeLessThanOrEqual(MAX_ACTIVE_RATE_LIMITERS);
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(1000);

    // Verify manual or graceful flush empties all entries
    await telemetryHub.flushRateLimiters();
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
  });

  it('Stress 2b: Multi-occurrence errors expire at the configured deduplication window', async () => {
    vi.useFakeTimers();
    telemetryHub.init();
    telemetryHub.setUserId('user_distinct_stress_2b');

    const distinctCount = 100;
    for (let i = 0; i < distinctCount; i++) {
      const err = new Error(`Distinct error multi #${i}`);
      telemetryHub.trackError(err);
      telemetryHub.trackError(err); // 2nd occurrence arms timer
    }

    expect(telemetryHub.getActiveRateLimiterCount()).toBe(distinctCount);

    // Initial microtask flush
    await vi.advanceTimersByTimeAsync(50);
    expect(mockSentryTransport).toHaveBeenCalledTimes(distinctCount);

    // Advance beyond the configured deduplication window; all limiters must expire.
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_WINDOW_MS + 100);
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
  });

  it('Stress 3: 2,000 burst calls with alternating errors maintain deterministic sliding window aggregation', async () => {
    vi.useFakeTimers();
    telemetryHub.init();
    telemetryHub.setUserId('user_alternating_burst');

    const err1 = new RangeError('Index out of bounds in workout array');
    const err2 = new ReferenceError('Property undefined on catalog item');

    for (let i = 0; i < 1000; i++) {
      telemetryHub.trackError(err1);
      telemetryHub.trackError(err2);
    }
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(50);

    expect(mockSentryTransport).toHaveBeenCalledTimes(2);
    const p1 = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
    const p2 = mockSentryTransport.mock.calls[1][1] as TelemetryErrorPayload;

    expect(p1.type).toBe('RangeError');
    expect(p1.message).toBe('Index out of bounds in workout array');
    expect(p1.count).toBe(1000);
    expect(p2.type).toBe('ReferenceError');
    expect(p2.message).toBe('Property undefined on catalog item');
    expect(p2.count).toBe(1000);
  });
});
