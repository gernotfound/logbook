import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  telemetryHub,
  type TelemetryErrorPayload,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSetDoc } from './telemetryTestHarness';

describe('Unified Telemetry Hub E2E Suite — Tier 3', () => {
  installTelemetryTestHarness();

  describe('Tier 3: Cross-Feature Interactions & Combinations', () => {
    it('T3-1: Offline Queue + Rapid Error Spam: errors in offline mode are deduplicated inside the queue and aggregate count before replay', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_t3_1');

      const spamErr = new Error('Offline spam error');
      for (let i = 0; i < 10; i++) {
        telemetryHub.trackError(spamErr);
      }

      // Should be deduplicated into 1 queued item with count = 10
      const queued = telemetryHub.getQueuedEvents();
      expect(queued.length).toBe(1);
      expect((queued[0].payload as TelemetryErrorPayload).count).toBe(10);

      // Reconnect and replay
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect((mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload).count).toBe(10);
    });

    it('T3-2: React 19 onCaughtError + Privacy PII Scrubbing + Stack Truncation: React component stack containing email and huge trace is sanitized and truncated', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_t3_2');

      const hugeTrace = 'Error: React render failed\n' +
        '    at UserProfile (C:\\Users\\example-user\\app.tsx:1:1) email=john.doe@gym.com\n'.repeat(40);

      telemetryHub.trackError(new Error('React component crash'), {
        source: 'react_caught',
        componentStack: hugeTrace,
      });

      await vi.advanceTimersByTimeAsync(100);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;

      expect(payload.componentStack).not.toContain('john.doe@gym.com');
      expect(payload.componentStack).not.toContain('C:\\Users\\example-user');
      expect(payload.componentStack).toContain('[REDACTED_EMAIL]');
      expect(payload.componentStack).toContain('[REDACTED_PATH]');
      expect(payload.componentStack!.length).toBeLessThanOrEqual(1000);
    });

    it('T3-3: Zod Schema Discard + Offline Queue + Online Replay: Zod validation error is queued while offline and replayed through the diagnostics transport upon reconnecting', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_t3_3');

      const schema = z.object({ sets: z.number() });
      const parseRes = schema.safeParse({ sets: 'corrupted_string' });

      if (!parseRes.success) {
        telemetryHub.trackError(parseRes.error, { source: 'zod_validation' });
      }

      expect(telemetryHub.getQueuedEvents().length).toBe(1);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.source).toBe('zod_validation');
    });

    it('T3-5: offline schema diagnostics, an unhandled rejection and FIFO replay preserve ordered technical reports', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_t3_5');

      telemetryHub.trackEvent('zod_schema_fallback', { schema: 'profile' });
      const rejPromise = Promise.reject(new Error('Timer tick promise rejection'));
      rejPromise.catch(() => {});
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: rejPromise,
          reason: new Error('Timer tick promise rejection'),
        })
      );
      telemetryHub.trackEvent('zod_schema_fallback', { schema: 'nutrition' });

      const queued = telemetryHub.getQueuedEvents();
      expect(queued.length).toBe(3);
      expect(queued[0].payload.type).toBe('zod_schema_fallback');
      expect(queued[1].payload.type).toBe('Error');
      expect(queued[2].payload.type).toBe('zod_schema_fallback');

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(mockSetDoc).toHaveBeenCalledTimes(3);
      expect(mockSetDoc.mock.calls[0][1].details?.schema).toBe('profile');
      expect(mockSetDoc.mock.calls[1][1].type).toBe('Error');
      expect(mockSetDoc.mock.calls[2][1].details?.schema).toBe('nutrition');
    });

    it('T3-6: Privacy Engine Output + Diagnostic Payload Whitelist: all sanitized payloads strictly conform to the telemetry payload allowlist without disallowed keys', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_t3_6');

      const dirtyError = new Error('Database write error at 192.168.1.1 for user john@fit.it with token eyJhbGci.secret');
      telemetryHub.trackError(dirtyError);

      await vi.advanceTimersByTimeAsync(100);

      const dispatchedPayload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;

      // Whitelist verification
      const allowedKeys = new Set([
        'timestamp',
        'id',
        'hash',
        'type',
        'message',
        'stack',
        'context',
        'userId',
        'sessionId',
        'count',
        'firstSeen',
        'lastSeen',
        'source',
        'componentStack',
        'expireAt',
      ]);

      const keys = Object.keys(dispatchedPayload);
      expect(keys.every((k) => allowedKeys.has(k))).toBe(true);
      expect(dispatchedPayload.message).not.toContain('192.168.1.1');
      expect(dispatchedPayload.message).not.toContain('john@fit.it');
      expect(dispatchedPayload.message).not.toContain('eyJhbGci.secret');
    });
  });
});
