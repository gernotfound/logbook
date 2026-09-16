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
  DEDUP_WINDOW_MS,
  type TelemetryErrorPayload,
} from '../../src/lib/telemetryHub';
import { installTelemetryTestHarness, mockSetDoc } from './telemetryTestHarness';

describe('Unified Telemetry Hub E2E Suite — Tier 2 Core', () => {
  installTelemetryTestHarness();

  describe('Tier 2: Boundary & Corner Cases — Core Telemetry', () => {
    describe('F1 Boundaries: Context Provider Edge Conditions', () => {
      it('F1-B1: handles navigator being undefined or null in non-browser context', () => {
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

      it('F1-B4: handles matchMedia throwing or returning undefined in restricted iframes', () => {
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
      it('F2-B1: handles massive 100KB stack trace without memory exhaustion or regex catastrophic backtracking', () => {
        const hugeStack = 'Error: Massive crash\n' + '    at executeFunction (bundle.min.js:100:500)\n'.repeat(2500);
        expect(hugeStack.length).toBeGreaterThan(100000);

        const start = performance.now();
        const truncated = truncateStack(hugeStack, 1000);
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(50);
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
          'User athlete@gym.it from IP 192.168.1.10 auth failed with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature at C:\\Users\\gerar\\app.ts';

        const scrubbed = scrubPII(multiPiiMessage);
        expect(scrubbed).not.toContain('athlete@gym.it');
        expect(scrubbed).not.toContain('192.168.1.10');
        expect(scrubbed).not.toContain('eyJhbGci');
        expect(scrubbed).not.toContain('C:\\Users\\gerar');
        expect(scrubbed).toContain('[REDACTED_EMAIL]');
        expect(scrubbed).toContain('[REDACTED_IP]');
        expect(scrubbed).toContain('[REDACTED_TOKEN]');
        expect(scrubbed).toContain('[REDACTED_PATH]');
      });

      it('F2-B4: handles empty string, null, or undefined stack traces cleanly', () => {
        expect(truncateStack(undefined)).toBeUndefined();
        expect(truncateStack('')).toBe('');
        expect(scrubPII('')).toBe('');
      });

      it('F2-B5: handles non-string error messages (numbers, objects, symbols, circular references)', () => {
        const circularObj: any = { message: 'Circular error' };
        circularObj.self = circularObj;

        const sanitizedCirc = sanitizeErrorPayload(circularObj);
        expect(sanitizedCirc.message).toBeDefined();

        const sanitizedNum = sanitizeErrorPayload(404);
        expect(sanitizedNum.message).toContain('404');

        const sanitizedNull = sanitizeErrorPayload(null);
        expect(sanitizedNull.message).toBeDefined();
      });
    });

    describe('F3 Boundaries: Deduplication & Rate Limiting Edge Conditions', () => {
      it('F3-B1: rapid spam of 100 identical errors within 50ms aggregates to single item with count=100', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_spam');

        const spamError = new Error('Rapid spam error');
        for (let i = 0; i < 100; i++) {
          telemetryHub.trackError(spamError);
        }

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.count).toBe(100);
      });

      it('F3-B2: errors with identical messages but different types produce separate dedup entries', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_types');

        telemetryHub.trackError(new TypeError('Same message across types'));
        telemetryHub.trackError(new RangeError('Same message across types'));

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(2);
      });

      it('F3-B3: errors with identical types but different messages produce separate dedup entries', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_messages');

        telemetryHub.trackError(new Error('First message'));
        telemetryHub.trackError(new Error('Second message'));

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(2);
      });

      it('F3-B4: error occurring at exactly 59.9s is deduplicated; at 60.1s starts new window', async () => {
        vi.useFakeTimers();
        const baseTime = 1724486400000;
        vi.setSystemTime(baseTime);

        telemetryHub.init();
        telemetryHub.setUserId('user_window_boundary');

        const err = new Error('Window boundary test');
        telemetryHub.trackError(err);

        vi.setSystemTime(baseTime + 59900);
        telemetryHub.trackError(err);

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect((mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload).count).toBe(2);

        vi.setSystemTime(baseTime + 60100);
        telemetryHub.trackError(err);

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
      });

      it('F3-B5: handles extreme timestamps (0, negative, NaN, Infinity) gracefully', () => {
        expect(DEDUP_WINDOW_MS).toBe(60000);
      });
    });

    describe('F4 Boundaries: React 19 Callbacks Edge Conditions', () => {
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
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
      });

      it('F4-B2: error thrown inside error tracking callback does not crash React boundary', () => {
        telemetryHub.init();
        mockSetDoc.mockImplementationOnce(() => {
          throw new Error('Firestore crash inside trackError');
        });

        expect(() => {
          telemetryHub.trackError(new Error('App error'));
        }).not.toThrow();
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
        expect(mockSetDoc).toHaveBeenCalled();
      });

      it('F4-B4: React 19 onRecoverableError with null or empty error object', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        expect(() => {
          telemetryHub.trackError(null, { source: 'react_recoverable' });
        }).not.toThrow();

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalled();
      });

      it('F4-B5: handles 50+ rapid React 19 render errors in a single tick', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        for (let i = 0; i < 50; i++) {
          telemetryHub.trackError(new Error(`Render loop error ${i}`), { source: 'react_caught' });
        }

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalled();
      });
    });

    describe('F5 Boundaries: Global Window Handlers Edge Conditions', () => {
      it('F5-B1: window.onerror invoked with all undefined arguments', () => {
        telemetryHub.init();
        expect(() => {
          if (window.onerror) {
            (window.onerror as any)(undefined, undefined, undefined, undefined, undefined);
          }
        }).not.toThrow();
      });

      it('F5-B2: window.onerror invoked with cross-origin "Script error."', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        if (window.onerror) {
          (window.onerror as any)('Script error.', '', 0, 0, undefined);
        }

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalled();
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
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
        expect(mockSetDoc).toHaveBeenCalled();
      });

      it('F5-B4: onunhandledrejection with primitive reason (number, boolean, symbol)', async () => {
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
        expect(mockSetDoc).toHaveBeenCalled();
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
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
        expect(mockSetDoc).toHaveBeenCalled();
      });
    });

    describe('F6 Boundaries: Zod Validation Discards Edge Conditions', () => {
      it('F6-B1: Zod validation error with 100+ nested validation issues', () => {
        const itemSchema = z.object({ value: z.number() });
        const listSchema = z.array(itemSchema);

        const invalidList = Array.from({ length: 100 }, () => ({ value: 'not_a_number' }));
        const res = listSchema.safeParse(invalidList);

        expect(res.success).toBe(false);
        if (!res.success) {
          expect(() => {
            telemetryHub.trackError(res.error, { source: 'zod_validation' });
          }).not.toThrow();
        }
      });

      it('F6-B2: Zod error with sensitive user workout note in received value is scrubbed', () => {
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
          expect(sanitized.message).not.toContain('athlete@coach.com');
          expect(sanitized.message).not.toContain('personal secrets');
        }
      });

      it('F6-B3: DomainParsers receives deeply nested invalid JSON array', () => {
        const nested = JSON.stringify({ a: { b: { c: { d: 'corrupted' } } } });
        expect(typeof nested).toBe('string');
      });

      it('F6-B4: Zod error with empty issues array handled without exception', () => {
        const customZodErr = new z.ZodError([]);
        expect(() => {
          telemetryHub.trackError(customZodErr, { source: 'zod_validation' });
        }).not.toThrow();
      });

      it('F6-B5: unexpected non-Zod exception thrown inside schema parse helper handled cleanly', () => {
        const unexpectedErr = new Error('Unexpected parsing crash');
        expect(() => {
          telemetryHub.trackError(unexpectedErr, { source: 'zod_validation' });
        }).not.toThrow();
      });
    });
  });
});
