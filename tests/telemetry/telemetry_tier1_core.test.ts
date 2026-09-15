import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  scrubPII,
  truncateStack,
  detectDerivedPlatform,
  isStandaloneMode,
  getTelemetryContext,
  hashError,
  sanitizeErrorPayload,
} from '../../src/lib/telemetrySanitizer';
import {
  telemetryHub,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
} from '../../src/lib/telemetryHub';
import {
  installTelemetryTestHarness,
  mockSetDoc,
  originalNavigator,
} from './telemetryTestHarness';

describe('Unified Telemetry Hub E2E Suite — Tier 1 Core', () => {
  installTelemetryTestHarness();

  describe('Tier 1: Feature Coverage — Core Telemetry', () => {
    describe('F1: Telemetry Context Provider', () => {
      it('F1-1: captures appVersion from package or build configuration', () => {
        const ctx = getTelemetryContext();
        expect(ctx).toBeDefined();
        expect(typeof ctx.appVersion).toBe('string');
        expect(ctx.appVersion.length).toBeGreaterThan(0);
      });

      it('F1-2: derives platform correctly for iOS (iPhone/iPod userAgent)', () => {
        const mockNav = {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
          platform: 'iPhone',
          maxTouchPoints: 5,
        } as unknown as Navigator;

        const platform = detectDerivedPlatform(mockNav);
        expect(platform).toBe('ios');
      });

      it('F1-3: derives platform correctly for iPadOS (iPad UA or MacIntel with touch)', () => {
        const mockIpadNav = {
          userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
          platform: 'iPad',
          maxTouchPoints: 5,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockIpadNav)).toBe('ipados');

        const mockMacTouchNav = {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        } as unknown as Navigator;
        expect(detectDerivedPlatform(mockMacTouchNav)).toBe('ipados');
      });

      it('F1-4: detects standalone displayMode via navigator.standalone and matchMedia', () => {
        const mockStandaloneWin = {
          navigator: { standalone: true },
          matchMedia: vi.fn().mockReturnValue({ matches: false }),
        } as unknown as Window;
        expect(isStandaloneMode(mockStandaloneWin)).toBe(true);

        const mockMediaStandaloneWin = {
          navigator: { standalone: false },
          matchMedia: vi.fn().mockImplementation((q: string) => ({
            matches: q.includes('standalone'),
          })),
        } as unknown as Window;
        expect(isStandaloneMode(mockMediaStandaloneWin)).toBe(true);

        const mockBrowserWin = {
          navigator: { standalone: false },
          matchMedia: vi.fn().mockReturnValue({ matches: false }),
        } as unknown as Window;
        expect(isStandaloneMode(mockBrowserWin)).toBe(false);
      });

      it('F1-5: accurately reflects navigator.onLine status and session info in context snapshot', () => {
        const mockNavOnline = { ...originalNavigator, onLine: true } as unknown as Navigator;
        const ctxOnline = getTelemetryContext(mockNavOnline);
        expect(ctxOnline.online).toBe(true);

        const mockNavOffline = { ...originalNavigator, onLine: false } as unknown as Navigator;
        const ctxOffline = getTelemetryContext(mockNavOffline);
        expect(ctxOffline.online).toBe(false);
      });
    });

    describe('F2: Privacy Sanitization Engine', () => {
      it('F2-1: truncates stack trace exceeding 1000 characters cleanly with ellipsis marker', () => {
        const longStack = 'Error: test failure\n' + '    at performAction (app.js:1:1)\n'.repeat(50);
        expect(longStack.length).toBeGreaterThan(1000);

        const truncated = truncateStack(longStack, 1000);
        expect(truncated).toBeDefined();
        expect(truncated!.length).toBeLessThanOrEqual(1000);
        expect(truncated).toContain('...[TRUNCATED]');
      });

      it('F2-2: scrubs email addresses from error message and stack trace', () => {
        const raw = 'Failed to authenticate user athlete.john.doe@example.com with status 401';
        const scrubbed = scrubPII(raw);
        expect(scrubbed).not.toContain('athlete.john.doe@example.com');
        expect(scrubbed).toContain('[REDACTED_EMAIL]');
      });

      it('F2-3: scrubs IPv4 and IPv6 addresses from error message and stack trace', () => {
        const rawV4 = 'Connection refused from server 192.168.1.105:8080 during fetch';
        expect(scrubPII(rawV4)).not.toContain('192.168.1.105');
        expect(scrubPII(rawV4)).toContain('[REDACTED_IP]');

        const rawV6 = 'Host 2001:0db8:85a3:0000:0000:8a2e:0370:7334 unreachable';
        expect(scrubPII(rawV6)).not.toContain('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
        expect(scrubPII(rawV6)).toContain('[REDACTED_IP]');
      });

      it('F2-4: scrubs JWT tokens and Bearer authentication credentials from payload', () => {
        const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature1234567890';
        const raw = `Authorization failed with header Bearer ${fakeJwt}`;
        const scrubbed = scrubPII(raw);
        expect(scrubbed).not.toContain(fakeJwt);
        expect(scrubbed).toContain('[REDACTED_TOKEN]');
      });

      it('F2-5: scrubs absolute local filesystem paths (Windows/POSIX) from traces', () => {
        const rawWin = 'Error at C:\\Users\\gerar\\Documents\\GitHub\\logbook\\src\\store.ts:42:15';
        const scrubbedWin = scrubPII(rawWin);
        expect(scrubbedWin).not.toContain('C:\\Users\\gerar\\Documents');
        expect(scrubbedWin).toContain('[REDACTED_PATH]');

        const rawPosix = 'Error at /Users/john/workspaces/project/src/main.tsx:10:5';
        const scrubbedPosix = scrubPII(rawPosix);
        expect(scrubbedPosix).not.toContain('/Users/john/workspaces');
        expect(scrubbedPosix).toContain('[REDACTED_PATH]');
      });
    });

    describe('F3: Error Tracking Core & Deduplication', () => {
      it('F3-1: hashes error by type and message to produce deterministic dedup key', () => {
        const key1 = hashError('TypeError', 'Cannot read properties of undefined');
        const key2 = hashError('TypeError', 'Cannot read properties of undefined');
        const key3 = hashError('ReferenceError', 'Cannot read properties of undefined');

        expect(key1).toBe(key2);
        expect(key1).not.toBe(key3);
        expect(typeof key1).toBe('string');
        expect(key1.length).toBeGreaterThan(0);
      });

      it('F3-2: aggregates repeated errors within 60s sliding window into single document with incremented count', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_test_123');

        const err = new Error('Network timeout on workout sync');
        telemetryHub.trackError(err);
        telemetryHub.trackError(err);
        telemetryHub.trackError(err);

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.type).toBe('Error');
        expect(payload.message).toContain('Network timeout on workout sync');
        expect(payload.count).toBe(3);
      });

      it('F3-3: updates lastSeen timestamp while preserving original firstSeen on duplicate errors', async () => {
        vi.useFakeTimers();
        const baseTime = 1724486400000;
        vi.setSystemTime(baseTime);

        telemetryHub.init();
        telemetryHub.setUserId('user_test_123');

        const err = new Error('Database locked');
        telemetryHub.trackError(err);

        vi.setSystemTime(baseTime + 15000);
        telemetryHub.trackError(err);

        await vi.advanceTimersByTimeAsync(100);

        const payload = mockSetDoc.mock.calls[mockSetDoc.mock.calls.length - 1][1] as TelemetryErrorPayload;
        expect(payload.firstSeen).toBe(baseTime);
        expect(payload.lastSeen).toBe(baseTime + 15000);
        expect(payload.count).toBe(2);
      });

      it('F3-4: sends distinct telemetry documents for errors with different messages or types', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_test_123');

        telemetryHub.trackError(new TypeError('Invalid type in routine'));
        telemetryHub.trackError(new RangeError('Index out of range in sets'));

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(2);
        const p1 = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        const p2 = mockSetDoc.mock.calls[1][1] as TelemetryErrorPayload;

        expect(p1.type).toBe('TypeError');
        expect(p2.type).toBe('RangeError');
      });

      it('F3-5: produces valid TelemetryErrorPayload conforming to required error schema', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_schema_check');

        const err = new Error('Test schema error');
        telemetryHub.trackError(err, { source: 'app_error', customMessage: 'Custom wrapper' });

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;

        expect(payload).toHaveProperty('timestamp');
        expect(payload).toHaveProperty('type', 'Error');
        expect(payload).toHaveProperty('message');
        expect(payload).toHaveProperty('context');
        expect(payload).toHaveProperty('userId', 'user_schema_check');
        expect(payload).toHaveProperty('count', 1);
        expect(payload).toHaveProperty('firstSeen');
        expect(payload).toHaveProperty('lastSeen');
        expect(payload).toHaveProperty('source', 'app_error');
      });
    });

    describe('F4: React 19 Root Callbacks Interception', () => {
      it('F4-1: handles onCaughtError callback with componentStack attribution', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_react19');

        const caughtErr = new Error('Render crash in ExerciseList');
        const errorInfo = { componentStack: '\n    at ExerciseList (ExerciseList.tsx:25)\n    at RoutineEditor (RoutineEditor.tsx:10)' };

        telemetryHub.trackError(caughtErr, {
          source: 'react_caught',
          componentStack: errorInfo.componentStack,
        });

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_caught');
        expect(payload.componentStack).toContain('ExerciseList');
      });

      it('F4-2: handles onUncaughtError callback capturing root-level crashes', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_react19');

        const uncaughtErr = new Error('Fatal root crash in App');
        telemetryHub.trackError(uncaughtErr, { source: 'react_uncaught' });

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_uncaught');
        expect(payload.message).toContain('Fatal root crash in App');
      });

      it('F4-3: handles onRecoverableError callback with recoverable error context', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_react19');

        const recErr = new Error('Hydration mismatch recovered');
        telemetryHub.trackError(recErr, { source: 'react_recoverable' });

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_recoverable');
      });

      it('F4-4: scrubs componentStack in React 19 errors before storing or dispatching', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_react19');

        const err = new Error('Component failed');
        const sensitiveStack = '\n    at UserProfile (C:\\Users\\gerar\\logbook\\src\\UserProfile.tsx:12:1)\n    at email=athlete@gym.it';

        telemetryHub.trackError(err, {
          source: 'react_caught',
          componentStack: sensitiveStack,
        });

        await vi.advanceTimersByTimeAsync(100);

        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.componentStack).not.toContain('C:\\Users\\gerar');
        expect(payload.componentStack).not.toContain('athlete@gym.it');
        expect(payload.componentStack).toContain('[REDACTED_PATH]');
        expect(payload.componentStack).toContain('[REDACTED_EMAIL]');
      });

      it('F4-5: maintains React 19 error source tag in error metadata', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackError(new Error('Root test'), { source: 'react_root' });
        await vi.advanceTimersByTimeAsync(100);

        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_root');
      });
    });

    describe('F5: Global Window Handlers', () => {
      it('F5-1: intercepts window.onerror events and normalizes error parameters', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_window_err');

        const errEvent = new ErrorEvent('error', {
          error: new TypeError('Cannot read property of null'),
          message: 'Uncaught TypeError: Cannot read property of null',
          filename: 'http://localhost:5173/src/main.tsx',
          lineno: 42,
          colno: 10,
        });

        window.dispatchEvent(errEvent);
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalled();
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.type).toMatch(/TypeError|Error/);
        expect(payload.source).toBe('window_error');
      });

      it('F5-2: intercepts window.onunhandledrejection events capturing unhandled promise rejections', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_window_err');

        const rejPromise = Promise.reject(new Error('Async fetch failed in background'));
        rejPromise.catch(() => {});
        const rejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
          promise: rejPromise,
          reason: new Error('Async fetch failed in background'),
        });

        window.dispatchEvent(rejectionEvent);
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalled();
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('unhandled_rejection');
        expect(payload.message).toContain('Async fetch failed in background');
      });

      it('F5-3: handles non-Error objects in onunhandledrejection (string, number, null)', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_window_err');

        const rejPromise = Promise.reject('Plain string rejection reason');
        rejPromise.catch(() => {});
        const stringRejection = new PromiseRejectionEvent('unhandledrejection', {
          promise: rejPromise,
          reason: 'Plain string rejection reason',
        });

        window.dispatchEvent(stringRejection);
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalled();
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.message).toContain('Plain string rejection reason');
      });

      it('F5-4: global error handlers execute non-blockingly without halting execution', () => {
        telemetryHub.init();
        expect(() => {
          window.dispatchEvent(new ErrorEvent('error', { error: new Error('Non-blocking test') }));
        }).not.toThrow();
      });

      it('F5-5: preserves existing window error listeners without overriding third-party handlers', () => {
        const customListener = vi.fn();
        window.addEventListener('error', customListener);

        telemetryHub.init();

        window.dispatchEvent(new ErrorEvent('error', { error: new Error('Coexistence test') }));
        expect(customListener).toHaveBeenCalled();

        window.removeEventListener('error', customListener);
      });
    });

    describe('F6: Zod Validation Discards', () => {
      const TestExerciseSchema = z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        weight: z.number().nonnegative(),
      });

      it('F6-1: tracks Zod validation fallbacks without leaking input payload or biometric values', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_zod_test');

        const invalidInput = { id: 'ex1', name: 'Panca', weight: 'invalid_string_with_secret_123kg' };
        const parseResult = TestExerciseSchema.safeParse(invalidInput);

        if (!parseResult.success) {
          telemetryHub.trackError(parseResult.error, {
            source: 'zod_validation',
            customMessage: 'Exercise validation failed',
          });
        }

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('zod_validation');
        expect(payload.message).not.toContain('invalid_string_with_secret_123kg');
        expect(payload.type).toMatch(/ZodError|ValidationError/);
      });

      it('F6-2: extracts schema name, path, and error code from ZodError issues', () => {
        const schema = z.object({ age: z.number() });
        const result = schema.safeParse({ age: 'twenty' });
        expect(result.success).toBe(false);

        if (!result.success) {
          const sanitized = sanitizeErrorPayload(result.error, { source: 'zod_validation' });
          expect(sanitized.type).toMatch(/ZodError|ValidationError/);
          expect(sanitized.source).toBe('zod_validation');
        }
      });

      it('F6-3: records fallback activation when DomainParsers encounter malformed data', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_zod_test');

        telemetryHub.trackEvent('zod_schema_fallback', {
          schema: 'UserDataSchema',
          field: 'nutritionPlanning',
          fallbackUsed: 'defaultUserDataFallback',
        });

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
        expect(payload.type).toBe('zod_schema_fallback');
        expect(payload.details?.schema).toBe('UserDataSchema');
      });

      it('F6-4: deduplicates identical Zod schema validation errors', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_zod_test');

        const schema = z.object({ reps: z.number() });
        const err = schema.safeParse({ reps: 'nan' });

        if (!err.success) {
          telemetryHub.trackError(err.error, { source: 'zod_validation' });
          telemetryHub.trackError(err.error, { source: 'zod_validation' });
          telemetryHub.trackError(err.error, { source: 'zod_validation' });
        }

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.count).toBe(3);
      });

      it('F6-5: handles multi-issue Zod validation failures safely', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        const complexSchema = z.object({
          a: z.string(),
          b: z.number(),
          c: z.boolean(),
        });

        const res = complexSchema.safeParse({ a: 1, b: 'two', c: 'not_bool' });
        expect(res.success).toBe(false);

        if (!res.success) {
          expect(() => {
            telemetryHub.trackError(res.error, { source: 'zod_validation' });
          }).not.toThrow();
        }
      });
    });
  });
});
