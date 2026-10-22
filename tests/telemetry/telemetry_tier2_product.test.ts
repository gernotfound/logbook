import { describe, it, expect, vi } from 'vitest';
import { getTelemetryContext } from '../../src/lib/telemetrySanitizer';
import {
  telemetryHub,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSentryTransport } from './telemetryTestHarness';
import { seedCurrentTelemetryQueue } from './seedCurrentQueue';

describe('Technical telemetry queue and dispatch — Tier 2', () => {
  installTelemetryTestHarness();

  describe('Technical diagnostics: queue, recovery and failure paths', () => {
    describe('F9 Boundaries: Offline Queue & Replay Edge Conditions', () => {
      it('F9-B1: localStorage.setItem throws QuotaExceededError when enqueuing telemetry', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();

        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        });

        expect(() => {
          telemetryHub.trackEvent('quota_test_event');
        }).not.toThrow();

        setItemSpy.mockRestore();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-B2: localStorage contains corrupted/malformed JSON under queue key', () => {
        localStorage.setItem(telemetryHub.getQueueStorageKey(), 'corrupted JSON string {');
        telemetryHub.init();

        const queued = telemetryHub.getQueuedEvents();
        expect(queued).toEqual([]);
      });

      it('F9-B3: queue reaches exactly 50 items and drops the oldest entry when 51st arrives', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();

        for (let i = 1; i <= 51; i++) {
          telemetryHub.trackEvent(`event_${i}`);
        }

        const queued = telemetryHub.getQueuedEvents();
        expect(queued.length).toBe(50);
        expect(queued[0].payload.type).toBe('event_2');
        expect(queued[49].payload.type).toBe('event_51');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-B4: network drops mid-flush during offline replay (partial replay & persistence of remaining)', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_partial_replay');

        await seedCurrentTelemetryQueue('user_partial_replay', [
            { id: '1', timestamp: Date.now(), itemType: 'event', payload: { type: 'item1', context: getTelemetryContext(), userId: 'user_partial_replay', timestamp: Date.now() } },
            { id: '2', timestamp: Date.now(), itemType: 'event', payload: { type: 'item2', context: getTelemetryContext(), userId: 'user_partial_replay', timestamp: Date.now() } },
          ]);

        mockSentryTransport
          .mockResolvedValueOnce(true)
          .mockRejectedValueOnce(new Error('Network dropped during flush'));

        await telemetryHub.flushQueue();

        const remaining = telemetryHub.getQueuedEvents();
        expect(remaining.length).toBe(1);
        expect(remaining[0].id).toBe('2');
      });

      it('F9-B5: flushQueue called when queue is already empty returns immediately without errors', async () => {
        telemetryHub.init();
        localStorage.removeItem(telemetryHub.getQueueStorageKey());

        await expect(telemetryHub.flushQueue()).resolves.toBeUndefined();
      });
    });

    describe('F11 Boundaries: Async Fire-and-Forget Edge Conditions', () => {
      it('F11-B1: an unresponsive Sentry transport cannot block event callers', async () => {
        vi.useFakeTimers();
        mockSentryTransport.mockImplementation(() => new Promise(() => {}));

        telemetryHub.init();
        telemetryHub.setUserId('user_hang');

        telemetryHub.trackEvent('hanging_event');
        await vi.advanceTimersByTimeAsync(6000);

        expect(mockSentryTransport).toHaveBeenCalled();
      });

      it('F11-B2: rejected Sentry transport is non-blocking', async () => {
        mockSentryTransport.mockRejectedValue(new Error('FirebaseError: Missing permissions'));

        telemetryHub.init();
        expect(() => {
          telemetryHub.trackError(new Error('Permission error'));
        }).not.toThrow();
      });

      it('F11-B3: trackError called 1000 times synchronously in hot loop completes under 300ms', () => {
        telemetryHub.init();
        const start = performance.now();

        for (let i = 0; i < 1000; i++) {
          telemetryHub.trackError(new Error(`Hot loop error ${i % 10}`));
        }

        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(300);
      });

      it('F11-B4: simultaneous trackError and flushQueue calls do not deadlock or duplicate writes', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_deadlock_check');

        telemetryHub.trackError(new Error('Simultaneous err'));
        const flushPromise = telemetryHub.flushQueue();

        await vi.advanceTimersByTimeAsync(100);
        await expect(flushPromise).resolves.toBeUndefined();
      });

      it('F11-B5: telemetry dispatch during document visibilitychange succeeds or buffers', () => {
        telemetryHub.init();
        expect(() => {
          document.dispatchEvent(new Event('visibilitychange'));
        }).not.toThrow();
      });
    });
  });
});
