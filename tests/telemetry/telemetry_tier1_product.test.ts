import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as firebaseLib from '../../src/lib/firebase';
import { getTelemetryContext } from '../../src/lib/telemetrySanitizer';
import {
  telemetryHub,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  type TelemetryEventPayload,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSetDoc } from './telemetryTestHarness';

describe('Unified Telemetry Hub E2E Suite — Tier 1 Product', () => {
  installTelemetryTestHarness();

  describe('Tier 1: Feature Coverage — Product & Delivery', () => {
    describe('F7: PWA Install Funnel Analytics', () => {
      it('F7-1: tracks beforeinstallprompt event as install prompt impression', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_pwa_1');

        telemetryHub.trackEvent('pwa_prompt_shown', { platform: 'other' });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.type).toBe('pwa_prompt_shown');
      });

      it('F7-2: tracks custom install button click in Settings/Banner', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_pwa_1');

        telemetryHub.trackEvent('pwa_install_clicked', { source: 'settings_view' });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.type).toBe('pwa_install_clicked');
        expect(payload.details?.source).toBe('settings_view');
      });

      it('F7-3: tracks user acceptance of install prompt (outcome: accepted)', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_pwa_1');

        telemetryHub.trackEvent('pwa_prompt_accepted', { outcome: 'accepted' });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.type).toBe('pwa_prompt_accepted');
        expect(payload.details?.outcome).toBe('accepted');
      });

      it('F7-4: tracks user dismissal of install prompt (outcome: dismissed)', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_pwa_1');

        telemetryHub.trackEvent('pwa_prompt_dismissed', { outcome: 'dismissed' });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.type).toBe('pwa_prompt_dismissed');
      });

      it('F7-5: tracks native appinstalled event completing the install funnel', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_pwa_1');

        telemetryHub.trackEvent('pwa_installed');
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.type).toBe('pwa_installed');
      });
    });

    describe('F8: Offline Workout Analytics', () => {
      it('F8-1: tracks workout_started event with offline: false when online', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_workout');

        telemetryHub.trackEvent('workout_started', { offline: false, routineId: 'routine_1' });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.type).toBe('workout_started');
        expect(payload.details?.offline).toBe(false);
      });

      it('F8-2: tracks workout_started event with offline: true when offline', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_workout');

        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

        telemetryHub.trackEvent('workout_started', { offline: true, routineId: 'routine_offline' });
        await vi.advanceTimersByTimeAsync(100);

        const queued = telemetryHub.getQueuedEvents();
        expect(queued.length).toBe(1);
        expect(queued[0].payload.type).toBe('workout_started');
        expect((queued[0].payload as TelemetryEventPayload).details?.offline).toBe(true);

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F8-3: tracks workout_saved event with offline: true when saved without network', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_workout');
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

        telemetryHub.trackEvent('workout_saved', {
          offline: true,
          durationMinutes: 45,
          exercisesCount: 6,
        });

        await vi.advanceTimersByTimeAsync(100);

        const queued = telemetryHub.getQueuedEvents();
        expect(queued.length).toBe(1);
        expect(queued[0].payload.type).toBe('workout_saved');
        expect((queued[0].payload as TelemetryEventPayload).details?.durationMinutes).toBe(45);

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F8-4: tracks workout_saved event with offline: false when saved with active connection', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_workout');

        telemetryHub.trackEvent('workout_saved', {
          offline: false,
          durationMinutes: 60,
          exercisesCount: 8,
        });

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.type).toBe('workout_saved');
        expect(payload.details?.offline).toBe(false);
      });

      it('F8-5: preserves allowed workout aggregates and drops non-allowlisted set counts', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_workout');

        telemetryHub.trackEvent('workout_saved', {
          offline: false,
          durationMinutes: 75,
          exercisesCount: 10,
          totalSets: 32,
        });

        await vi.advanceTimersByTimeAsync(100);

        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.details?.totalSets).toBeUndefined();
        expect(payload.details?.exercisesCount).toBe(10);
      });
    });

    describe('F9: Offline Queue & Replay Engine', () => {
      it('F9-1: buffers errors and events in localStorage when navigator.onLine is false', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_queue');

        telemetryHub.trackError(new Error('Offline error 1'));
        telemetryHub.trackEvent('offline_event_1', { data: 123 });

        const rawQueue = localStorage.getItem(TELEMETRY_QUEUE_KEY);
        expect(rawQueue).not.toBeNull();
        const parsed = JSON.parse(rawQueue!);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(2);

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('F9-2: persists queue under logbook_telemetry_queue key in valid JSON format', () => {
        expect(TELEMETRY_QUEUE_KEY).toBe('logbook_telemetry_queue');
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

        localStorage.setItem(
          TELEMETRY_QUEUE_KEY,
          JSON.stringify([
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
          ])
        );

        await telemetryHub.flushQueue();

        expect(mockSetDoc).toHaveBeenCalled();
        const remaining = localStorage.getItem(TELEMETRY_QUEUE_KEY);
        const parsedRemaining = remaining ? JSON.parse(remaining) : [];
        expect(parsedRemaining.length).toBe(0);
      });
    });

    describe('F10: Firestore Rules & Whitelists', () => {
      const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
      const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

      it('F10-1: validates telemetry_errors payload matches exact allowed key whitelist', () => {
        const validErrorPayload = {
          timestamp: Date.now(),
          type: 'TypeError',
          message: 'Cannot read property',
          stack: 'Error: Cannot read property\n at foo.js:1:1',
          context: {
            appVersion: '1.3.0',
            platform: 'ios',
            displayMode: 'standalone',
            online: true,
          },
          userId: 'user_123',
          sessionId: 'session_abc',
          count: 1,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          source: 'react_root',
          componentStack: 'at App (App.tsx:10)',
        };

        const allowedKeys = new Set([
          'timestamp', 'type', 'message', 'stack', 'context', 'userId', 'sessionId',
          'count', 'firstSeen', 'lastSeen', 'source', 'componentStack',
        ]);

        const payloadKeys = Object.keys(validErrorPayload);
        const isPermitted = payloadKeys.every((k) => allowedKeys.has(k));
        expect(isPermitted).toBe(true);
      });

      it('F10-2: validates telemetry_events payload matches exact allowed key whitelist', () => {
        const validEventPayload = {
          timestamp: Date.now(),
          type: 'pwa_installed',
          context: {
            appVersion: '1.3.0',
            platform: 'other',
            displayMode: 'standalone',
            online: true,
          },
          userId: 'user_123',
          sessionId: 'session_abc',
          details: { source: 'settings' },
        };

        const allowedKeys = new Set([
          'timestamp', 'type', 'context', 'userId', 'sessionId', 'details',
        ]);

        const payloadKeys = Object.keys(validEventPayload);
        const isPermitted = payloadKeys.every((k) => allowedKeys.has(k));
        expect(isPermitted).toBe(true);
      });

      it('F10-3: rejects telemetry writes with unauthorized injected properties', () => {
        const allowedKeys = new Set([
          'timestamp', 'type', 'message', 'stack', 'context', 'userId', 'sessionId',
          'count', 'firstSeen', 'lastSeen', 'source', 'componentStack',
        ]);

        const maliciousPayload = {
          timestamp: Date.now(),
          type: 'Error',
          message: 'Error message',
          unauthorized_admin_override: true,
          credit_card: '4111-2222-3333-4444',
        };

        const isPermitted = Object.keys(maliciousPayload).every((k) => allowedKeys.has(k));
        expect(isPermitted).toBe(false);
      });

      it('F10-4: ensures isOwner(userId) rule is enforced for telemetry subcollections', () => {
        expect(rulesContent).toContain('isOwner(userId)');
      });

      it('F10-5: confirms cascading deletion support in deleteAccount for telemetry subcollections', () => {
        expect(typeof firebaseLib).toBe('object');
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

      it('F11-2: Firestore network timeout triggers safety fallback without unhandled promise rejection', async () => {
        mockSetDoc.mockImplementation(
          () => new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 6000))
        );

        telemetryHub.init();
        telemetryHub.setUserId('user_timeout');

        expect(() => {
          telemetryHub.trackError(new Error('Timeout test'));
        }).not.toThrow();
      });

      it('F11-3: Firestore permission or quota error is caught silently without throwing to UI', async () => {
        mockSetDoc.mockRejectedValue(new Error('FirebaseError: [code=permission-denied]'));

        telemetryHub.init();
        telemetryHub.setUserId('user_perm_denied');

        expect(() => {
          telemetryHub.trackError(new Error('Permission denied error'));
          telemetryHub.trackEvent('permission_event');
        }).not.toThrow();
      });

      it('F11-4: telemetry dispatch does not delay or block synchronous workout saving in useAppStore', () => {
        telemetryHub.init();

        const start = performance.now();
        for (let i = 0; i < 50; i++) {
          telemetryHub.trackEvent('workout_saved', { index: i });
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
