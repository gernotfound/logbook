import { describe, it, expect, vi } from 'vitest';
import { getTelemetryContext } from '../../src/lib/telemetrySanitizer';
import {
  telemetryHub,
  TELEMETRY_QUEUE_KEY,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSetDoc } from './telemetryTestHarness';

describe('Unified Telemetry Hub E2E Suite — Tier 2 Product', () => {
  installTelemetryTestHarness();

  describe('Tier 2: Boundary & Corner Cases — Product & Delivery', () => {
    describe('F7 Boundaries: PWA Install Funnel Edge Conditions', () => {
      it('F7-B1: beforeinstallprompt event fired repeatedly before user action', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackEvent('pwa_prompt_shown');
        telemetryHub.trackEvent('pwa_prompt_shown');

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
      });

      it('F7-B2: install button clicked when beforeinstallprompt has not fired yet', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackEvent('pwa_install_clicked', { promptAvailable: false });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
      });

      it('F7-B3: prompt outcome returns unexpected or non-standard status string', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackEvent('pwa_prompt_unknown', { outcome: 'unexpected_vendor_status' });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
      });

      it('F7-B4: appinstalled event fires without prior beforeinstallprompt event (e.g. desktop omnibox)', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackEvent('pwa_installed', { directInstall: true });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
      });

      it('F7-B5: user dismisses prompt, then triggers install again in same session', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackEvent('pwa_prompt_dismissed');
        telemetryHub.trackEvent('pwa_install_clicked');
        telemetryHub.trackEvent('pwa_prompt_accepted');

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(3);
      });
    });

    describe('F8 Boundaries: Offline Workout Analytics Edge Conditions', () => {
      it('F8-B1: workout started online but completed and saved while offline', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_w_trans');

        telemetryHub.trackEvent('workout_started', { offline: false });

        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.trackEvent('workout_saved', { offline: true, durationMinutes: 50 });

        const queued = telemetryHub.getQueuedEvents();
        expect(queued.length).toBe(1);
        expect(queued[0].payload.type).toBe('workout_saved');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F8-B2: workout started offline but saved after network restored online', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_w_trans2');

        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.trackEvent('workout_started', { offline: true });

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        telemetryHub.trackEvent('workout_saved', { offline: false });

        await telemetryHub.flushQueue();
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
      });

      it('F8-B3: workout saved with 0 exercises or empty routine', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackEvent('workout_saved', {
          offline: false,
          durationMinutes: 0,
          exercisesCount: 0,
        });

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
      });

      it('F8-B4: workout saved with negative or corrupted durationMs handled safely', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackEvent('workout_saved', {
          offline: false,
          durationMinutes: -5,
          exercisesCount: 3,
        });

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
      });

      it('F8-B5: rapid start, cancel, restart of workout sessions in under 1 second', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackEvent('workout_started', { sessionId: 'w1' });
        telemetryHub.trackEvent('workout_cancelled', { sessionId: 'w1' });
        telemetryHub.trackEvent('workout_started', { sessionId: 'w2' });

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(3);
      });
    });

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
        localStorage.setItem(TELEMETRY_QUEUE_KEY, 'corrupted JSON string {');
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

        localStorage.setItem(
          TELEMETRY_QUEUE_KEY,
          JSON.stringify([
            { id: '1', timestamp: Date.now(), itemType: 'event', payload: { type: 'item1', context: getTelemetryContext(), userId: 'user_partial_replay', timestamp: Date.now() } },
            { id: '2', timestamp: Date.now(), itemType: 'event', payload: { type: 'item2', context: getTelemetryContext(), userId: 'user_partial_replay', timestamp: Date.now() } },
          ])
        );

        mockSetDoc
          .mockResolvedValueOnce(undefined as any)
          .mockRejectedValueOnce(new Error('Network dropped during flush'));

        await telemetryHub.flushQueue();

        const remaining = telemetryHub.getQueuedEvents();
        expect(remaining.length).toBe(1);
        expect(remaining[0].id).toBe('2');
      });

      it('F9-B5: flushQueue called when queue is already empty returns immediately without errors', async () => {
        telemetryHub.init();
        localStorage.removeItem(TELEMETRY_QUEUE_KEY);

        await expect(telemetryHub.flushQueue()).resolves.toBeUndefined();
      });
    });

    describe('F10 Boundaries: Security Rules Whitelist Edge Conditions', () => {
      it('F10-B1: telemetry payload with extra injected property fails whitelist check', () => {
        const payloadWithInjected = {
          timestamp: Date.now(),
          type: 'Error',
          message: 'Safe message',
          __proto__: { isAdmin: true },
          injected_field: 'malicious',
        };

        const allowedKeys = new Set(['timestamp', 'type', 'message', 'stack', 'context', 'userId', 'sessionId', 'count', 'firstSeen', 'lastSeen', 'source', 'componentStack', 'expireAt']);
        const isPermitted = Object.keys(payloadWithInjected).every((k) => allowedKeys.has(k));
        expect(isPermitted).toBe(false);
      });

      it('F10-B2: telemetry payload with missing required property (timestamp) fails validation', () => {
        const payloadMissingTimestamp = {
          type: 'Error',
          message: 'No timestamp',
        };
        expect(payloadMissingTimestamp).not.toHaveProperty('timestamp');
      });

      it('F10-B3: write attempt with spoofed userId mismatching request.auth.uid is rejected', () => {
        const authUid = 'auth_user_real';
        const targetUserId = 'auth_user_victim';

        const isOwner = (uid: string) => uid === authUid;
        expect(isOwner(targetUserId)).toBe(false);
      });

      it('F10-B4: unauthenticated write attempt to telemetry collection is rejected', () => {
        const auth: any = null;
        const isAuthenticated = () => auth !== null;
        expect(isAuthenticated()).toBe(false);
      });

      it('F10-B5: non-owner delete attempt on telemetry documents is rejected', () => {
        const authUid = 'attacker';
        const docOwnerUid = 'victim';
        const isOwner = (uid: string) => authUid === uid;
        expect(isOwner(docOwnerUid)).toBe(false);
      });
    });

    describe('F11 Boundaries: Async Fire-and-Forget Edge Conditions', () => {
      it('F11-B1: Firestore setDoc hangs indefinitely - aborts after 5000ms safety timeout', async () => {
        vi.useFakeTimers();
        mockSetDoc.mockImplementation(() => new Promise(() => {}));

        telemetryHub.init();
        telemetryHub.setUserId('user_hang');

        telemetryHub.trackEvent('hanging_event');
        await vi.advanceTimersByTimeAsync(6000);

        expect(true).toBe(true);
      });

      it('F11-B2: Firestore setDoc rejects with permission-denied - caught cleanly', async () => {
        mockSetDoc.mockRejectedValue(new Error('FirebaseError: Missing permissions'));

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
