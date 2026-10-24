import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  scrubPII,
  truncateStack,
  detectDerivedPlatform,
  isStandaloneMode,
  getTelemetryContext,
  sanitizeErrorPayload,
} from '../../src/lib/telemetrySanitizer';
import {
  telemetryHub,
  type TelemetryErrorPayload,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSentryTransport } from './telemetryTestHarness';

describe('TelemetryHub Vitest Integration Suite — Tier 2 Core', () => {
  installTelemetryTestHarness();

  describe('Tier 2: Boundary & Corner Cases — Core Telemetry', () => {
    describe('F1 Boundaries: Context Provider Edge Conditions', () => {
      it('F1-B1: handles omitted navigator in non-browser context', () => {
        const platform = detectDerivedPlatform(undefined);
        expect(platform).toBe('other');

        const ctx = getTelemetryContext(undefined, undefined);
        expect(ctx.platform).toBe('other');
      });

      it('F1-B2: handles missing userAgent or empty string platform gracefully', () => {
        const mockNav = { userAgent: '', platform: '', maxTouchPoints: 0 } as Navigator;
        expect(detectDerivedPlatform(mockNav)).toBe('other');
      });

      it('F1-B3: handles negative, zero, or non-numeric maxTouchPoints', () => {
        const mockNavNeg = {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          platform: 'MacIntel',
          maxTouchPoints: -1,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockNavNeg)).toBe('other');

        const mockNavNaN = {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          platform: 'MacIntel',
          maxTouchPoints: NaN,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockNavNaN)).toBe('other');
      });

      it('F1-B4: handles matchMedia throwing in restricted iframes', () => {
        const mockWinThrow = {
          navigator: { standalone: false },
          matchMedia: vi.fn().mockImplementation(() => {
            throw new Error('SecurityError: Access denied to matchMedia');
          }),
        } as unknown as Window;

        expect(isStandaloneMode(mockWinThrow)).toBe(false);
      });

      it('F1-B5: handles unknown or custom display-mode media query values', () => {
        const mockWinCustom = {
          navigator: { standalone: false },
          matchMedia: vi.fn().mockReturnValue({ matches: false }),
        } as unknown as Window;

        expect(isStandaloneMode(mockWinCustom)).toBe(false);
      });
    });

    describe('F2 Boundaries: Privacy & Truncation Edge Conditions', () => {
      it('F2-B1: bounds a 100KB stack trace after scrubbing', () => {
        const hugeStack = 'Error: Massive crash\n' + '    at executeFunction (bundle.min.js:100:500)\n'.repeat(2500);
        expect(hugeStack.length).toBeGreaterThan(100000);

        const truncated = truncateStack(hugeStack, 1000);
        expect(truncated!.length).toBeLessThanOrEqual(1000);
        expect(truncated).toContain('...[TRUNCATED]');
      });

      it('F2-B2: handles stack trace with no newlines or unusual formatting', () => {
        const singleLineStack = 'Error: inline crash at eval() at Function() at window()';
        const truncated = truncateStack(singleLineStack, 30);
        expect(truncated!.length).toBeLessThanOrEqual(30);
      });

      it('F2-B3: handles error message containing all PII patterns simultaneously', () => {
        const multiPiiMessage =
          'User athlete@gym.it from IP 192.168.1.10 auth failed with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature at C:\\Users\\example-user\\app.ts';

        const scrubbed = scrubPII(multiPiiMessage);
        expect(scrubbed).not.toContain('athlete@gym.it');
        expect(scrubbed).not.toContain('192.168.1.10');
        expect(scrubbed).not.toContain('eyJhbGci');
        expect(scrubbed).not.toContain('C:\\Users\\example-user');
        expect(scrubbed).toContain('[REDACTED_EMAIL]');
        expect(scrubbed).toContain('[REDACTED_IP]');
        expect(scrubbed).toContain('[REDACTED_TOKEN]');
        expect(scrubbed).toContain('[REDACTED_PATH]');
      });

      it('F2-B4: scrubs PII before truncation even when the sensitive token crosses the boundary', () => {
        const crossingBoundary = 'x'.repeat(979) + ' athlete@example.com ' + 'y'.repeat(100);
        const truncated = truncateStack(crossingBoundary, 1000);

        expect(truncated).toContain('...[TRUNCATED]');
        expect(truncated).not.toContain('athlete@example.com');
        expect(truncated).not.toContain('athlet');
        expect(truncated!.length).toBeLessThanOrEqual(1000);
      });

      it('F2-B5: handles empty string, null, or undefined stack traces cleanly', () => {
        expect(truncateStack(undefined)).toBeUndefined();
        expect(truncateStack('')).toBe('');
        expect(scrubPII('')).toBe('');
      });

      it('F2-B6: handles non-string error messages (numbers, null and circular objects)', () => {
        const circularObj: any = { message: 'Circular error' };
        circularObj.self = circularObj;

        const sanitizedCirc = sanitizeErrorPayload(circularObj);
        expect(sanitizedCirc.message).toBe('Circular error');

        const sanitizedNum = sanitizeErrorPayload(404);
        expect(sanitizedNum.message).toContain('404');

        const sanitizedNull = sanitizeErrorPayload(null);
        expect(sanitizedNull.message).toBe('null');
      });
    });

    describe('F3 Boundaries: Deduplication & Rate Limiting Edge Conditions', () => {

      it('F3-B2: errors with identical messages but different types produce separate dedup entries', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_types');

        telemetryHub.trackError(new TypeError('Same message across types'));
        telemetryHub.trackError(new RangeError('Same message across types'));

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(2);
      });

      it('F3-B3: errors with identical types but different messages produce separate dedup entries', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_messages');

        telemetryHub.trackError(new Error('First message'));
        telemetryHub.trackError(new Error('Second message'));

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(2);
      });


    });

    describe('F4 Boundaries: React 19 source metadata, without mounting a root', () => {
      it('F4-B1: React 19 onCaughtError receives empty or undefined componentStack', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        expect(() => {
          telemetryHub.trackError(new Error('No component stack'), {
            source: 'react_caught',
            componentStack: undefined,
          });
        }).not.toThrow();

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_caught');
        expect(payload.componentStack).toBeUndefined();
      });

      it('F4-B2: a failed Sentry transport retains the current owner report', async () => {
        vi.useFakeTimers();
        mockSentryTransport.mockRejectedValueOnce(new Error('Sentry transport unavailable'));
        telemetryHub.init();
        telemetryHub.setUserId('user_failed_transport');

        expect(() => telemetryHub.trackError(new Error('App error'))).not.toThrow();
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const queued = telemetryHub.getQueuedEvents();
        expect(queued).toHaveLength(1);
        expect(queued[0].itemType).toBe('error');
        expect(queued[0].payload.userId).toBe('user_failed_transport');
        expect((queued[0].payload as TelemetryErrorPayload).message).toBe('App error');
      });

      it('F4-B3: React 19 callback receives circular error object', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        const circErr: any = new Error('Circular error in React');
        circErr.context = circErr;

        expect(() => {
          telemetryHub.trackError(circErr, { source: 'react_caught' });
        }).not.toThrow();

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        expect((mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload).message).toBe('Circular error in React');
      });

      it('F4-B4: React 19 onRecoverableError with null or empty error object', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        expect(() => {
          telemetryHub.trackError(null, { source: 'react_recoverable' });
        }).not.toThrow();

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_recoverable');
        expect(payload.message).toBe('null');
      });

      it('F4-B5: handles 50+ rapid React 19 render errors in a single tick', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        for (let i = 0; i < 50; i++) {
          telemetryHub.trackError(new Error(`Render loop error ${i}`), { source: 'react_caught' });
        }

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(50);
        expect(mockSentryTransport.mock.calls.every((call: [string, TelemetryErrorPayload]) => call[0] === 'error' && call[1].source === 'react_caught')).toBe(true);
      });
    });

    describe('F5 Boundaries: Global Window Handlers Edge Conditions', () => {
      it('F5-B1: error event without Error reports a fallback non-blockingly', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        expect(() => window.dispatchEvent(new ErrorEvent('error'))).not.toThrow();
        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('window_error');
        expect(payload.message).toBe('Window error');
      });

      it('F5-B2: global cross-origin "Script error." is still reported', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalled();
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.message).toContain('Script error');
      });

      it('F5-B3: onunhandledrejection with undefined or null reason', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        const rejPromise = Promise.reject(null);
        rejPromise.catch(() => {});
        window.dispatchEvent(
          new PromiseRejectionEvent('unhandledrejection', {
            promise: rejPromise,
            reason: null,
          })
        );

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('unhandled_rejection');
        expect(payload.message).toBe('Unhandled rejection');
      });

      it('F5-B4: onunhandledrejection with numeric reason', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        const rejPromise = Promise.reject(500);
        rejPromise.catch(() => {});
        window.dispatchEvent(
          new PromiseRejectionEvent('unhandledrejection', {
            promise: rejPromise,
            reason: 500,
          })
        );

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalled();
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.message).toContain('500');
      });

      it('F5-B5: multiple unhandled rejections fired simultaneously in Promise.allSettled', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        for (let i = 0; i < 10; i++) {
          const rejPromise = Promise.reject(new Error(`Concurrent rejection ${i}`));
          rejPromise.catch(() => {});
          window.dispatchEvent(
            new PromiseRejectionEvent('unhandledrejection', {
              promise: rejPromise,
              reason: new Error(`Concurrent rejection ${i}`),
            })
          );
        }

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(10);
        expect(mockSentryTransport.mock.calls.every((call: [string, TelemetryErrorPayload]) => call[0] === 'error' && call[1].source === 'unhandled_rejection')).toBe(true);
      });
    });

    describe('F6 Boundaries: Zod Validation Discards Edge Conditions', () => {
      it('F6-B1: reports 100 real Zod issues through the Sentry transport', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_zod_issues');
        const schema = z.array(z.object({ value: z.number() }));
        const result = schema.safeParse(Array.from({ length: 100 }, () => ({ value: 'invalid' })));
        expect(result.success).toBe(false);
        if (!result.success) telemetryHub.trackError(result.error, { source: 'zod_validation' });
        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('zod_validation');
        expect(payload.type).toBe('ZodError');
        expect(payload.userId).toBe('user_zod_issues');
        expect(payload.message).toContain('value');
      });

      it('F6-B2: a Zod max-length issue does not serialize the rejected workout note', () => {
        const NoteSchema = z.object({
          note: z.string().max(10),
        });

        const sensitiveInput = {
          note: 'This is my private gym note with email athlete@coach.com and personal secrets exceeding max length',
        };

        const res = NoteSchema.safeParse(sensitiveInput);
        expect(res.success).toBe(false);

        if (!res.success) {
          const sanitized = sanitizeErrorPayload(res.error, { source: 'zod_validation' });
          // This verifies the Zod issue shape, NOT sanitization of arbitrary
          // health notes. That provider-boundary guarantee is tested separately.
          expect(res.error.message).not.toContain(sensitiveInput.note);
          expect(sanitized.message).not.toContain(sensitiveInput.note);
          expect(sanitized.type).toBe('ZodError');
        }
      });


      it('F6-B4: empty Zod issue list dispatches a technical report', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.trackError(new z.ZodError([]), { source: 'zod_validation' });
        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.type).toBe('ZodError');
        expect(payload.source).toBe('zod_validation');
      });

      it('F6-B5: unexpected parse exception dispatches technical diagnostics', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.trackError(new Error('Unexpected parsing crash'), { source: 'zod_validation' });
        await vi.advanceTimersByTimeAsync(100);
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('zod_validation');
        expect(payload.message).toBe('Unexpected parsing crash');
      });
    });
  });
});
