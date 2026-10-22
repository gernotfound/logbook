import { describe, it, expect, vi } from 'vitest';
import {
  telemetryHub,
  TELEMETRY_QUEUE_CAPACITY,
  TELEMETRY_DISPATCH_TIMEOUT_MS,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSentryTransport } from './telemetryTestHarness';
import { seedCurrentTelemetryQueue } from './seedCurrentQueue';
import { readEncryptedTelemetry } from '../../src/lib/telemetry/secureQueueDevice';

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
        expect(parsed).toHaveLength(2);
        expect(parsed.map(item => item.itemType)).toEqual(['error', 'event']);
        expect(parsed[0].payload.userId).toBe('user_queue');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-2: keeps diagnostics volatile while the owner vault is locked', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_owner_scope');
        telemetryHub.trackEvent('owner_scoped_event');

        expect(telemetryHub.getQueuedEvents()).toHaveLength(1);
        expect(localStorage.getItem(telemetryHub.getQueueStorageKey())).toBeNull();

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

;

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

      it('F9-4: reconnect triggers replay of an offline error diagnostic', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_online_trigger');
        telemetryHub.trackError(new Error('Offline connection failure'));
        expect(telemetryHub.getQueuedEvents()).toHaveLength(1);
        expect(mockSentryTransport).not.toHaveBeenCalled();

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        window.dispatchEvent(new Event('online'));

        await vi.waitFor(() => {
          expect(mockSentryTransport).toHaveBeenCalledTimes(1);
          expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
          expect(mockSentryTransport.mock.calls[0][1].message).toBe('Offline connection failure');
          expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
        });
      });

      it('F9-5: encrypted owner queue retains a failed error until Sentry accepts it', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_clear_check');
        await seedCurrentTelemetryQueue('user_clear_check', [{
          id: 'q_1',
          timestamp: Date.now(),
          itemType: 'error',
          payload: {
            id: 'q_1', timestamp: Date.now(), type: 'Error',
            message: 'Persisted error', source: 'custom',
            context: { appVersion: 'test', platform: 'other', displayMode: 'browser', online: true },
            userId: 'user_clear_check', sessionId: 'sess_1',
            count: 1, firstSeen: Date.now(), lastSeen: Date.now(),
          },
        }]);

        expect(telemetryHub.getQueuedEvents()).toHaveLength(1);
        const owner = 'user:user_clear_check';
        expect(JSON.parse(readEncryptedTelemetry(owner)!)).toHaveLength(1);

        mockSentryTransport.mockResolvedValueOnce(false);
        await telemetryHub.flushQueue();

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        expect(telemetryHub.getQueuedEvents()).toHaveLength(1);
        expect(JSON.parse(readEncryptedTelemetry(owner)!)).toHaveLength(1);

        await telemetryHub.flushQueue();

        expect(mockSentryTransport).toHaveBeenCalledTimes(2);
        expect(mockSentryTransport.mock.calls[1][0]).toBe('error');
        expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
        expect(JSON.parse(readEncryptedTelemetry(owner)!)).toHaveLength(0);
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

      it('F11-2: hanging Sentry dispatch times out and queues its error', async () => {
        vi.useFakeTimers();
        mockSentryTransport.mockImplementation(() => new Promise(() => {}));
        telemetryHub.init();
        telemetryHub.setUserId('user_timeout');

        expect(telemetryHub.trackError(new Error('Timeout test'))).toBeUndefined();
        await vi.advanceTimersByTimeAsync(TELEMETRY_DISPATCH_TIMEOUT_MS);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const queued = telemetryHub.getQueuedEvents();
        expect(queued).toHaveLength(1);
        expect(queued[0].itemType).toBe('error');
        expect(queued[0].payload.userId).toBe('user_timeout');
      });

      it('F11-3: rejected Sentry transport does not throw and retains owner reports', async () => {
        vi.useFakeTimers();
        mockSentryTransport.mockRejectedValue(new Error('Sentry transport rejected'));
        telemetryHub.init();
        telemetryHub.setUserId('user_perm_denied');

        expect(() => {
          telemetryHub.trackError(new Error('Permission denied error'));
          telemetryHub.trackEvent('diagnostic_event');
        }).not.toThrow();
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(2);
        expect(mockSentryTransport.mock.calls.map((call: any) => call[0]).sort()).toEqual(['error', 'event']);
        const queued = telemetryHub.getQueuedEvents();
        expect(queued).toHaveLength(2);
        expect(queued.map(item => item.itemType).sort()).toEqual(['error', 'event']);
        expect(queued.every(item => item.payload.userId === 'user_perm_denied')).toBe(true);
      });

;

      it('F11-5: concurrent diagnostic events reach the accepted-and-dropped transport boundary', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_concurrent');

        for (let i = 0; i < 20; i++) {
          telemetryHub.trackEvent(`concurrent_event_${i}`);
        }

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(20);
        expect(mockSentryTransport.mock.calls.every((call: any) => call[0] === 'event')).toBe(true);
        expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
      });
    });
  });
});
