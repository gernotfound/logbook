import { describe, it, expect, vi } from 'vitest';
import { getTelemetryContext } from '../../src/lib/telemetrySanitizer';
import {
  telemetryHub,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSentryTransport } from './telemetryTestHarness';
import { seedCurrentTelemetryQueue } from './seedCurrentQueue';
import { readEncryptedTelemetry } from '../../src/lib/telemetry/secureQueueDevice';
import { protectedDeviceKey } from '../../src/lib/sync/deviceStorage';
import { TelemetryQueueStorage } from '../../src/lib/telemetry/queueStorage';
import { localStorageMock } from '../setup';

describe('Technical telemetry queue and dispatch — Tier 2', () => {
  installTelemetryTestHarness();

  describe('Technical diagnostics: queue, recovery and failure paths', () => {
    describe('F9 Boundaries: Offline Queue & Replay Edge Conditions', () => {
      it('F9-B1: QuotaExceeded on owner ciphertext preserves both RAM and durable data', async () => {
        const uid = 'quota-owner';
        await seedCurrentTelemetryQueue(uid, []);
        const owner = `user:${uid}`;
        const ciphertextKey = protectedDeviceKey('telemetry_queue', owner);
        const original = localStorage.getItem(ciphertextKey);
        expect(original).toMatch(/^tlb-sealed:v1:/);

        const storage = new TelemetryQueueStorage(() => uid);
        const write = vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });
        try {
          const timestamp = Date.now();
          expect(() => storage.enqueueItem({
            id: 'quota-error', timestamp, type: 'Error',
            message: 'Transient storage failure', source: 'custom',
            context: getTelemetryContext(), userId: uid, sessionId: 'sess_1',
            count: 1, firstSeen: timestamp, lastSeen: timestamp,
          })).not.toThrow();

          expect(write.mock.calls.some(call => call[0] === ciphertextKey)).toBe(true);
          expect(storage.getQueuedEvents().map(item => item.id)).toEqual(['quota-error']);
          expect(localStorage.getItem(ciphertextKey)).toBe(original);
          expect(localStorage.getItem(storage.getQueueStorageKey())).toBeNull();
        } finally {
          write.mockRestore();
        }
      });

      it('F9-B2: corrupted authenticated ciphertext is preserved, not treated as an empty queue', async () => {
        const uid = 'corrupt-owner';
        await seedCurrentTelemetryQueue(uid, []);
        const key = protectedDeviceKey('telemetry_queue', `user:${uid}`);
        const tampered = 'tlb-sealed:v1:invalid-ciphertext';
        localStorage.setItem(key, tampered);
        const storage = new TelemetryQueueStorage(() => uid);
        const timestamp = Date.now();
        storage.enqueueItem({
          id: 'recovery-error', timestamp, type: 'Error', message: 'Transient error',
          source: 'custom', context: getTelemetryContext(), userId: uid,
          sessionId: 'sess_1', count: 1, firstSeen: timestamp, lastSeen: timestamp,
        });

        expect(storage.getQueuedEvents().map(item => item.id)).toEqual(['recovery-error']);
        expect(localStorage.getItem(key)).toBe(tampered);
        expect(localStorage.getItem(storage.getQueueStorageKey())).toBeNull();
      });

      it('F9-B3: queue reaches exactly 50 items and drops the oldest entry when 51st arrives', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();

        for (let i = 1; i <= 51; i++) {
          telemetryHub.trackError(new Error(`queue-error-${i}`));
        }

        const queued = telemetryHub.getQueuedEvents();
        expect(queued.length).toBe(50);
        expect(queued[0].payload.message).toBe('queue-error-2');
        expect(queued[49].payload.message).toBe('queue-error-51');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-B4: replay retains a failed encrypted error after earlier SDK acceptance', async () => {
        const uid = 'user_partial_replay';
        telemetryHub.init();
        telemetryHub.setUserId(uid);
        const now = Date.now();
        await seedCurrentTelemetryQueue(uid, ['1', '2'].map((id) => ({
          id, timestamp: now, itemType: 'error',
          payload: {
            id, timestamp: now, type: 'Error', message: `report ${id}`,
            source: 'custom', context: getTelemetryContext(), userId: uid,
            sessionId: 'sess_1', count: 1, firstSeen: now, lastSeen: now,
          },
        })));
        mockSentryTransport
          .mockResolvedValueOnce(true)
          .mockRejectedValueOnce(new Error('SDK capture unavailable'));

        await telemetryHub.flushQueue();

        expect(mockSentryTransport.mock.calls.map((call: any) => call[1].message))
          .toEqual(['report 1', 'report 2']);
        expect(telemetryHub.getQueuedEvents().map(item => item.id)).toEqual(['2']);
        const persisted = JSON.parse(readEncryptedTelemetry(`user:${uid}`)!);
        expect(persisted.map((item: { id: string }) => item.id)).toEqual(['2']);
      });

      it('F9-B5: an empty authenticated ciphertext queue does not invoke SDK capture', async () => {
        const uid = 'empty-queue-owner';
        telemetryHub.init();
        telemetryHub.setUserId(uid);
        await seedCurrentTelemetryQueue(uid, []);
        await expect(telemetryHub.flushQueue()).resolves.toBeUndefined();
        expect(mockSentryTransport).not.toHaveBeenCalled();
        expect(JSON.parse(readEncryptedTelemetry(`user:${uid}`)!)).toEqual([]);
      });

    });

    describe('F11 Boundaries: Async Fire-and-Forget Edge Conditions', () => {
      it('F11-B1: a hung SDK capture times out without blocking error tracking', async () => {
        vi.useFakeTimers();
        mockSentryTransport.mockImplementation(() => new Promise(() => {}));
        telemetryHub.init();
        telemetryHub.setUserId('user_hang');

        expect(telemetryHub.trackError(new Error('Hanging diagnostic'))).toBeUndefined();
        await vi.advanceTimersByTimeAsync(5000);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        expect(telemetryHub.getQueuedEvents().map(item => item.payload.type)).toEqual(['Error']);
      });

      it('F11-B2: a rejected SDK capture queues the current owner error for retry', async () => {
        vi.useFakeTimers();
        mockSentryTransport.mockRejectedValue(new Error('SDK capture unavailable'));
        telemetryHub.init();
        telemetryHub.setUserId('rejected-owner');

        expect(telemetryHub.trackError(new Error('Capture rejected'))).toBeUndefined();
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        expect(telemetryHub.getQueuedEvents().map(item => item.payload.userId))
          .toEqual(['rejected-owner']);
      });

      it('F11-B3: a thousand synchronous errors aggregate by ten distinct fingerprints', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('hot-loop-owner');
        for (let i = 0; i < 1000; i++) {
          telemetryHub.trackError(new Error(`Hot loop error ${i % 10}`));
        }

        expect(telemetryHub.getActiveRateLimiterCount()).toBe(10);
        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(10);
        expect(mockSentryTransport.mock.calls.reduce(
          (sum: number, call: any) => sum + call[1].count, 0,
        )).toBe(1000);
      });

      it('F11-B4: concurrent queue flush and hot error preserve distinct reports', async () => {
        vi.useFakeTimers();
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_deadlock_check');
        telemetryHub.trackError(new Error('Queued error'));
        expect(telemetryHub.getQueuedEvents()).toHaveLength(1);

        let finish!: () => void;
        mockSentryTransport.mockImplementation((_kind: unknown, payload: any) =>
          payload.message === 'Queued error'
            ? new Promise<boolean>(resolve => { finish = () => resolve(true); })
            : Promise.resolve(true));

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        const first = telemetryHub.flushQueue();
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        telemetryHub.trackError(new Error('Hot error'));
        await vi.advanceTimersByTimeAsync(0);
        expect(mockSentryTransport).toHaveBeenCalledTimes(2);

        finish();
        await first;
        const messages = mockSentryTransport.mock.calls.map((call: any) => call[1].message);
        expect(messages).toEqual(['Queued error', 'Hot error']);
        expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
      });

    });
  });
});
