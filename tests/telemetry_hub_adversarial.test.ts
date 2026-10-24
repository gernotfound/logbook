import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import {
  telemetryHub,
  RATE_LIMIT_WINDOW_MS,
  TELEMETRY_DISPATCH_TIMEOUT_MS,
  TELEMETRY_QUEUE_CAPACITY,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';
import { APP_VERSION } from '../src/lib/telemetrySanitizer';
import { seedCurrentTelemetryQueue } from './telemetry/seedCurrentQueue';

describe('Adversarial Stress & Edge-Case Suite: TelemetryHub', () => {
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

  // =========================================================================
  // 1. Rapid Error Bursts & Aggregation Accuracy
  // =========================================================================
  describe('1. Rapid Error Bursts & Aggregation Accuracy', () => {
    it('handles a rapid burst of 500 identical errors in 5ms with exactly 1 immediate dispatch of aggregated count', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_burst_1');

      const burstError = new TypeError('Cannot read properties of undefined (reading dataset)');

      // Rapidly fire 500 errors synchronously
      for (let i = 0; i < 500; i++) {
        telemetryHub.trackError(burstError);
      }

      // Microtasks run
      await vi.advanceTimersByTimeAsync(50);

      // Exactly one technical error report is sent to the Sentry transport
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
      const callPayload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
      expect(callPayload.count).toBe(500);
      expect(callPayload.type).toBe('TypeError');

      // Now advance time through the remaining window (60s) without further errors
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_WINDOW_MS);

      // No redundant trailing dispatch since count (500) == lastDispatchedCount (500)
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
    });

    it('handles 100 distinct error types x 5 repetitions each (500 total errors) concurrently', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_mixed_burst');

      const distinctErrorCount = 100;
      for (let typeIdx = 0; typeIdx < distinctErrorCount; typeIdx++) {
        const err = new Error(`Distinct error variation #${typeIdx}`);
        for (let r = 0; r < 5; r++) {
          telemetryHub.trackError(err);
        }
      }

      expect(telemetryHub.getActiveRateLimiterCount()).toBe(distinctErrorCount);

      // Advance microtasks
      await vi.advanceTimersByTimeAsync(50);

      // Each distinct error should have dispatched once with count = 5
      expect(mockSentryTransport).toHaveBeenCalledTimes(distinctErrorCount);
      for (let i = 0; i < distinctErrorCount; i++) {
        const payload = mockSentryTransport.mock.calls[i][1] as TelemetryErrorPayload;
        expect(payload.count).toBe(5);
      }

      // Fast forward past 60s
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_WINDOW_MS);
      // No extra dispatches since no new errors occurred
      expect(mockSentryTransport).toHaveBeenCalledTimes(distinctErrorCount);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
    });
  });

  // =========================================================================
  // 2. Sliding Window Boundary Precision
  // =========================================================================
  describe('2. Sliding Window Boundary Precision', () => {
    it('aggregates immediately before expiry and starts a new window immediately after expiry', async () => {
      vi.useFakeTimers();
      const baseTime = 1724486400000;
      vi.setSystemTime(baseTime);

      telemetryHub.init();
      telemetryHub.setUserId('user_boundary_test');

      const err = new Error('Boundary error test');

      // t = 0ms -> Initial occurrence
      telemetryHub.trackError(err);
      await vi.advanceTimersByTimeAsync(10);
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
      expect(mockSentryTransport.mock.calls[0][1].count).toBe(1);

      const justBeforeExpiry = RATE_LIMIT_WINDOW_MS - 1;
      await vi.advanceTimersByTimeAsync(justBeforeExpiry - 10);
      vi.setSystemTime(baseTime + justBeforeExpiry);
      telemetryHub.trackError(err);

      expect(mockSentryTransport).toHaveBeenCalledTimes(1);

      // Expiry clears the limiter but deliberately does not emit a trailing event.
      await vi.advanceTimersByTimeAsync(1);
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);

      vi.setSystemTime(baseTime + RATE_LIMIT_WINDOW_MS + 1);
      telemetryHub.trackError(err);

      await vi.advanceTimersByTimeAsync(10);
      expect(mockSentryTransport).toHaveBeenCalledTimes(2);
      expect(mockSentryTransport.mock.calls[1][1].count).toBe(1);
      expect(mockSentryTransport.mock.calls[1][1].firstSeen).toBe(baseTime + RATE_LIMIT_WINDOW_MS + 1);
    });

    it('recovers cleanly when setTimeout is delayed and a subsequent error arrives after expiry', async () => {
      vi.useFakeTimers();
      const baseTime = 1724486400000;
      vi.setSystemTime(baseTime);

      telemetryHub.init();
      telemetryHub.setUserId('user_delayed_timer');

      const err = new Error('Lagging event loop error');
      telemetryHub.trackError(err); // t = 0
      await vi.advanceTimersByTimeAsync(10);
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);

      const afterExpiry = RATE_LIMIT_WINDOW_MS + 5000;
      // Simulate system clock jumping past the configured window before the timer runs.
      vi.setSystemTime(baseTime + afterExpiry);

      telemetryHub.trackError(err);
      await vi.advanceTimersByTimeAsync(10);

      // Should have recognized stale rate limiter, reset it, and dispatched a new window
      expect(mockSentryTransport).toHaveBeenCalledTimes(2);
      expect(mockSentryTransport.mock.calls[1][1].count).toBe(1);
      expect(mockSentryTransport.mock.calls[1][1].firstSeen).toBe(baseTime + afterExpiry);
    });
  });

  // =========================================================================
  // 3. Hanging telemetry transport & Non-Blocking Resilience
  // =========================================================================
  describe('3. Hanging telemetry transport & Non-Blocking Resilience', () => {
    it('survives indefinitely hanging external telemetry dispatch promises with 5000ms timeout race', async () => {
      vi.useFakeTimers();
      // Mock Sentry transport with a promise that never settles
      mockSentryTransport.mockImplementation(() => new Promise(() => {}));

      telemetryHub.init();
      telemetryHub.setUserId('user_hanging_sentry');

      // Track 20 distinct errors synchronously.
      // The transport promises never settle; tracking must still return.
      for (let i = 0; i < 20; i++) {
        telemetryHub.trackError(new Error(`Hanging error ${i}`));
      }

      // Date.now() is frozen under fake timers and cannot measure elapsed
      // execution time; assert observable progress instead.
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(20);

      // Before the timeout all 20 dispatches must have reached transport,
      // otherwise the test could pass because of an owner/offline guard.
      await vi.advanceTimersByTimeAsync(TELEMETRY_DISPATCH_TIMEOUT_MS - 1);
      expect(mockSentryTransport).toHaveBeenCalledTimes(20);

      await vi.advanceTimersByTimeAsync(100);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(20);
    });

    it('properly returns false from direct dispatchErrorExternally when dispatch hangs', async () => {
      vi.useFakeTimers();
      mockSentryTransport.mockImplementation(() => new Promise(() => {}));

      telemetryHub.init();
      telemetryHub.setUserId('user_hang_direct');

      const payload: TelemetryErrorPayload = {
        type: 'Error',
        message: 'Direct hang test',
        source: 'custom',
        context: {
          appVersion: APP_VERSION,
          displayMode: 'browser',
          platform: 'other',
          online: true,
        },
        userId: 'user_hang_direct',
        sessionId: 'sess_1',
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      };

      const dispatchPromise = telemetryHub.dispatchErrorExternally(payload);
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(TELEMETRY_DISPATCH_TIMEOUT_MS + 100);

      expect(await dispatchPromise).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // =========================================================================
  // 4. Offline Capacity, Error-Priority Trimming & Flapping Network
  // =========================================================================
  describe('4. Offline Capacity, Error-Priority Trimming & Flapping Network', () => {
    it('strictly maintains TELEMETRY_QUEUE_CAPACITY (50) under an avalanche of 300 offline items', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_avalanche');

      for (let i = 1; i <= 300; i++) {
        if (i % 2 === 0) {
          telemetryHub.trackError(new Error(`Offline error ${i}`));
        } else {
          // The unused standalone event path has been retired.
        }
      }

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(TELEMETRY_QUEUE_CAPACITY); // 50 items

      // Keep the newest fifty errors ordered 202, 204, ... 300.
      expect(queue.every(item => item.itemType === 'error')).toBe(true);
      for (let idx = 0; idx < queue.length; idx++) {
        expect((queue[idx].payload as TelemetryErrorPayload).message)
          .toBe(`Offline error ${202 + idx * 2}`);
      }


      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('handles network flapping during flushQueue without losing unflushed items', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_flapping');

      // Seed the current encrypted owner-scoped queue with 5 items
      const items = [
        { id: 'item_1', timestamp: Date.now() + 1, itemType: 'error' as const, payload: { timestamp: Date.now() + 1, type: 'Error', message: 'failure 1', source: 'custom' as const, context: {} as any, userId: 'user_flapping', sessionId: 's1', count: 1, firstSeen: Date.now(), lastSeen: Date.now() } },
        { id: 'item_2', timestamp: Date.now() + 2, itemType: 'error' as const, payload: { timestamp: Date.now() + 2, type: 'Error', message: 'failure 2', source: 'custom' as const, context: {} as any, userId: 'user_flapping', sessionId: 's1', count: 1, firstSeen: Date.now(), lastSeen: Date.now() } },
        { id: 'item_3', timestamp: Date.now() + 3, itemType: 'error' as const, payload: { timestamp: Date.now() + 3, type: 'Error', message: 'failure 3', source: 'custom' as const, context: {} as any, userId: 'user_flapping', sessionId: 's1', count: 1, firstSeen: Date.now(), lastSeen: Date.now() } },
        { id: 'item_4', timestamp: Date.now() + 4, itemType: 'error' as const, payload: { timestamp: Date.now() + 4, type: 'Error', message: 'failure 4', source: 'custom' as const, context: {} as any, userId: 'user_flapping', sessionId: 's1', count: 1, firstSeen: Date.now(), lastSeen: Date.now() } },
        { id: 'item_5', timestamp: Date.now() + 5, itemType: 'error' as const, payload: { timestamp: Date.now() + 5, type: 'Error', message: 'failure 5', source: 'custom' as const, context: {} as any, userId: 'user_flapping', sessionId: 's1', count: 1, firstSeen: Date.now(), lastSeen: Date.now() } },
      ];
      await seedCurrentTelemetryQueue('user_flapping', items);

      // Simulate first 2 sends succeeding and later transport failures
      let callCount = 0;
      mockSentryTransport.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(true);
        }
        return Promise.reject(new Error('Network disconnected mid-flush'));
      });

      await telemetryHub.flushQueue();

      const remainingQueue = telemetryHub.getQueuedEvents();
      expect(remainingQueue.length).toBe(3);
      expect(remainingQueue.map(i => i.id)).toEqual(['item_3', 'item_4', 'item_5']);
    });
  });

  // =========================================================================
  // 5. Corrupted Storage & Extreme Payload Defense
  // =========================================================================
  describe('5. Corrupted Storage & Extreme Payload Defense', () => {
    it('safely handles deeply nested and circular error objects during trackError', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_circular');

      const circularObj: any = { message: 'Circular problem' };
      circularObj.nested = { parent: circularObj };

      expect(() => telemetryHub.trackError(circularObj)).not.toThrow();

      await vi.advanceTimersByTimeAsync(50);
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
      const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.message).toContain('Circular problem');
    });

    it('handles giant stack traces (50,000 characters) without payload explosion', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_giant_stack');

      const hugeStack = 'Error: giant stack\n' + '    at evaluateDeepTree (virtual.js:1:1)\n'.repeat(1500);
      const hugeError = new Error('Giant stack error');
      hugeError.stack = hugeStack;

      telemetryHub.trackError(hugeError);

      await vi.advanceTimersByTimeAsync(50);
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);

      const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.stack).toBeDefined();
      // Stack should be truncated to <= 1000 chars as per telemetrySanitizer truncateStack
      expect(payload.stack!.length).toBeLessThanOrEqual(1000);
      expect(payload.stack).toContain('...[TRUNCATED]');
    });
  });

  // =========================================================================
  // 6. Guest Mode & Auth Edge Cases
  // =========================================================================
  describe('6. Guest Mode & Auth Edge Cases', () => {
    it('enqueues in offline mode but does not dispatch when user is guest', async () => {
      localStorage.setItem('logbook_is_guest', 'true');
      telemetryHub.init();
      telemetryHub.setUserId(null);

      // Offline track
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.trackError(new Error('Guest offline error'));

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      expect((queue[0].payload as TelemetryErrorPayload).userId).toBeNull();

      // Go online
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      // Since userId is null; guest reports are never sent to the Sentry transport
      expect(mockSentryTransport).not.toHaveBeenCalled();
    });
  });
});
