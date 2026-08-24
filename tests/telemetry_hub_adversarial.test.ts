import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import {
  telemetryHub,
  RATE_LIMIT_WINDOW_MS,
  FIRESTORE_DISPATCH_TIMEOUT_MS,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';
import { APP_VERSION } from '../src/lib/telemetrySanitizer';

describe('Adversarial Stress & Edge-Case Suite: TelemetryHub', () => {
  let mockSetDoc: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();

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

      // Exactly 1 Firestore write should be triggered with count = 500
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const callPayload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(callPayload.count).toBe(500);
      expect(callPayload.type).toBe('TypeError');

      // Now advance time through the remaining window (60s) without further errors
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_WINDOW_MS);

      // No redundant trailing dispatch since count (500) == lastDispatchedCount (500)
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
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
      expect(mockSetDoc).toHaveBeenCalledTimes(distinctErrorCount);
      for (let i = 0; i < distinctErrorCount; i++) {
        const payload = mockSetDoc.mock.calls[i][1] as TelemetryErrorPayload;
        expect(payload.count).toBe(5);
      }

      // Fast forward past 60s
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_WINDOW_MS);
      // No extra dispatches since no new errors occurred
      expect(mockSetDoc).toHaveBeenCalledTimes(distinctErrorCount);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
    });
  });

  // =========================================================================
  // 2. Sliding Window Boundary Precision (59,999ms vs 60,001ms)
  // =========================================================================
  describe('2. Sliding Window Boundary Precision', () => {
    it('correctly aggregates at 59,999ms and starts a new window at 60,001ms', async () => {
      vi.useFakeTimers();
      const baseTime = 1724486400000;
      vi.setSystemTime(baseTime);

      telemetryHub.init();
      telemetryHub.setUserId('user_boundary_test');

      const err = new Error('Boundary error test');

      // t = 0ms -> Initial occurrence
      telemetryHub.trackError(err);
      await vi.advanceTimersByTimeAsync(10);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(mockSetDoc.mock.calls[0][1].count).toBe(1);

      // t = 59,999ms -> Boundary just before 60s window expiration
      // Advance fake timers to 59,999ms
      await vi.advanceTimersByTimeAsync(59989); // from 10ms to 59,999ms
      vi.setSystemTime(baseTime + 59999);
      telemetryHub.trackError(err);

      // Should still be suppressed, no new dispatch yet
      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      // Advance 1ms to t = 60,000ms -> Timer triggers trailing flush
      await vi.advanceTimersByTimeAsync(1);
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      expect(mockSetDoc.mock.calls[1][1].count).toBe(2);
      expect(mockSetDoc.mock.calls[1][1].lastSeen).toBe(baseTime + 59999);

      // Advance 1ms to t = 60,001ms -> New error arrives
      await vi.advanceTimersByTimeAsync(1);
      vi.setSystemTime(baseTime + 60001);
      telemetryHub.trackError(err);

      await vi.advanceTimersByTimeAsync(10);
      expect(mockSetDoc).toHaveBeenCalledTimes(3);
      // New window started, count reset to 1
      expect(mockSetDoc.mock.calls[2][1].count).toBe(1);
      expect(mockSetDoc.mock.calls[2][1].firstSeen).toBe(baseTime + 60001);
    });

    it('recovers cleanly when setTimeout is delayed and subsequent error arrives at t=65s', async () => {
      vi.useFakeTimers();
      const baseTime = 1724486400000;
      vi.setSystemTime(baseTime);

      telemetryHub.init();
      telemetryHub.setUserId('user_delayed_timer');

      const err = new Error('Lagging event loop error');
      telemetryHub.trackError(err); // t = 0
      await vi.advanceTimersByTimeAsync(10);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      // Simulate system clock jumped to +65s before setTimeout could run
      vi.setSystemTime(baseTime + 65000);

      // Next error arrives at t = 65s
      telemetryHub.trackError(err);
      await vi.advanceTimersByTimeAsync(10);

      // Should have recognized stale rate limiter, reset it, and dispatched a new window
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      expect(mockSetDoc.mock.calls[1][1].count).toBe(1);
      expect(mockSetDoc.mock.calls[1][1].firstSeen).toBe(baseTime + 65000);
    });
  });

  // =========================================================================
  // 3. Hanging Firestore & Non-Blocking Resilience
  // =========================================================================
  describe('3. Hanging Firestore & Non-Blocking Resilience', () => {
    it('survives indefinitely hanging Firestore setDoc promises with 5000ms timeout race', async () => {
      vi.useFakeTimers();
      // Mock setDoc returning a Promise that NEVER settles
      mockSetDoc.mockImplementation(() => new Promise(() => {}));

      telemetryHub.init();
      telemetryHub.setUserId('user_hanging_firestore');

      const start = Date.now();
      // Track 20 errors and 20 events synchronously
      for (let i = 0; i < 20; i++) {
        telemetryHub.trackError(new Error(`Hanging error ${i}`));
        telemetryHub.trackEvent(`hanging_event_${i}`);
      }

      // Synchronous execution is immediate (non-blocking)
      expect(Date.now() - start).toBeLessThan(100);

      // Advance by 4999ms (before timeout)
      await vi.advanceTimersByTimeAsync(4999);
      // No crashes

      // Advance past 5000ms timeout threshold
      await vi.advanceTimersByTimeAsync(100);

      // Hub remains fully functional
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(20);
    });

    it('properly returns false from direct dispatchErrorToFirestore when setDoc hangs', async () => {
      vi.useFakeTimers();
      mockSetDoc.mockImplementation(() => new Promise(() => {}));

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

      const dispatchPromise = telemetryHub.dispatchErrorToFirestore(payload);

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(FIRESTORE_DISPATCH_TIMEOUT_MS + 100);

      const result = await dispatchPromise;
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // 4. Offline Capacity, FIFO Trimming & Flapping Network
  // =========================================================================
  describe('4. Offline Capacity, FIFO Trimming & Flapping Network', () => {
    it('strictly maintains TELEMETRY_QUEUE_CAPACITY (50) under an avalanche of 300 offline items', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_avalanche');

      for (let i = 1; i <= 300; i++) {
        if (i % 2 === 0) {
          telemetryHub.trackError(new Error(`Offline error ${i}`));
        } else {
          telemetryHub.trackEvent(`offline_event_${i}`);
        }
      }

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(TELEMETRY_QUEUE_CAPACITY); // 50 items

      // Check FIFO: first item in queue must be item #251
      const firstItem = queue[0];
      if (firstItem.itemType === 'event') {
        expect(firstItem.payload.type).toBe('offline_event_251');
      } else {
        expect((firstItem.payload as TelemetryErrorPayload).message).toContain('251');
      }

      // Last item in queue must be item #300
      const lastItem = queue[queue.length - 1];
      if (lastItem.itemType === 'error') {
        expect((lastItem.payload as TelemetryErrorPayload).message).toContain('300');
      } else {
        expect(lastItem.payload.type).toBe('offline_event_300');
      }

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('handles network flapping during flushQueue without losing unflushed items', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_flapping');

      // Populate queue with 5 items in localStorage
      const items = [
        { id: 'item_1', timestamp: 1, itemType: 'event' as const, payload: { timestamp: 1, type: 'evt1', context: {} as any, userId: 'user_flapping', sessionId: 's1' } },
        { id: 'item_2', timestamp: 2, itemType: 'event' as const, payload: { timestamp: 2, type: 'evt2', context: {} as any, userId: 'user_flapping', sessionId: 's1' } },
        { id: 'item_3', timestamp: 3, itemType: 'event' as const, payload: { timestamp: 3, type: 'evt3', context: {} as any, userId: 'user_flapping', sessionId: 's1' } },
        { id: 'item_4', timestamp: 4, itemType: 'event' as const, payload: { timestamp: 4, type: 'evt4', context: {} as any, userId: 'user_flapping', sessionId: 's1' } },
        { id: 'item_5', timestamp: 5, itemType: 'event' as const, payload: { timestamp: 5, type: 'evt5', context: {} as any, userId: 'user_flapping', sessionId: 's1' } },
      ];
      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items));

      // Simulate first 2 writes succeed, 3rd fails, 4th and 5th fail
      let callCount = 0;
      mockSetDoc.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve();
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
    it('recovers gracefully from corrupted JSON in localStorage queue', () => {
      localStorage.setItem(TELEMETRY_QUEUE_KEY, '{ broken json syntax }!!');
      telemetryHub.init();

      expect(telemetryHub.getQueuedEvents()).toEqual([]);

      // Adding a new item resets localStorage to a valid array
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.trackEvent('recovery_event');

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      expect(queue[0].payload.type).toBe('recovery_event');
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('safely handles deeply nested and circular error objects during trackError', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_circular');

      const circularObj: any = { message: 'Circular problem' };
      circularObj.nested = { parent: circularObj };

      expect(() => telemetryHub.trackError(circularObj)).not.toThrow();

      await vi.advanceTimersByTimeAsync(50);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
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
      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
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

      // Since userId is null, dispatchErrorToFirestore returns false without calling setDoc, retaining or skipping safely
      expect(mockSetDoc).not.toHaveBeenCalled();
    });
  });
});
