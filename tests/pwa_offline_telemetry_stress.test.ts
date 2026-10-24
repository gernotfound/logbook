import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import {
  telemetryHub,
  TELEMETRY_QUEUE_CAPACITY,
  TELEMETRY_DISPATCH_TIMEOUT_MS,
  type QueuedTelemetryItem,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';
import { seedCurrentTelemetryQueue } from './telemetry/seedCurrentQueue';

function errorItem(id: string, userId: string, timestamp = Date.now(), message = id): QueuedTelemetryItem {
  return { id, timestamp, itemType: 'error', payload: {
    id, timestamp, type: 'Error', message, source: 'custom',
    userId, sessionId: 's1', context: { appVersion: '1.183.0', platform: 'other', displayMode: 'browser', online: false },
    count: 1, firstSeen: timestamp, lastSeen: timestamp,
  } };
}

describe('Adversarial Stress Suite: Offline Queue & Online Replay Engine', () => {
  let mockSentryTransport: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();

    mockSentryTransport = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);

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
  // 1. Queue Overflow & Error-Priority Eviction Stress Test
  // =========================================================================
  describe('1. Queue Overflow & Error-Priority Eviction Stress', () => {
    it('keeps the last fifty errors during 150 diagnostic attempts', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_overflow_stress');

      // Only technical errors can enter the diagnostic queue.
      for (let i = 1; i <= 150; i++) {
        if (i % 2 === 0) {
          // Retired usage events are not produced.
        } else {
          telemetryHub.trackError(new Error(`error_${i}`), { source: 'custom' });
        }
      }

      expect(localStorage.getItem(telemetryHub.getQueueStorageKey())).toBeNull();
      const queued = telemetryHub.getQueuedEvents() as QueuedTelemetryItem[];

      // Capacity must be strictly bounded at TELEMETRY_QUEUE_CAPACITY (50)
      expect(queued.length).toBe(TELEMETRY_QUEUE_CAPACITY);

      expect(queued.every(item => item.itemType === 'error')).toBe(true);
      for (let idx = 0; idx < queued.length; idx++) {
        expect((queued[idx].payload as TelemetryErrorPayload).message)
          .toBe(`error_${51 + idx * 2}`);
      }
    });
  });

  // =========================================================================
  // 2. Encrypted Owner-Scoped Queue Corruption Resilience
  // =========================================================================
  describe('2. Encrypted Queue Corruption Resilience', () => {
    it('flushQueue does not throw, purges malformed null payloads, and dispatches surrounding valid items', async () => {
      // Simulate partially malformed queue array with missing payload or invalid structure
      const malformedQueue = [
        errorItem('bad_1', 'user_malformed_test', Date.now(), 'valid_before'),
        { id: 'corrupt_item', timestamp: Date.now(), itemType: 'event', payload: null },
        errorItem('bad_2', 'user_malformed_test', Date.now(), 'valid_after'),
      ];

      telemetryHub.setUserId('user_malformed_test');
      await seedCurrentTelemetryQueue('user_malformed_test', malformedQueue);

      // Should not throw unhandled exception
      await expect(telemetryHub.flushQueue()).resolves.toBeUndefined();

      // Surrounding valid items should be dispatched
      expect(mockSentryTransport).toHaveBeenCalledTimes(2);
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
        errorItem('valid_evt_1', 'u1', Date.now(), 'valid_event_error'),
        { id: 'valid_err_1', timestamp: Date.now(), itemType: 'error', payload: { id: 'err_real_1', type: 'TypeError', message: 'real_error_1', source: 'custom', context: {}, sessionId: 's1', userId: 'u1', count: 1, firstSeen: Date.now(), lastSeen: Date.now() } },
      ];

      telemetryHub.setUserId('u1');
      await seedCurrentTelemetryQueue('u1', hostileQueue);

      // flushQueue must not throw or crash on any element
      await expect(telemetryHub.flushQueue()).resolves.toBeUndefined();

      // All hostile/corrupted/null elements and payloads are safely handled or purged
      // Valid items must reach the mock Sentry transport
      expect(mockSentryTransport).toHaveBeenCalled();
      
      const transportCalls = mockSentryTransport.mock.calls;
      const dispatchedEvents = transportCalls.map((call: any) => call[1]?.message);
      const dispatchedErrorMessages = transportCalls.map((call: any) => call[1]?.message);
      expect(dispatchedEvents).toContain('valid_event_error');
      expect(dispatchedErrorMessages).toContain('real_error_1');

      // The current owner queue should be empty after flushing
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });

    it('EMPIRICAL ADVERSARIAL: mid-flush error enqueue while purging corrupted items leaves valid new error intact', async () => {
      telemetryHub.setUserId('u_purge_race');

      const hostileQueue = [
        null,
        { id: 'corrupt_1', itemType: 'event', payload: null },
        errorItem('valid_slow_1', 'u_purge_race', Date.now(), 'slow_1'),
        { id: 'corrupt_2', itemType: 'error', payload: null },
      ];

      await seedCurrentTelemetryQueue('u_purge_race', hostileQueue);

      mockSentryTransport.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return true;
      });

      // Start flush
      const flushPromise = telemetryHub.flushQueue();

      // Enqueue new valid item while corrupted items are being purged
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.trackError(new Error('fresh_valid_event_during_purge'));

      await flushPromise;

      // The fresh item must survive intact in localStorage
      const queueAfter = telemetryHub.getQueuedEvents();
      expect(queueAfter.length).toBe(1);
      expect((queueAfter[0].payload as TelemetryErrorPayload).message).toBe('fresh_valid_event_during_purge');
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
        telemetryHub.trackError(new Error(`flap_event_${i}`));
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
      telemetryHub.trackError(new Error('item_1_initial'));
      expect(telemetryHub.getQueuedEvents().length).toBe(1);

      // Simulate in-flight Sentry transport latency
      mockSentryTransport.mockImplementation(async () => {
        await new Promise((res) => setTimeout(res, 50));
        return true;
      });

      // Start flush
      const flushPromise = telemetryHub.flushQueue();

      // Enqueue item 2 while flush is in flight
      telemetryHub.trackError(new Error('item_2_added_mid_flush'));

      // Wait for flush to complete
      await flushPromise;

      // Check queued events
      const queueAfterFlush = telemetryHub.getQueuedEvents();
      
      // If the engine is completely safe, item 2 should NOT have been erased from storage
      expect(queueAfterFlush.some(i => (i.payload as any).message === 'item_2_added_mid_flush')).toBe(true);
    });

    it('EMPIRICAL CONCURRENCY: handles burst of 30 mixed events & errors added during an active 10-item flush', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_heavy_burst_race');

      // 1. Pre-populate 10 items in queue
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      for (let i = 1; i <= 10; i++) {
        telemetryHub.trackError(new Error(`pre_flush_event_${i}`));
      }
      expect(telemetryHub.getQueuedEvents().length).toBe(10);

      // 2. Set up simulated network latency of 15ms per write
      mockSentryTransport.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return true;
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
            telemetryHub.trackError(new Error(itemType), { source: 'custom' });
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
          return (item.payload as TelemetryErrorPayload).message === expectedType;
        });
        expect(found, `Expected ${expectedType} to be preserved in queue`).toBe(true);
      }

      // 6. Now bring back online and flush the remaining 30 items
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      // Queue must now be fully cleared
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
      // Total dispatched docs must equal 10 (pre) + 30 (mid) = 40
      expect(mockSentryTransport).toHaveBeenCalledTimes(40);
    });

    it('EMPIRICAL CONCURRENCY: handles overlapping concurrent flushQueue calls with simultaneous mid-flush enqueue', async () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_multi_flush_race');

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      for (let i = 1; i <= 8; i++) {
        telemetryHub.trackError(new Error(`multi_pre_${i}`));
      }
      expect(telemetryHub.getQueuedEvents().length).toBe(8);

      mockSentryTransport.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return true;
      });

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      // Launch 2 concurrent flushes
      const flush1 = telemetryHub.flushQueue();
      const flush2 = telemetryHub.flushQueue();

      // Mid-flight additions while staying offline so they are not immediately flushed by another call
      await new Promise((r) => setTimeout(r, 10));
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.trackError(new Error('multi_mid_1'));
      telemetryHub.trackError(new Error('multi_mid_2'));

      // Wait for initial flushes (flush1 & flush2) to finish
      await Promise.all([flush1, flush2]);

      // multi_mid_1 and multi_mid_2 were added while flush was in flight and must still exist in localStorage
      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(2);
      expect((remaining[0].payload as TelemetryErrorPayload).message).toBe('multi_mid_1');
      expect((remaining[1].payload as TelemetryErrorPayload).message).toBe('multi_mid_2');

      // Final online replay
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });

    it('concurrent flushQueue calls send each report once and empty the queue', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_concurrent_flush');

      for (let i = 1; i <= 5; i++) {
        telemetryHub.trackError(new Error(`concurrent_evt_${i}`));
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
      expect(mockSentryTransport).toHaveBeenCalledTimes(5);
      expect(mockSentryTransport.mock.calls.map((call: any) => call[1].message)).toEqual([
        'concurrent_evt_1', 'concurrent_evt_2', 'concurrent_evt_3',
        'concurrent_evt_4', 'concurrent_evt_5',
      ]);
    });
  });

  // =========================================================================
  // 4. Timeout Aborts & Partial Failures
  // =========================================================================
  describe('4. Timeout Aborts & Partial Network Failures', () => {
    it('aborts dispatch with false when external telemetry dispatch hangs past TELEMETRY_DISPATCH_TIMEOUT_MS', async () => {
      vi.useFakeTimers();

      // telemetry transport mock that never resolves
      mockSentryTransport.mockImplementation(() => new Promise(() => {}));

      telemetryHub.setUserId('user_timeout_test');
      const dispatchPromise = telemetryHub.dispatchErrorExternally({
        timestamp: Date.now(),
        type: 'Error', message: 'hanging_event', source: 'custom', count: 1,
        firstSeen: Date.now(), lastSeen: Date.now(),
        context: { appVersion: '1.0.0', platform: 'other', displayMode: 'browser', online: true },
        userId: 'user_timeout_test',
        sessionId: 'sess_timeout',
      });

      // Advance timers by TELEMETRY_DISPATCH_TIMEOUT_MS (5000ms)
      vi.advanceTimersByTime(TELEMETRY_DISPATCH_TIMEOUT_MS + 100);

      const result = await dispatchPromise;
      expect(result).toBe(false);
      // A false result due only to the owner guard would never call transport.
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('preserves only failed items in queue during partial network failure while removing succeeded ones', async () => {
      const items: QueuedTelemetryItem[] = [
        errorItem('item_success_1', 'u1'),
        errorItem('item_fail_2', 'u1'),
        errorItem('item_success_3', 'u1'),
        errorItem('item_fail_4', 'u1'),
      ];

      telemetryHub.setUserId('u1');
      await seedCurrentTelemetryQueue('u1', items);

      // Mock Sentry transport succeeds for 1 and 3, rejects for 2 and 4
      mockSentryTransport.mockImplementation(async (_kind: any, payload: any) => {
        if (payload.message === 'item_fail_2' || payload.message === 'item_fail_4') {
          throw new Error('Network error for item');
        }
        return true;
      });

      await telemetryHub.flushQueue();

      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(2);
      expect(remaining[0].id).toBe('item_fail_2');
      expect((remaining[0].payload as TelemetryErrorPayload).message).toBe('item_fail_2');
      expect(remaining[1].id).toBe('item_fail_4');
      expect((remaining[1].payload as TelemetryErrorPayload).message).toBe('item_fail_4');
    });

    it('error dispatch timeout also triggers abort and returns false', async () => {
      vi.useFakeTimers();

      mockSentryTransport.mockImplementation(() => new Promise(() => {}));

      telemetryHub.setUserId('user_timeout_err');
      const dispatchPromise = telemetryHub.dispatchErrorExternally({
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

      vi.advanceTimersByTime(TELEMETRY_DISPATCH_TIMEOUT_MS + 100);

      const result = await dispatchPromise;
      expect(result).toBe(false);
      // A false result due only to the owner guard would never call transport.
      expect(mockSentryTransport).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // 5. FIFO Order Preservation & Deletion-After-Write Verification
  // =========================================================================
  describe('5. FIFO Order & Deletion Guarantees', () => {
    it('dispatches items to the Sentry transport in strict FIFO order', async () => {
      const dispatchOrder: string[] = [];

      mockSentryTransport.mockImplementation(async (_kind: any, payload: any) => {
        dispatchOrder.push(payload.message);
        return true;
      });

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_fifo_test');

      telemetryHub.trackError(new Error('seq_1_first'));
      telemetryHub.trackError(new Error('seq_2_second'));
      telemetryHub.trackError(new Error('seq_3_third'));
      telemetryHub.trackError(new Error('seq_4_fourth'));

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(dispatchOrder).toEqual(['seq_1_first', 'seq_2_second', 'seq_3_third', 'seq_4_fourth']);
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });

    it('retains failed reports in the owner queue when Sentry transport rejects', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_retention_test');

      telemetryHub.trackError(new Error('critical_event_1'));
      telemetryHub.trackError(new Error('critical_event_2'));

      mockSentryTransport.mockRejectedValue(new Error('Persistent outage'));

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(2);
      expect((remaining[0].payload as TelemetryErrorPayload).message).toBe('critical_event_1');
      expect((remaining[1].payload as TelemetryErrorPayload).message).toBe('critical_event_2');
    });
  });


});
