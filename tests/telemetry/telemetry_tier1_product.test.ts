import { describe, it, expect, vi } from 'vitest';
import { getTelemetryContext } from '../../src/lib/telemetrySanitizer';
import {
  telemetryHub,
  TELEMETRY_QUEUE_CAPACITY,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSetDoc } from './telemetryTestHarness';
import { seedCurrentTelemetryQueue } from './seedCurrentQueue';

const RETIRED_GLOBAL_QUEUE_KEY = 'logbook_telemetry_queue';

describe('Technical telemetry queue and dispatch — Tier 1', () => {
  installTelemetryTestHarness();

  describe('Technical diagnostics: queue, transport, non-blocking behavior', () => {
    describe('F9: Offline Queue & Replay Engine', () => {
      it('F9-1: buffers errors and events in RAM without plaintext before vault unlock', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_queue');

        telemetryHub.trackError(new Error('Offline error 1'));
        telemetryHub.trackEvent('offline_event_1', { data: 123 });

        expect(localStorage.getItem(telemetryHub.getQueueStorageKey())).toBeNull();
        const parsed = telemetryHub.getQueuedEvents();
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(2);

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-2: keeps diagnostics volatile and avoids legacy plaintext keys without a vault', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_owner_scope');
        telemetryHub.trackEvent('owner_scoped_event');

        expect(telemetryHub.getQueuedEvents()).toHaveLength(1);
        expect(localStorage.getItem(telemetryHub.getQueueStorageKey())).toBeNull();
        expect(localStorage.getItem(RETIRED_GLOBAL_QUEUE_KEY)).toBeNull();

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-2b: never imports the unsupported global queue into current telemetry', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        const retired = JSON.stringify([{
          id: 'old-shared', timestamp: Date.now(), itemType: 'event',
          payload: { type: 'retired', timestamp: Date.now(),
            context: getTelemetryContext(), userId: 'user_b' },
        }]);
        localStorage.setItem(RETIRED_GLOBAL_QUEUE_KEY, retired);

        telemetryHub.init();
        telemetryHub.setUserId('user_b');

        expect(telemetryHub.getQueuedEvents()).toEqual([]);
        expect(localStorage.getItem(RETIRED_GLOBAL_QUEUE_KEY)).toBe(retired);
        expect(localStorage.getItem(telemetryHub.getQueueStorageKey())).toBeNull();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-3: limits queue capacity to maximum 50 items and evicts oldest items FIFO', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_queue_cap');

        for (let i = 1; i <= 60; i++) {
          telemetryHub.trackEvent(`event_${i}`, { index: i });
        }

        const queued = telemetryHub.getQueuedEvents();
        expect(queued.length).toBe(TELEMETRY_QUEUE_CAPACITY);
        expect(queued.length).toBeLessThanOrEqual(50);
        expect(queued[0].payload.type).toBe('event_11');
        expect(queued[queued.length - 1].payload.type).toBe('event_60');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-4: automatically triggers flushQueue when window receives online event', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_online_trigger');

        telemetryHub.trackEvent('offline_action');
        expect(telemetryHub.getQueuedEvents().length).toBe(1);

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        window.dispatchEvent(new Event('online'));

        await vi.waitFor(() => {
          expect(mockSetDoc).toHaveBeenCalled();
          expect(telemetryHub.getQueuedEvents().length).toBe(0);
        });
      });

      it('F9-5: clears local queue buffer only after successful Firestore write dispatch', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_clear_check');

        await seedCurrentTelemetryQueue('user_clear_check', [
            {
              id: 'q_1',
              timestamp: Date.now(),
              itemType: 'event',
              payload: {
                timestamp: Date.now(),
                type: 'replayed_event',
                context: getTelemetryContext(),
                userId: 'user_clear_check',
              },
            },
          ]);

        await telemetryHub.flushQueue();

        expect(mockSetDoc).toHaveBeenCalled();
        const remaining = localStorage.getItem(telemetryHub.getQueueStorageKey());
        const parsedRemaining = remaining ? JSON.parse(remaining) : [];
        expect(parsedRemaining.length).toBe(0);
      });
    });

    describe('F11: Async Fire-and-Forget & Non-blocking', () => {
      it('F11-1: trackError and trackEvent return immediately (void return type)', () => {
        telemetryHub.init();
        const retError = telemetryHub.trackError(new Error('Void test'));
        const retEvent = telemetryHub.trackEvent('test_event');

        expect(retError).toBeUndefined();
        expect(retEvent).toBeUndefined();
      });

      it('F11-2: Sentry transport timeout does not synchronously interrupt callers', async () => {
        mockSetDoc.mockImplementation(
          () => new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 6000))
        );

        telemetryHub.init();
        telemetryHub.setUserId('user_timeout');

        expect(() => {
          telemetryHub.trackError(new Error('Timeout test'));
        }).not.toThrow();
      });

      it('F11-3: Sentry transport rejection does not throw to the UI', async () => {
        mockSetDoc.mockRejectedValue(new Error('FirebaseError: [code=permission-denied]'));

        telemetryHub.init();
        telemetryHub.setUserId('user_perm_denied');

        expect(() => {
          telemetryHub.trackError(new Error('Permission denied error'));
          telemetryHub.trackEvent('permission_event');
        }).not.toThrow();
      });

      it('F11-4: dispatching technical events has a bounded synchronous caller cost', () => {
        telemetryHub.init();

        const start = performance.now();
        for (let i = 0; i < 50; i++) {
          telemetryHub.trackEvent('zod_schema_fallback', { issueCode: 'invalid_type' });
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(50);
      });

      it('F11-5: multiple concurrent telemetry dispatches execute safely without race conditions', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_concurrent');

        for (let i = 0; i < 20; i++) {
          telemetryHub.trackEvent(`concurrent_event_${i}`);
        }

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(20);
      });
    });
  });
});
