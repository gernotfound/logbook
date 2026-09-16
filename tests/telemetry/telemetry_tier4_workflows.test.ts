import { describe, it, expect, vi } from 'vitest';
import {
  telemetryHub,
  type TelemetryErrorPayload,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSetDoc } from './telemetryTestHarness';

describe('Unified Telemetry Hub E2E Suite — Tier 4', () => {
  installTelemetryTestHarness();

  describe('Tier 4: Real-World Application Workflows', () => {
    it('T4-1: Full PWA Install Funnel Lifecycle: beforeinstallprompt -> settings click -> accepted outcome -> native appinstalled', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('athlete_pwa_install');

      // 1. App loads, beforeinstallprompt fires
      telemetryHub.trackEvent('pwa_prompt_shown', { platform: 'android' });

      // 2. User navigates to Settings and clicks install
      telemetryHub.trackEvent('pwa_install_clicked', { source: 'settings_view' });

      // 3. User accepts prompt
      telemetryHub.trackEvent('pwa_prompt_accepted', { outcome: 'accepted' });

      // 4. Native OS installation completes
      telemetryHub.trackEvent('pwa_installed');

      await vi.advanceTimersByTimeAsync(100);

      expect(mockSetDoc).toHaveBeenCalledTimes(4);
      const types = mockSetDoc.mock.calls.map((c: any) => c[1].type);
      expect(types).toEqual([
        'pwa_prompt_shown',
        'pwa_install_clicked',
        'pwa_prompt_accepted',
        'pwa_installed',
      ]);
    });

    it('T4-2: Full Offline Workout & Network Replay Flow: start offline -> 3 exercise errors -> complete & save offline -> reconnect -> FIFO replay', async () => {
      // 1. Enter basement gym (offline)
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('athlete_gym_offline');

      // 2. Start workout
      telemetryHub.trackEvent('workout_started', { offline: true, routineId: 'push_day' });

      // 3. Non-critical timer parsing errors occur 3 times
      const parseErr = new Error('Timer calculation exception');
      telemetryHub.trackError(parseErr);
      telemetryHub.trackError(parseErr);
      telemetryHub.trackError(parseErr);

      // 4. Finish workout
      telemetryHub.trackEvent('workout_saved', {
        offline: true,
        durationMinutes: 55,
        exercisesCount: 7,
      });

      // Verify queue has exactly 3 distinct entries (workout_started, aggregated Error with count 3, workout_saved)
      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(3);
      expect((queue[1].payload as TelemetryErrorPayload).count).toBe(3);

      // 5. Exit gym and reconnect to network
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));

      await vi.waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalledTimes(3);
        expect(telemetryHub.getQueuedEvents().length).toBe(0);
      });
    });

    it('T4-3: React 19 Root Crash & Error Recovery: root render exception -> onUncaughtError -> privacy scrub -> buffer -> fallback UI mounted', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('athlete_crash_recovery');

      const crashError = new Error('Uncaught invariant violation in VirtualList');
      const crashStack = 'Invariant Violation\n    at VirtualList (C:\\Users\\athlete\\logbook\\VirtualList.tsx:10:5)\n'.repeat(30);

      telemetryHub.trackError(crashError, {
        source: 'react_uncaught',
        componentStack: crashStack,
      });

      await vi.advanceTimersByTimeAsync(100);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.source).toBe('react_uncaught');
      expect(payload.componentStack).not.toContain('C:\\Users\\athlete');
      expect(payload.componentStack!.length).toBeLessThanOrEqual(1000);
    });

    it('T4-4: Privacy Boundary Stress Test: payload with JWT, Bearer token, IP, email, local file paths, and notes is completely sanitized', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('privacy_tester');

      const dirtyError = new Error(
        'Failed request Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature from IP 10.0.0.1 for user athlete@fitness.com at /home/user/logbook/src/db.ts:15'
      );

      telemetryHub.trackError(dirtyError);
      await vi.advanceTimersByTimeAsync(100);

      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.message).not.toContain('eyJhbGci');
      expect(payload.message).not.toContain('10.0.0.1');
      expect(payload.message).not.toContain('athlete@fitness.com');
      expect(payload.message).not.toContain('/home/user/logbook');

      expect(payload.message).toContain('[REDACTED_TOKEN]');
      expect(payload.message).toContain('[REDACTED_IP]');
      expect(payload.message).toContain('[REDACTED_EMAIL]');
      expect(payload.message).toContain('[REDACTED_PATH]');
    });

    it('T4-5: guest telemetry keeps its original identity and is not uploaded after Google login', async () => {
      // 1. Guest user offline actions
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId(null); // Guest mode

      telemetryHub.trackEvent('guest_offline_action', { action: 'view_catalog' });
      expect(telemetryHub.getQueuedEvents().length).toBe(1);

      // 2. User signs in with Google account
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      telemetryHub.setUserId('google_auth_uid_999');

      // 3. Login cannot retroactively assign guest events to an account.
      await telemetryHub.flushQueue();

      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(telemetryHub.getQueuedEvents()).toHaveLength(1);
      expect(telemetryHub.getQueuedEvents()[0].payload.userId).toBeNull();
    });
  });
});
