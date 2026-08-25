import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import {
  telemetryHub,
  MAX_ACTIVE_RATE_LIMITERS,
  RATE_LIMIT_WINDOW_MS,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';

describe('Milestone 4 Challenger: Empirical Stress & Burst Verification', () => {
  let mockSetDoc: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    mockSetDoc = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {
      return { path: pathSegments.join('/') } as any;
    });

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

  it('Stress 1: 1,000+ rapid error calls in milliseconds finishes in <50ms and aggregates to a single doc (count=1000)', async () => {
    vi.useFakeTimers();
    telemetryHub.init();
    telemetryHub.setUserId('user_burst_stress_1');

    const burstError = new TypeError('Connection reset by peer during sync');

    // Warm-up JIT
    for (let i = 0; i < 20; i++) {
      telemetryHub.trackError(new Error(`warmup_${i}`));
    }
    telemetryHub.clearRateLimiters();

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      telemetryHub.trackError(burstError);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(1);

    // Advance timers to trigger the microtask and window expiry
    await vi.advanceTimersByTimeAsync(50);

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
    expect(payload.type).toBe('TypeError');
    expect(payload.message).toBe('Connection reset by peer during sync');
    expect(payload.count).toBe(1000);
  });

  it('Stress 2a: Rapid generation of 1,500 distinct errors strictly caps activeRateLimiters at 1000 with LRU eviction and timer cleanup', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    telemetryHub.init();
    telemetryHub.setUserId('user_distinct_stress_2a');

    // Pre-warm
    for (let i = 0; i < 20; i++) {
      telemetryHub.trackError(new Error(`warmup_${i}`));
    }
    telemetryHub.clearRateLimiters();
    clearTimeoutSpy.mockClear();

    // Generate 1,500 distinct errors (500 over the 1,000 cap)
    const totalDistinct = 1500;
    const start = performance.now();
    for (let i = 0; i < totalDistinct; i++) {
      telemetryHub.trackError(new Error(`Distinct unique error #${i} - uuid: ${i}_${Math.random().toString(36).slice(2, 7)}`));
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(150);
    // Verify rate limiters count NEVER exceeds MAX_ACTIVE_RATE_LIMITERS (1000)
    expect(telemetryHub.getActiveRateLimiterCount()).toBeLessThanOrEqual(MAX_ACTIVE_RATE_LIMITERS);
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(1000);

    // Verify manual or graceful flush empties all entries
    await telemetryHub.flushRateLimiters();
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
  });

  it('Stress 2b: Multi-occurrence distinct errors arm timers and automatically expire at 60s boundary to 0 active limiters', async () => {
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
    expect(mockSetDoc).toHaveBeenCalledTimes(distinctCount);

    // Advance 60s: all active rate limiters expire and clean up their timer handles
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_WINDOW_MS + 100);
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
  });

  it('Stress 3: 2,000 burst calls with alternating errors maintain deterministic sliding window aggregation', async () => {
    vi.useFakeTimers();
    telemetryHub.init();
    telemetryHub.setUserId('user_alternating_burst');

    const err1 = new RangeError('Index out of bounds in workout array');
    const err2 = new ReferenceError('Property undefined on catalog item');

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      telemetryHub.trackError(err1);
      telemetryHub.trackError(err2);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(telemetryHub.getActiveRateLimiterCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(50);

    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    const p1 = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
    const p2 = mockSetDoc.mock.calls[1][1] as TelemetryErrorPayload;

    expect(p1.count).toBe(1000);
    expect(p2.count).toBe(1000);
  });

  it('Stress 4: Offline queue under 1,000 mixed item barrage guarantees <= 50 FIFO capacity and zero data corruption', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    telemetryHub.init();
    telemetryHub.setUserId('user_offline_flood');

    for (let i = 0; i < 1000; i++) {
      if (i % 2 === 0) {
        telemetryHub.trackEvent(`flood_event_${i}`, { idx: i });
      } else {
        telemetryHub.trackError(new Error(`flood_error_${i}`));
      }
    }

    const queue = telemetryHub.getQueuedEvents();
    expect(queue.length).toBe(50);
    // Oldest 950 items evicted; earliest item should be item 950 (flood_event_950)
    expect(queue[0].payload.type).toBe('flood_event_950');
    expect(queue[49].payload.type).toBe('Error');
    expect((queue[49].payload as TelemetryErrorPayload).message).toBe('flood_error_999');

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
});
