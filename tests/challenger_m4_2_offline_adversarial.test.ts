import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import {
  telemetryHub,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
  type QueuedTelemetryItem,
} from '../src/lib/telemetryHub';
import { getTelemetryContext } from '../src/lib/telemetrySanitizer';

describe('Empirical Challenger M4.2: Offline Queue, Circuit Breaker & Poison Pill Hardening', () => {
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

    if (telemetryHub && typeof telemetryHub.reset === 'function') {
      telemetryHub.reset();
    }
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    if (telemetryHub && typeof telemetryHub.reset === 'function') {
      telemetryHub.reset();
    }
  });

  // -------------------------------------------------------------------------
  // Challenge 1: Offline 100-Item Enqueue and Strict FIFO Eviction (50 Cap)
  // -------------------------------------------------------------------------
  describe('Challenge 1: Offline Enqueue & Strict FIFO Eviction', () => {
    it('enqueues 100 items while offline and verifies queue strictly retains the newest 50 items (FIFO eviction)', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_fifo_stress');

      // Enqueue 100 mixed items (50 events, 50 distinct errors)
      for (let i = 1; i <= 100; i++) {
        if (i % 2 === 0) {
          telemetryHub.trackEvent(`test_event_${i}`, { index: i, seq: `seq_${i}` });
        } else {
          telemetryHub.trackError(new Error(`test_error_${i}`));
        }
      }

      const raw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
      expect(raw).not.toBeNull();
      const storedQueue: QueuedTelemetryItem[] = JSON.parse(raw!);
      expect(storedQueue.length).toBe(TELEMETRY_QUEUE_CAPACITY);
      expect(storedQueue.length).toBe(50);

      const inMemoryQueue = telemetryHub.getQueuedEvents();
      expect(inMemoryQueue.length).toBe(50);

      // Verify that items 1..50 were evicted, and items 51..100 are strictly preserved in order
      expect(inMemoryQueue[0].payload.type).toBe('Error');
      expect((inMemoryQueue[0].payload as TelemetryErrorPayload).message).toBe('test_error_51');

      expect(inMemoryQueue[49].payload.type).toBe('test_event_100');
      expect((inMemoryQueue[49].payload as TelemetryEventPayload).details?.index).toBeUndefined();

      // Verify intermediate sequence order; arbitrary test metadata is intentionally minimized away.
      for (let idx = 0; idx < 50; idx++) {
        const itemNumber = 51 + idx;
        const item = inMemoryQueue[idx];
        if (itemNumber % 2 === 0) {
          expect(item.payload.type).toBe(`test_event_${itemNumber}`);
        } else {
          expect(item.payload.type).toBe('Error');
          expect((item.payload as TelemetryErrorPayload).message).toBe(`test_error_${itemNumber}`);
        }
      }

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });
  });

  // -------------------------------------------------------------------------
  // Challenge 2: Network Failure, Immediate Circuit Breaker & Exponential Backoff
  // -------------------------------------------------------------------------
  describe('Challenge 2: Network Failure & Immediate Circuit Breaker Tripping', () => {
    it('simulates network failure during flushQueue(), verifies circuit breaker trips immediately without cascading timeouts, and schedules exponential backoff', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_circuit_breaker');

      // Populate queue with 20 items
      const initialItems: QueuedTelemetryItem[] = Array.from({ length: 20 }, (_, i) => ({
        id: `item_${i + 1}`,
        timestamp: 1724486400000 + i * 100,
        itemType: 'event',
        payload: {
          id: `evt_${i + 1}`,
          type: `event_${i + 1}`,
          context: getTelemetryContext(),
          userId: 'user_circuit_breaker',
          sessionId: 'sess_cb',
          timestamp: 1724486400000 + i * 100,
        },
      }));
      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(initialItems));

      // Mock setDoc: Item 1 succeeds, then sudden network failure for subsequent items
      mockSetDoc
        .mockResolvedValueOnce(undefined as any)
        .mockRejectedValue(new Error('Network unreachable: connection reset by peer'));

      await telemetryHub.flushQueue();

      // Assertions:
      // 1. mockSetDoc should only have been called 3 times (1 success + 2 consecutive failures triggering circuit breaker)
      //    It must NOT iterate through all 20 items (which would cause 20 calls or cascading 5s timeouts).
      expect(mockSetDoc).toHaveBeenCalledTimes(3);

      // 2. Queue must retain item 1 evicted (success), item 2 and 3 incremented retry count, items 4..20 preserved
      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(19);
      expect(remaining[0].id).toBe('item_2');
      expect(remaining[0].retryCount).toBe(1);
      expect(remaining[1].id).toBe('item_3');
      expect(remaining[1].retryCount).toBe(1);
      expect(remaining[18].id).toBe('item_20');

      // 3. Exponential backoff verification:
      // First retry scheduled after INITIAL_RETRY_DELAY_MS (1000ms * 2^0 = 1000ms)
      mockSetDoc.mockReset();
      // On next retry, simulate network restoration
      mockSetDoc.mockResolvedValue(undefined as any);

      // Advance by 500ms (should not have triggered yet)
      await vi.advanceTimersByTimeAsync(500);
      expect(mockSetDoc).not.toHaveBeenCalled();

      // Advance remaining 500ms (1000ms total) -> triggers automatic flush
      await vi.advanceTimersByTimeAsync(500);
      expect(mockSetDoc).toHaveBeenCalled();

      // Wait for microtasks in flushQueue to settle
      await vi.waitFor(() => {
        const finalQueue = telemetryHub.getQueuedEvents();
        expect(finalQueue.length).toBe(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Challenge 3: Poison Pill Eviction (Max 3 Retries) without Blocking Subqueue
  // -------------------------------------------------------------------------
  describe('Challenge 3: Poison Pill Item Isolation & Eviction', () => {
    it('injects a poison pill item that always rejects and verifies it is evicted after 3 attempts without blocking subsequent valid items', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_poison_pill');

      const queueWithPoisonPill: QueuedTelemetryItem[] = [
        {
          id: 'poison_pill_bad_payload',
          timestamp: Date.now(),
          itemType: 'error',
          payload: {
            id: 'err_poison_1',
            type: 'CorruptedPayloadError',
            message: 'Permanently fails Firestore validation',
            source: 'custom',
            context: getTelemetryContext(),
            userId: 'user_poison_pill',
            sessionId: 'sess_poison',
            count: 1,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
          },
          retryCount: 0,
        },
      ];

      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(queueWithPoisonPill));

      // Configure mock: Poison pill rejects
      mockSetDoc.mockRejectedValue(new Error('Firestore write permanently rejected for poison pill'));

      // --- Attempt 1 ---
      await telemetryHub.flushQueue();
      let q = telemetryHub.getQueuedEvents();
      expect(q.length).toBe(1);
      expect(q[0].id).toBe('poison_pill_bad_payload');
      expect(q[0].retryCount).toBe(1);

      // --- Attempt 2 (via backoff after 1000ms) ---
      await vi.advanceTimersByTimeAsync(1000);
      q = telemetryHub.getQueuedEvents();
      expect(q.length).toBe(1);
      expect(q[0].retryCount).toBe(2);

      // --- Attempt 3 (via backoff after 2000ms) ---
      await vi.advanceTimersByTimeAsync(2000);
      q = telemetryHub.getQueuedEvents();
      expect(q.length).toBe(1);
      expect(q[0].retryCount).toBe(3);

      // --- Attempt 4 (via backoff after 4000ms) -> exceeds MAX_ITEM_RETRIES (3) -> poison pill evicted! ---
      await vi.advanceTimersByTimeAsync(4000);
      q = telemetryHub.getQueuedEvents();
      expect(q.length).toBe(0);

      // Now verify a newly added valid event can be flushed immediately without interference
      mockSetDoc.mockResolvedValue(undefined as any);
      telemetryHub.trackEvent('fresh_after_poison_cleared');
      await vi.advanceTimersByTimeAsync(100);
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('processes a heterogeneous queue where a poison pill item fails while subsequent items can be retried and flushed once poison is evicted', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_poison_hetero');

      const items: QueuedTelemetryItem[] = [
        {
          id: 'poison_item',
          timestamp: 1000,
          itemType: 'error',
          payload: {
            id: 'err_poison',
            type: 'PoisonType',
            message: 'Reject always',
            source: 'custom',
            context: getTelemetryContext(),
            userId: 'user_poison_hetero',
            sessionId: 'sess_1',
            count: 1,
            firstSeen: 1000,
            lastSeen: 1000,
          },
          retryCount: 0,
        },
        {
          id: 'valid_item_after',
          timestamp: 2000,
          itemType: 'event',
          payload: {
            id: 'evt_valid_after',
            type: 'workout_saved',
            context: getTelemetryContext(),
            userId: 'user_poison_hetero',
            sessionId: 'sess_1',
            timestamp: 2000,
          },
          retryCount: 0,
        },
      ];

      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items));

      // Mock: poison fails, valid succeeds
      mockSetDoc.mockImplementation(async (_ref: any, data: any) => {
        if (data.type === 'PoisonType' || data.message?.includes('Reject always')) {
          throw new Error('Poison rejected');
        }
        return undefined;
      });

      // Flush: poison fails (retry 1), valid succeeds and is evicted!
      await telemetryHub.flushQueue();

      let q = telemetryHub.getQueuedEvents();
      expect(q.length).toBe(1);
      expect(q[0].id).toBe('poison_item');
      expect(q[0].retryCount).toBe(1);

      // Next attempt: manual flush
      await telemetryHub.flushQueue();
      q = telemetryHub.getQueuedEvents();
      expect(q[0].retryCount).toBe(2);

      // Third attempt
      await telemetryHub.flushQueue();
      q = telemetryHub.getQueuedEvents();
      expect(q[0].retryCount).toBe(3);

      // Fourth attempt -> evicted
      await telemetryHub.flushQueue();
      q = telemetryHub.getQueuedEvents();
      expect(q.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Challenge 4: Malformed and Corrupted JSON Storage Recovery
  // -------------------------------------------------------------------------
  describe('Challenge 4: Corrupted Storage Recovery', () => {
    it('handles corrupted and truncated JSON in logbook_telemetry_queue, recovers without crashing, and restores clean queue operations', () => {
      const corruptedPayloads = [
        '{ truncated json',
        '{"id": "broken", invalid syntax}',
        'null',
        'undefined',
        '12345',
        '"just a string"',
        '{"someObj": true}',
        '[{ "id": 123 }, null, undefined, { "noPayload": true }]',
      ];

      for (const corrupt of corruptedPayloads) {
        const ownerKey = telemetryHub.getQueueStorageKey();
        localStorage.removeItem(ownerKey);
        localStorage.setItem(TELEMETRY_QUEUE_KEY, corrupt);
        telemetryHub.init();

        // 1. Must safely return an empty array or valid array of items without throwing
        let items: QueuedTelemetryItem[] = [];
        expect(() => {
          items = telemetryHub.getQueuedEvents();
        }).not.toThrow();
        expect(Array.isArray(items)).toBe(true);

        // 2. Next trackEvent/trackError while offline must successfully write a valid JSON array to localStorage
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        expect(() => {
          telemetryHub.trackEvent('recovery_event_check', { corruptPayloadTested: true });
        }).not.toThrow();

        const repairedRaw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
        expect(repairedRaw).not.toBeNull();
        const parsed = JSON.parse(repairedRaw!);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(1);
        expect(parsed[0].payload.type).toBe('recovery_event_check');

        telemetryHub.destroy();
        localStorage.removeItem(ownerKey);
      }

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });
  });
});
