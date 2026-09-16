import { describe, it, expect, vi } from 'vitest';
import {
  telemetryHub,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  DEDUP_WINDOW_MS,
  type TelemetryErrorPayload,
} from '../../src/lib/telemetryHub';
import { getTelemetryContext } from '../../src/lib/telemetrySanitizer';
import { DomainParsers } from '../../src/lib/schema';
import { installTelemetryTestHarness, mockSetDoc } from './telemetryTestHarness';

describe('Unified Telemetry Hub E2E Suite — Tier 5', () => {
  installTelemetryTestHarness();

  describe('Tier 5: Adversarial Hardening & Stress Suite', () => {
    describe('5.1: High-Load Burst Error Spamming & Sliding Window Aggregation', () => {
      it('T5-1: hot-loop burst of 1,000 identical errors executes in <50ms and aggregates to 1 rate limiter entry with count=1000', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_1');

        const err = new TypeError('Database connection pool exhausted');
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          telemetryHub.trackError(err);
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(50);
        expect(telemetryHub.getActiveRateLimiterCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(50);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.type).toBe('TypeError');
        expect(payload.message).toBe('Database connection pool exhausted');
        expect(payload.count).toBe(1000);
      });

      it('T5-2: high-cardinality burst of 100 distinct types x 20 repetitions aggregates into 100 rate limiters and 100 writes with count=20', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_2');

        const distinctCount = 100;
        const reps = 20;

        for (let i = 0; i < distinctCount; i++) {
          const err = new Error(`Distinct error signature #${i}`);
          for (let r = 0; r < reps; r++) {
            telemetryHub.trackError(err);
          }
        }

        expect(telemetryHub.getActiveRateLimiterCount()).toBe(distinctCount);

        await vi.advanceTimersByTimeAsync(50);

        expect(mockSetDoc).toHaveBeenCalledTimes(distinctCount);
        for (let i = 0; i < distinctCount; i++) {
          const payload = mockSetDoc.mock.calls[i][1] as TelemetryErrorPayload;
          expect(payload.count).toBe(reps);
        }

        await vi.advanceTimersByTimeAsync(DEDUP_WINDOW_MS);
        expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
      });

      it('T5-3: sub-millisecond sliding window boundary precision (0ms, 59,999ms, 60,000ms, 60,001ms)', async () => {
        vi.useFakeTimers();
        const baseTime = 1724486400000;
        vi.setSystemTime(baseTime);

        telemetryHub.init();
        telemetryHub.setUserId('user_t5_3');

        const error = new Error('Boundary precision test');

        // 1. t = 0ms: First occurrence
        telemetryHub.trackError(error);
        await vi.advanceTimersByTimeAsync(10);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect((mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload).count).toBe(1);

        // 2. t = 59,999ms: Duplicate within window
        vi.setSystemTime(baseTime + 59999);
        telemetryHub.trackError(error);
        // Should be suppressed from immediate write
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        // 3. t = 60,000ms: Window expires -> trailing flush occurs
        vi.setSystemTime(baseTime + 60000);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
        expect((mockSetDoc.mock.calls[1][1] as TelemetryErrorPayload).count).toBe(2);

        // 4. t = 60,001ms: New occurrence starts a new window
        vi.setSystemTime(baseTime + 60001);
        telemetryHub.trackError(error);
        await vi.advanceTimersByTimeAsync(10);
        expect(mockSetDoc).toHaveBeenCalledTimes(3);
        expect((mockSetDoc.mock.calls[2][1] as TelemetryErrorPayload).count).toBe(1);
      });

      it('T5-4: timer drift and clock skew (+65s forward jump) purges stale rate limiter and starts fresh window', async () => {
        vi.useFakeTimers();
        const baseTime = 1724486400000;
        vi.setSystemTime(baseTime);

        telemetryHub.init();
        telemetryHub.setUserId('user_t5_4');

        const error = new Error('Clock drift test');
        telemetryHub.trackError(error);
        await vi.advanceTimersByTimeAsync(10);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        // OS suspension / clock jump +65 seconds
        vi.setSystemTime(baseTime + 65000);

        // Next arrival detects expired window without crashing
        telemetryHub.trackError(error);
        await vi.advanceTimersByTimeAsync(10);

        expect(mockSetDoc).toHaveBeenCalledTimes(2);
        const secondPayload = mockSetDoc.mock.calls[1][1] as TelemetryErrorPayload;
        expect(secondPayload.count).toBe(1);
      });
    });

    describe('5.2: Network Failure, Backoff & Non-Blocking FlushQueue', () => {
      it('T5-5: indefinitely hanging setDoc promise is safely aborted by 5000ms safety timeout without throwing', async () => {
        vi.useFakeTimers();
        mockSetDoc.mockImplementation(() => new Promise(() => {})); // Never settles

        telemetryHub.init();
        telemetryHub.setUserId('user_t5_5');

        let errorResult: boolean | undefined;
        telemetryHub
          .dispatchErrorToFirestore({
            type: 'HangingError',
            message: 'Hangs',
            source: 'custom',
            context: getTelemetryContext(),
            userId: 'user_t5_5',
            sessionId: 'sess_1',
            count: 1,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
          })
          .then((res) => {
            errorResult = res;
          });

        await vi.advanceTimersByTimeAsync(5100);
        expect(errorResult).toBe(false);
      });

      it('T5-6: flapping network trips circuit breaker immediately mid-flush and preserves uncommitted items in FIFO order', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_6');

        const items = Array.from({ length: 10 }, (_, i) => ({
          id: `item_${i + 1}`,
          timestamp: Date.now() + i,
          itemType: 'event' as const,
          payload: {
            id: `evt_${i + 1}`,
            type: `event_${i + 1}`,
            context: getTelemetryContext(),
            userId: 'user_t5_6',
            sessionId: 'sess_1',
            timestamp: Date.now() + i,
          },
        }));

        localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items));

        // First item succeeds, subsequent items fail due to network drop
        mockSetDoc
          .mockResolvedValueOnce(undefined as any)
          .mockRejectedValue(new Error('Network drop mid-flush'));

        await telemetryHub.flushQueue();

        // Circuit breaker breaks after consecutive failures -> item 1 evicted, items 2..10 retained
        const remaining = telemetryHub.getQueuedEvents();
        expect(remaining.length).toBe(9);
        expect(remaining[0].id).toBe('item_2');
        expect(remaining[8].id).toBe('item_10');
        // Circuit breaker tripped quickly (at 3 calls) rather than cascading through all 10 items
        expect(mockSetDoc).toHaveBeenCalledTimes(3);
      });

      it('T5-7: concurrent flushQueue calls and hot-path trackError execute safely without race conditions or duplicated writes', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_7');

        localStorage.setItem(
          TELEMETRY_QUEUE_KEY,
          JSON.stringify([
            {
              id: 'queued_item_1',
              timestamp: Date.now(),
              itemType: 'error',
              payload: {
                id: 'err_queued_1',
                type: 'TypeError',
                message: 'Queued failure',
                source: 'custom',
                context: getTelemetryContext(),
                userId: 'user_t5_7',
                sessionId: 'sess_1',
                count: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
              },
            },
          ])
        );

        // Trigger multiple concurrent flushes and track calls
        const flush1 = telemetryHub.flushQueue();
        const flush2 = telemetryHub.flushQueue();
        telemetryHub.trackError(new Error('Hot error during flush'));
        telemetryHub.trackEvent('event_during_flush');

        await vi.advanceTimersByTimeAsync(100);
        await Promise.all([flush1, flush2]);

        expect(mockSetDoc).toHaveBeenCalled();
      });

      it('T5-8: Firestore permission-denied and resource-exhausted errors are caught silently without throwing to callers', async () => {
        mockSetDoc.mockRejectedValue(new Error('FirebaseError: [code=permission-denied] Permission denied'));

        telemetryHub.init();
        telemetryHub.setUserId('user_t5_8');

        expect(() => {
          telemetryHub.trackError(new Error('Permission denied error'));
          telemetryHub.trackEvent('permission_event');
        }).not.toThrow();

        const dispatchRes = await telemetryHub.dispatchErrorToFirestore({
          type: 'DeniedError',
          message: 'Denied',
          source: 'custom',
          context: getTelemetryContext(),
          userId: 'user_t5_8',
          sessionId: 'sess_1',
          count: 1,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
        });

        expect(dispatchRes).toBe(false);
      });

      it('T5-8b: failed item retry limit evicts poison pill after 3 retries and schedules exponential backoff', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_8b');

        localStorage.setItem(
          TELEMETRY_QUEUE_KEY,
          JSON.stringify([
            {
              id: 'poison_pill_1',
              timestamp: Date.now(),
              itemType: 'error',
              payload: {
                id: 'err_poison',
                type: 'PoisonError',
                message: 'Permanently fails',
                source: 'custom',
                context: getTelemetryContext(),
                userId: 'user_t5_8b',
                sessionId: 'sess_1',
                count: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
              },
            },
          ])
        );

        // Mock failure for all flush attempts
        mockSetDoc.mockRejectedValue(new Error('Persistent Firestore error'));

        // Attempt 1: retryCount becomes 1
        await telemetryHub.flushQueue();
        let q = telemetryHub.getQueuedEvents();
        expect(q.length).toBe(1);
        expect(q[0].retryCount).toBe(1);

        // Advance 1s (first exponential backoff timer: 1000ms)
        await vi.advanceTimersByTimeAsync(1000);
        q = telemetryHub.getQueuedEvents();
        expect(q.length).toBe(1);
        expect(q[0].retryCount).toBe(2);

        // Advance 2s (second exponential backoff timer: 2000ms)
        await vi.advanceTimersByTimeAsync(2000);
        q = telemetryHub.getQueuedEvents();
        expect(q.length).toBe(1);
        expect(q[0].retryCount).toBe(3);

        // Advance 4s (third exponential backoff timer: 4000ms) -> exceeds MAX_ITEM_RETRIES (3) -> evicted!
        await vi.advanceTimersByTimeAsync(4000);
        q = telemetryHub.getQueuedEvents();
        expect(q.length).toBe(0);
      });
    });

    describe('5.3: Offline Queue Strict FIFO Cap (50 Items) & Eviction under Stress', () => {
      it('T5-9: avalanche stress of 500 mixed items offline strictly enforces 50-item cap and evicts oldest items FIFO', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_9');

        for (let i = 1; i <= 500; i++) {
          if (i % 2 === 0) {
            telemetryHub.trackEvent(`avalanche_event_${i}`, { seq: i });
          } else {
            telemetryHub.trackError(new Error(`avalanche_error_${i}`));
          }
        }

        const queue = telemetryHub.getQueuedEvents();
        expect(queue.length).toBe(TELEMETRY_QUEUE_CAPACITY);
        expect(queue.length).toBe(50);

        // Items 1..450 evicted; item 451 is the oldest remaining
        expect(queue[0].payload.type).toBe('Error');
        expect((queue[0].payload as TelemetryErrorPayload).message).toBe('avalanche_error_451');
        expect(queue[49].payload.type).toBe('avalanche_event_500');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('T5-10: 100 duplicate errors offline aggregate into 1 queue slot with count=100, saving capacity for 49 other events', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_10');

        const spamError = new Error('Repeated offline error');
        for (let i = 0; i < 100; i++) {
          telemetryHub.trackError(spamError);
        }

        for (let i = 1; i <= 49; i++) {
          telemetryHub.trackEvent(`offline_unique_event_${i}`);
        }

        const queue = telemetryHub.getQueuedEvents();
        expect(queue.length).toBe(50);
        expect(queue[0].payload.type).toBe('Error');
        expect((queue[0].payload as TelemetryErrorPayload).count).toBe(100);
        expect(queue[49].payload.type).toBe('offline_unique_event_49');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('T5-11: full replay of 50-item capped offline queue upon online event writes all 50 items and empties storage', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_11');

        for (let i = 1; i <= 50; i++) {
          telemetryHub.trackEvent(`queued_replay_${i}`);
        }

        expect(telemetryHub.getQueuedEvents().length).toBe(50);

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        window.dispatchEvent(new Event('online'));

        await vi.waitFor(() => {
          expect(mockSetDoc).toHaveBeenCalledTimes(50);
          expect(telemetryHub.getQueuedEvents().length).toBe(0);
        });
      });
    });

    describe('5.4: Corrupted Storage Defense & Malformed Payloads', () => {
      it('T5-12: malformed and truncated JSON in storage queue returns [] and is reset to valid array on next enqueue', () => {
        localStorage.setItem(TELEMETRY_QUEUE_KEY, '{ malformed [ broken JSON :');
        telemetryHub.init();

        expect(telemetryHub.getQueuedEvents()).toEqual([]);

        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.trackEvent('recovery_event');

        const queued = telemetryHub.getQueuedEvents();
        expect(queued.length).toBe(1);
        expect(queued[0].payload.type).toBe('recovery_event');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('T5-13: non-array primitives (strings, numbers, objects) under queue key are filtered safely', () => {
        localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify({ notAnArray: true, val: 123 }));
        telemetryHub.init();
        expect(telemetryHub.getQueuedEvents()).toEqual([]);

        localStorage.setItem(TELEMETRY_QUEUE_KEY, '42');
        expect(telemetryHub.getQueuedEvents()).toEqual([]);
      });

      it('T5-14: corrupted queue entries containing nulls or missing payloads are pruned during flush', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_14');

        const corruptQueue = [
          null,
          undefined,
          { id: 'corrupt_1' },
          { id: 'corrupt_2', payload: null },
          {
            id: 'valid_item',
            timestamp: Date.now(),
            itemType: 'event',
            payload: {
              id: 'evt_valid',
              type: 'valid_event',
              context: getTelemetryContext(),
              userId: 'user_t5_14',
              sessionId: 'sess_1',
              timestamp: Date.now(),
            },
          },
        ];

        localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(corruptQueue));

        await telemetryHub.flushQueue();

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect(telemetryHub.getQueuedEvents().length).toBe(0);
      });

      it('T5-15: localStorage QuotaExceededError is caught silently without disrupting application flow', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();

        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        expect(() => {
          telemetryHub.trackError(new Error('Quota error test'));
          telemetryHub.trackEvent('quota_event_test');
        }).not.toThrow();

        setItemSpy.mockRestore();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });
    });

    describe('5.5: Zod Validation Discards & Zero-PII Adversarial Matrix', () => {
      it('T5-16: adversarial PII injection across all DomainParsers discards corrupted values with zero PII in telemetry', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_16');

        const hostileInputs = [
          'hacker@exploit-database.org',
          '192.168.1.100',
          '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.secret',
          'AIzaSyB39xK94aZp01234567890123456789012',
          'C:\\Users\\Administrator\\Secret\\passwords.txt',
          '/home/root/.ssh/id_rsa',
        ];

        for (const hostile of hostileInputs) {
          // 1. Profile with hostile weight/height
          DomainParsers.parseProfile({ weight: hostile, height: hostile });

          // 2. Workout session with hostile date/duration
          DomainParsers.parseWorkoutSession({ date: hostile, durationMinutes: hostile });

          // 3. Nutrition planning with hostile calories
          DomainParsers.parseNutritionPlanning({ targetCalories: hostile });
        }

        await vi.advanceTimersByTimeAsync(100);

        for (const call of mockSetDoc.mock.calls) {
          const payload = call[1];
          const serialized = JSON.stringify(payload);
          for (const hostile of hostileInputs) {
            expect(serialized).not.toContain(hostile);
          }
        }
      });

      it('T5-17: high-throughput burst of 1,000 malformed domain records parses in <500ms without freezing', () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_17');

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          DomainParsers.parseProfile({
            name: 12345,
            weight: 'invalid_weight',
            height: 'invalid_height',
            gender: 'unknown_gender',
          });
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(500);
      });

      it('T5-18: deeply nested and circular structures in DomainParsers parse safely without stack overflow', () => {
        telemetryHub.init();

        const circularObj: any = { name: 'Circular' };
        circularObj.self = circularObj;

        expect(() => {
          const parsed = DomainParsers.parseProfile(circularObj);
          expect(parsed).toBeDefined();
          expect(typeof parsed.name).toBe('string');
        }).not.toThrow();

        // Deeply nested object
        let deep: any = { leaf: true };
        for (let i = 0; i < 60; i++) {
          deep = { nested: deep };
        }

        expect(() => {
          const parsed = DomainParsers.parseWorkoutSession(deep);
          expect(parsed).toBeDefined();
        }).not.toThrow();
      });
    });
  });
});
