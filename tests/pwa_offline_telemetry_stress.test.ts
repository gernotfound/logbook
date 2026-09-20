import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import {
  telemetryHub,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  FIRESTORE_DISPATCH_TIMEOUT_MS,
  type QueuedTelemetryItem,
  type TelemetryEventPayload,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';

describe('Adversarial Stress Suite: Offline Queue & Online Replay Engine', () => {
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

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
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
  // 1. Queue Overflow & FIFO Eviction Stress Test
  // =========================================================================
  describe('1. Queue Overflow & FIFO Eviction Stress', () => {
    it('handles heavy queue overflow (150 items) maintaining strictly <= 50 capacity and exact FIFO eviction', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_overflow_stress');

      // Push 150 items (mix of events and errors)
      for (let i = 1; i <= 150; i++) {
        if (i % 2 === 0) {
          telemetryHub.trackEvent(`event_${i}`, { sequence: i });
        } else {
          telemetryHub.trackError(new Error(`error_${i}`), { source: 'custom' });
        }
      }

      const raw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
      expect(raw).not.toBeNull();
      const queued = JSON.parse(raw!) as QueuedTelemetryItem[];

      // Capacity must be strictly bounded at TELEMETRY_QUEUE_CAPACITY (50)
      expect(queued.length).toBe(TELEMETRY_QUEUE_CAPACITY);

      // The first remaining item must be item 101 (items 1..100 evicted)
      const firstItem = queued[0];
      const lastItem = queued[queued.length - 1];

      // Item 101 was odd -> error_101
      expect(firstItem.itemType).toBe('error');
      expect((firstItem.payload as TelemetryErrorPayload).message).toBe('error_101');

      // Item 150 was even -> event_150. Test-only arbitrary metadata is minimized away.
      expect(lastItem.itemType).toBe('event');
      expect((lastItem.payload as TelemetryEventPayload).type).toBe('event_150');
      expect((lastItem.payload as TelemetryEventPayload).details?.sequence).toBeUndefined();

      // Verify continuous monotonic sequence from 101 to 150
      for (let idx = 0; idx < queued.length; idx++) {
        const expectedSeq = 101 + idx;
        const item = queued[idx];
        if (expectedSeq % 2 === 0) {
          expect(item.itemType).toBe('event');
          expect((item.payload as TelemetryEventPayload).type).toBe(`event_${expectedSeq}`);
        } else {
          expect(item.itemType).toBe('error');
          expect((item.payload as TelemetryErrorPayload).message).toBe(`error_${expectedSeq}`);
        }
      }
    });
  });

  // =========================================================================
  // 2. Corrupted Queue in localStorage Resilience
  // =========================================================================
  describe('2. Corrupted Queue in localStorage Resilience', () => {
    it('recovers gracefully from syntactically invalid JSON in localStorage', () => {
      localStorage.setItem(TELEMETRY_QUEUE_KEY, '{ invalid json corrupted @#$! %^&*');

      // getQueuedEvents should not crash and return empty array
      const items = telemetryHub.getQueuedEvents();
      expect(items).toEqual([]);

      // Enqueueing new item should overwrite/heal the corrupted storage
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_corrupt_test');

      telemetryHub.trackEvent('healed_event', { status: 'ok' });

      const newItems = telemetryHub.getQueuedEvents();
      expect(newItems.length).toBe(1);
      expect((newItems[0].payload as TelemetryEventPayload).type).toBe('healed_event');
    });

    it('recovers gracefully from non-array JSON types (null, string, number, boolean, object)', () => {
      const badValues = ['null', '"string_value"', '12345', 'true', '{"not":"an_array"}'];

      for (const badVal of badValues) {
        localStorage.setItem(TELEMETRY_QUEUE_KEY, badVal);
        expect(telemetryHub.getQueuedEvents()).toEqual([]);
      }
    });

    it('flushQueue does not throw, purges malformed null payloads, and dispatches surrounding valid items', async () => {
      // Simulate partially malformed queue array with missing payload or invalid structure
      const malformedQueue = [
        { id: 'bad_1', timestamp: Date.now(), itemType: 'event', payload: { id: 'evt_valid_1', type: 'valid_before', context: {}, sessionId: 's1', userId: 'user_malformed_test', timestamp: Date.now() } },
        { id: 'corrupt_item', timestamp: Date.now(), itemType: 'event', payload: null },
        { id: 'bad_2', timestamp: Date.now(), itemType: 'event', payload: { id: 'evt_valid_2', type: 'valid_after', context: {}, sessionId: 's1', userId: 'user_malformed_test', timestamp: Date.now() } },
      ];

      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(malformedQueue));
      telemetryHub.setUserId('user_malformed_test');

      // Should not throw unhandled exception
      await expect(telemetryHub.flushQueue()).resolves.not.toThrow();

      // Surrounding valid items should be dispatched
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });

    it('EMPIRICAL ADVERSARIAL: handles array containing nulls, primitives, empty objects, missing IDs, and primitive payloads', async () => {
      // Extreme hostile queue array in localStorage
      const hostileQueue = [
        null,
        undefined,
        'random_string_in_array',
        123456,
        true,
        {},
        { id: null, itemType: 'event', payload: { id: 'evt_null_id', type: 'null_id_type', context: {}, sessionId: 's1', userId: 'u1', timestamp: 1000 } },
        { id: '', itemType: 'event', payload: { id: 'evt_empty_id', type: 'empty_id_type', context: {}, sessionId: 's1', userId: 'u1', timestamp: 1001 } },
        { id: 'item_null_payload', itemType: 'event', payload: null },
        { id: 'item_undef_payload', itemType: 'error', payload: undefined },
        { id: 'item_string_payload', itemType: 'event', payload: 'string_payload_garbage' },
        { id: 'item_number_payload', itemType: 'error', payload: 99999 },
        { id: 'item_unsupported_type', itemType: 'unsupported_type', payload: { id: 'custom_1', type: 'custom', context: {}, sessionId: 's1', userId: 'u1', timestamp: 1002 } },
        { id: 'valid_evt_1', timestamp: 2001, itemType: 'event', payload: { id: 'evt_real_1', type: 'real_event_1', context: {}, sessionId: 's1', userId: 'u1', timestamp: 2001 } },
        { id: 'valid_err_1', timestamp: 2002, itemType: 'error', payload: { id: 'err_real_1', type: 'TypeError', message: 'real_error_1', source: 'custom', context: {}, sessionId: 's1', userId: 'u1', count: 1, firstSeen: 2002, lastSeen: 2002 } },
      ];

      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(hostileQueue));
      telemetryHub.setUserId('u1');

      // flushQueue must not throw or crash on any element
      await expect(telemetryHub.flushQueue()).resolves.not.toThrow();

      // All hostile/corrupted/null elements and payloads are safely handled or purged
      // Valid items must be successfully written to Firestore
      expect(mockSetDoc).toHaveBeenCalled();
      
      const setDocCalls = mockSetDoc.mock.calls;
      const dispatchedEvents = setDocCalls.map((call: any) => call[1]?.type);
      const dispatchedErrorMessages = setDocCalls.map((call: any) => call[1]?.message);
      expect(dispatchedEvents).toContain('real_event_1');
      expect(dispatchedErrorMessages).toContain('real_error_1');

      // The queue in localStorage should be completely purged and clean (0 items)
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });

    it('EMPIRICAL ADVERSARIAL: mid-flush event enqueue while purging corrupted items leaves valid new event intact', async () => {
      telemetryHub.setUserId('u_purge_race');

      const hostileQueue = [
        null,
        { id: 'corrupt_1', itemType: 'event', payload: null },
        { id: 'valid_slow_1', timestamp: 1000, itemType: 'event', payload: { id: 'evt_slow_1', type: 'slow_1', context: {}, sessionId: 's1', userId: 'u_purge_race', timestamp: 1000 } },
        { id: 'corrupt_2', itemType: 'error', payload: null },
      ];

      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(hostileQueue));

      mockSetDoc.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return undefined;
      });

      // Start flush
      const flushPromise = telemetryHub.flushQueue();

      // Enqueue new valid item while corrupted items are being purged
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.trackEvent('fresh_valid_event_during_purge', { key: 'val' });

      await flushPromise;

      // The fresh item must survive intact in localStorage
      const queueAfter = telemetryHub.getQueuedEvents();
      expect(queueAfter.length).toBe(1);
      expect((queueAfter[0].payload as TelemetryEventPayload).type).toBe('fresh_valid_event_during_purge');
      expect(queueAfter[0].payload).not.toBeNull();
    });
  });

  // =========================================================================
  // 3. Network Flapping & Rapid State Transitions
  // =========================================================================
  describe('3. Network Flapping & Concurrent Replay', () => {
    it('survives rapid online/offline event flapping without crashing or corrupting queue', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_flapping');

      // Queue 5 events while offline
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      for (let i = 1; i <= 5; i++) {
        telemetryHub.trackEvent(`flap_event_${i}`, { idx: i });
      }

      expect(telemetryHub.getQueuedEvents().length).toBe(5);

      // Simulate rapid online/offline window events with intermittent calls
      for (let i = 0; i < 6; i++) {
        const isNowOnline = i % 2 === 0;
        Object.defineProperty(navigator, 'onLine', { value: isNowOnline, configurable: true });
        window.dispatchEvent(new Event(isNowOnline ? 'online' : 'offline'));
      }

      // Allow async queue processing
      await telemetryHub.flushQueue();

      // All items should have been processed and queue emptied
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });

    it('EMPIRICAL CHALLENGE: tests if newly enqueued item during in-flight flush is preserved or overwritten', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_race_test');

      // Enqueue item 1
      telemetryHub.trackEvent('item_1_initial');
      expect(telemetryHub.getQueuedEvents().length).toBe(1);

      // Delay mock setDoc to simulate in-flight network request
      mockSetDoc.mockImplementation(async () => {
        await new Promise((res) => setTimeout(res, 50));
        return undefined;
      });

      // Start flush
      const flushPromise = telemetryHub.flushQueue();

      // Enqueue item 2 while flush is in flight
      telemetryHub.trackEvent('item_2_added_mid_flush');

      // Wait for flush to complete
      await flushPromise;

      // Check queued events
      const queueAfterFlush = telemetryHub.getQueuedEvents();
      
      // If the engine is completely safe, item 2 should NOT have been erased from storage
      expect(queueAfterFlush.some(i => (i.payload as any).type === 'item_2_added_mid_flush')).toBe(true);
    });

    it('EMPIRICAL CONCURRENCY: handles burst of 30 mixed events & errors added during an active 10-item flush', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_heavy_burst_race');

      // 1. Pre-populate 10 items in queue
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      for (let i = 1; i <= 10; i++) {
        telemetryHub.trackEvent(`pre_flush_event_${i}`, { index: i });
      }
      expect(telemetryHub.getQueuedEvents().length).toBe(10);

      // 2. Set up simulated network latency of 15ms per write
      mockSetDoc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return undefined;
      });

      // 3. Start flush (online)
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      const initialFlushPromise = telemetryHub.flushQueue();

      // 4. Concurrently push 30 items at staggered micro-intervals while flush is progressing
      const midFlushItemTypes: string[] = [];
      const enqueuePromises: Promise<void>[] = [];

      for (let j = 1; j <= 30; j++) {
        const itemType = `mid_flush_event_${j}`;
        midFlushItemTypes.push(itemType);

        // Stagger insertion during in-flight dispatch
        const p = new Promise<void>((resolve) => {
          setTimeout(() => {
            // Keep offline so trackEvent enqueues to localStorage without attempting immediate direct dispatch
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
            if (j % 2 === 0) {
              telemetryHub.trackEvent(itemType, { burstIndex: j });
            } else {
              telemetryHub.trackError(new Error(itemType), { source: 'custom' });
            }
            resolve();
          }, (j % 5) * 8); // spreads enqueues between 0ms and 32ms
        });
        enqueuePromises.push(p);
      }

      // Wait for all mid-flush enqueues and initial flush to finish
      await Promise.all([...enqueuePromises, initialFlushPromise]);

      // 5. Inspect localStorage queue: ALL 30 mid-flush items MUST be intact!
      const remainingQueue = telemetryHub.getQueuedEvents();
      expect(remainingQueue.length).toBe(30);

      for (const expectedType of midFlushItemTypes) {
        const found = remainingQueue.some((item) => {
          if (item.itemType === 'event') {
            return (item.payload as TelemetryEventPayload).type === expectedType;
          } else {
            return (item.payload as TelemetryErrorPayload).message === expectedType;
          }
        });
        expect(found, `Expected ${expectedType} to be preserved in queue`).toBe(true);
      }

      // 6. Now bring back online and flush the remaining 30 items
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      // Queue must now be fully cleared
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
      // Total dispatched docs must equal 10 (pre) + 30 (mid) = 40
      expect(mockSetDoc).toHaveBeenCalledTimes(40);
    });

    it('EMPIRICAL CONCURRENCY: handles overlapping concurrent flushQueue calls with simultaneous mid-flush enqueue', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_multi_flush_race');

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      for (let i = 1; i <= 8; i++) {
        telemetryHub.trackEvent(`multi_pre_${i}`);
      }
      expect(telemetryHub.getQueuedEvents().length).toBe(8);

      mockSetDoc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return undefined;
      });

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      // Launch 2 concurrent flushes
      const flush1 = telemetryHub.flushQueue();
      const flush2 = telemetryHub.flushQueue();

      // Mid-flight additions while staying offline so they are not immediately flushed by another call
      await new Promise((r) => setTimeout(r, 10));
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.trackEvent('multi_mid_1');
      telemetryHub.trackEvent('multi_mid_2');

      // Wait for initial flushes (flush1 & flush2) to finish
      await Promise.all([flush1, flush2]);

      // multi_mid_1 and multi_mid_2 were added while flush was in flight and must still exist in localStorage
      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(2);
      expect((remaining[0].payload as TelemetryEventPayload).type).toBe('multi_mid_1');
      expect((remaining[1].payload as TelemetryEventPayload).type).toBe('multi_mid_2');

      // Final online replay
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });

    it('concurrent flushQueue calls process items idempotently and empty the queue', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_concurrent_flush');

      for (let i = 1; i <= 5; i++) {
        telemetryHub.trackEvent(`concurrent_evt_${i}`);
      }

      expect(telemetryHub.getQueuedEvents().length).toBe(5);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      // Run 3 concurrent flushes simultaneously
      await Promise.all([
        telemetryHub.flushQueue(),
        telemetryHub.flushQueue(),
        telemetryHub.flushQueue(),
      ]);

      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });
  });

  // =========================================================================
  // 4. Timeout Aborts & Partial Failures
  // =========================================================================
  describe('4. Timeout Aborts & Partial Network Failures', () => {
    it('aborts dispatch with false when Firestore setDoc hangs past FIRESTORE_DISPATCH_TIMEOUT_MS', async () => {
      vi.useFakeTimers();

      // Firestore mock that never resolves
      mockSetDoc.mockImplementation(() => new Promise(() => {}));

      const dispatchPromise = telemetryHub.dispatchEventToFirestore({
        timestamp: Date.now(),
        type: 'hanging_event',
        context: { appVersion: '1.0.0', platform: 'other', displayMode: 'browser', online: true },
        userId: 'user_timeout_test',
        sessionId: 'sess_timeout',
      });

      // Advance timers by FIRESTORE_DISPATCH_TIMEOUT_MS (5000ms)
      vi.advanceTimersByTime(FIRESTORE_DISPATCH_TIMEOUT_MS + 100);

      const result = await dispatchPromise;
      expect(result).toBe(false);

      vi.useRealTimers();
    });

    it('preserves only failed items in queue during partial network failure while removing succeeded ones', async () => {
      const items: QueuedTelemetryItem[] = [
        {
          id: 'item_success_1',
          timestamp: 1000,
          itemType: 'event',
          payload: { timestamp: 1000, type: 'evt_success_1', context: {} as any, userId: 'u1', sessionId: 's1' },
        },
        {
          id: 'item_fail_2',
          timestamp: 2000,
          itemType: 'event',
          payload: { timestamp: 2000, type: 'evt_fail_2', context: {} as any, userId: 'u1', sessionId: 's1' },
        },
        {
          id: 'item_success_3',
          timestamp: 3000,
          itemType: 'event',
          payload: { timestamp: 3000, type: 'evt_success_3', context: {} as any, userId: 'u1', sessionId: 's1' },
        },
        {
          id: 'item_fail_4',
          timestamp: 4000,
          itemType: 'event',
          payload: { timestamp: 4000, type: 'evt_fail_4', context: {} as any, userId: 'u1', sessionId: 's1' },
        },
      ];

      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items));
      telemetryHub.setUserId('u1');

      // Mock setDoc: succeed for 1 and 3, reject for 2 and 4
      mockSetDoc.mockImplementation(async (_docRef: any, payload: any) => {
        if (payload.type === 'evt_fail_2' || payload.type === 'evt_fail_4') {
          throw new Error('Network error for item');
        }
        return undefined;
      });

      await telemetryHub.flushQueue();

      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(2);
      expect(remaining[0].id).toBe('item_fail_2');
      expect((remaining[0].payload as TelemetryEventPayload).type).toBe('evt_fail_2');
      expect(remaining[1].id).toBe('item_fail_4');
      expect((remaining[1].payload as TelemetryEventPayload).type).toBe('evt_fail_4');
    });

    it('error dispatch timeout also triggers abort and returns false', async () => {
      vi.useFakeTimers();

      mockSetDoc.mockImplementation(() => new Promise(() => {}));

      const dispatchPromise = telemetryHub.dispatchErrorToFirestore({
        timestamp: Date.now(),
        type: 'TypeError',
        message: 'hanging error',
        source: 'custom',
        context: { appVersion: '1.0.0', platform: 'other', displayMode: 'browser', online: true },
        userId: 'user_timeout_err',
        sessionId: 'sess_timeout_err',
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      });

      vi.advanceTimersByTime(FIRESTORE_DISPATCH_TIMEOUT_MS + 100);

      const result = await dispatchPromise;
      expect(result).toBe(false);

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // 5. FIFO Order Preservation & Deletion-After-Write Verification
  // =========================================================================
  describe('5. FIFO Order & Deletion Guarantees', () => {
    it('dispatches items in strict chronological FIFO order to Firestore', async () => {
      const dispatchOrder: string[] = [];

      mockSetDoc.mockImplementation(async (_docRef: any, payload: any) => {
        dispatchOrder.push(payload.type || payload.message);
        return undefined;
      });

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_fifo_test');

      telemetryHub.trackEvent('seq_1_first');
      telemetryHub.trackEvent('seq_2_second');
      telemetryHub.trackEvent('seq_3_third');
      telemetryHub.trackEvent('seq_4_fourth');

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(dispatchOrder).toEqual(['seq_1_first', 'seq_2_second', 'seq_3_third', 'seq_4_fourth']);
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });

    it('ensures items remain in localStorage if all Firestore writes fail (never prematurely deleted)', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_retention_test');

      telemetryHub.trackEvent('critical_event_1');
      telemetryHub.trackEvent('critical_event_2');

      mockSetDoc.mockRejectedValue(new Error('Persistent outage'));

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(2);
      expect((remaining[0].payload as TelemetryEventPayload).type).toBe('critical_event_1');
      expect((remaining[1].payload as TelemetryEventPayload).type).toBe('critical_event_2');
    });
  });

  // =========================================================================
  // 6. Identity & Auth Context Transition
  // =========================================================================
  describe('6. Identity & Auth Transition', () => {
    it('preserves null/anonymous guest telemetry without retroactively stamping authenticated UID (LB-18 privacy)', async () => {
      const items: QueuedTelemetryItem[] = [
        {
          id: 'item_anon_1',
          timestamp: 1000,
          itemType: 'event',
          payload: { timestamp: 1000, type: 'guest_action', context: {} as any, userId: null, sessionId: 's1' },
        },
        {
          id: 'item_anon_2',
          timestamp: 2000,
          itemType: 'error',
          payload: {
            timestamp: 2000,
            type: 'Error',
            message: 'guest_crash',
            source: 'custom',
            context: {} as any,
            userId: null,
            sessionId: 's1',
            count: 1,
            firstSeen: 2000,
            lastSeen: 2000,
          },
        },
      ];

      localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items));

      // User signs in with UID 'authenticated_user_777'
      telemetryHub.setUserId('authenticated_user_777');
      await telemetryHub.flushQueue();

      // Under GDPR and LB-18 privacy invariants, unauthenticated/guest telemetry must never
      // be retroactively attributed to the newly authenticated user UID upon login flush.
      expect(mockSetDoc).not.toHaveBeenCalled();
      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(2);
      expect(remaining[0].payload.userId).toBeNull();
      expect(remaining[1].payload.userId).toBeNull();
    });
  });
});
