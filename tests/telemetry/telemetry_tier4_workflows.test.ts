import { describe, it, expect, vi } from 'vitest';
import {
  telemetryHub,
  type TelemetryErrorPayload,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSentryTransport } from './telemetryTestHarness';

describe('TelemetryHub Vitest Integration Suite — Tier 4', () => {
  installTelemetryTestHarness();

  describe('Tier 4: Technical diagnostic and owner/privacy boundaries', () => {
    it('T4-3: React-root technical error payload is sanitized before dispatch', async () => {
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

      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
      const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
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

      const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
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
      // 1. Collect a guest technical report offline
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId(null); // Guest mode

      telemetryHub.trackError(new Error('Guest offline technical diagnostic'));
      const guestBeforeLogin = telemetryHub.getQueuedEvents();
      expect(guestBeforeLogin).toHaveLength(1);
      expect(guestBeforeLogin[0].payload.userId).toBeNull();
      expect(guestBeforeLogin[0].itemType).toBe('error');
      expect((guestBeforeLogin[0].payload as TelemetryErrorPayload).message).toBe('Guest offline technical diagnostic');
      const guestQueueKey = telemetryHub.getQueueStorageKey();
      expect(localStorage.getItem(guestQueueKey)).toBeNull();

      // 2. User signs in with Google account
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      telemetryHub.setUserId('google_auth_uid_999');

      // 3. Login cannot retroactively assign guest diagnostics to an account.
      await telemetryHub.flushQueue();

      expect(mockSentryTransport).not.toHaveBeenCalled();
      expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
      // Without an unlocked guest vault the guest report existed only in
      // memory; the Auth switch discards it rather than reassigning ownership.
      expect(localStorage.getItem(guestQueueKey)).toBeNull();
    });
  });
});
