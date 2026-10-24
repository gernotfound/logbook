import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { DomainParsers, reportZodSchemaFallback } from '../../src/lib/schema';
import {
  scrubPII,
  truncateStack,
  detectDerivedPlatform,
  isStandaloneMode,
  getTelemetryContext,
  hashError,
} from '../../src/lib/telemetrySanitizer';
import {
  telemetryHub,
  type TelemetryErrorPayload,
} from '../../src/lib/telemetryHub';
import {
  installTelemetryTestHarness,
  mockSentryTransport,
  originalNavigator,
} from './telemetryTestHarness';

describe('TelemetryHub Vitest Integration Suite — Tier 1 Core', () => {
  installTelemetryTestHarness();

  describe('Tier 1: Feature Coverage — Core Telemetry', () => {
    describe('F1: Telemetry Context Provider', () => {

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

      it('F1-5: reflects navigator.onLine status in context snapshot', () => {
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
        const rawWin = 'Error at C:\\Users\\example-user\\Projects\\logbook\\src\\store.ts:42:15';
        const scrubbedWin = scrubPII(rawWin);
        expect(scrubbedWin).not.toContain('C:\\Users\\example-user\\Projects');
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

      it('F3-2: aggregates consecutive errors into one Sentry dispatch with count=3', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_test_123');

        const err = new Error('Network timeout on workout sync');
        telemetryHub.trackError(err);
        telemetryHub.trackError(err);
        telemetryHub.trackError(err);

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
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

        const payload = mockSentryTransport.mock.calls[mockSentryTransport.mock.calls.length - 1][1] as TelemetryErrorPayload;
        expect(payload.firstSeen).toBe(baseTime);
        expect(payload.lastSeen).toBe(baseTime + 15000);
        expect(payload.count).toBe(2);
      });

      it('F3-4: dispatches distinct technical error payloads for different error types', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_test_123');

        telemetryHub.trackError(new TypeError('Invalid type in routine'));
        telemetryHub.trackError(new RangeError('Index out of range in sets'));

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(2);
        const p1 = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        const p2 = mockSentryTransport.mock.calls[1][1] as TelemetryErrorPayload;

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

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;

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

    it('Zod fallbacks emit only one technical error and never generate discarded events', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('zod-error-only');
      const eventSpy = vi.spyOn(telemetryHub, 'trackEvent');
      reportZodSchemaFallback({ schema: 'TechnicalSchema', field: 'value', issueCode: 'invalid_type' });
      await vi.advanceTimersByTimeAsync(100);
      expect(eventSpy).not.toHaveBeenCalled();
      expect(mockSentryTransport.mock.calls.map((call: any) => call[0])).toEqual(['error']);
      expect((mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload).source)
        .toBe('zod_schema_fallback');
    });

    describe('F4: React 19 diagnostic metadata (Hub boundary, not root mounting)', () => {
      it('F4-1: accepts simulated react_caught source with componentStack attribution', async () => {
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

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_caught');
        expect(payload.componentStack).toContain('ExerciseList');
      });

      it('F4-2: accepts simulated react_uncaught source', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_react19');

        const uncaughtErr = new Error('Fatal root crash in App');
        telemetryHub.trackError(uncaughtErr, { source: 'react_uncaught' });

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_uncaught');
        expect(payload.message).toContain('Fatal root crash in App');
      });

      it('F4-3: accepts simulated react_recoverable source', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_react19');

        const recErr = new Error('Hydration mismatch recovered');
        telemetryHub.trackError(recErr, { source: 'react_recoverable' });

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('react_recoverable');
      });

      it('F4-4: scrubs componentStack in React 19 errors before storing or dispatching', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_react19');

        const err = new Error('Component failed');
        const sensitiveStack = '\n    at UserProfile (C:\\Users\\example-user\\logbook\\src\\UserProfile.tsx:12:1)\n    at email=athlete@gym.it';

        telemetryHub.trackError(err, {
          source: 'react_caught',
          componentStack: sensitiveStack,
        });

        await vi.advanceTimersByTimeAsync(100);

        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.componentStack).not.toContain('C:\\Users\\example-user');
        expect(payload.componentStack).not.toContain('athlete@gym.it');
        expect(payload.componentStack).toContain('[REDACTED_PATH]');
        expect(payload.componentStack).toContain('[REDACTED_EMAIL]');
      });

      it('F4-5: maintains React 19 error source tag in error metadata', async () => {
        vi.useFakeTimers();
        telemetryHub.init();

        telemetryHub.trackError(new Error('Root test'), { source: 'react_root' });
        await vi.advanceTimersByTimeAsync(100);

        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
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

        expect(mockSentryTransport).toHaveBeenCalled();
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
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

        expect(mockSentryTransport).toHaveBeenCalled();
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
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

        expect(mockSentryTransport).toHaveBeenCalled();
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
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

        expect(parseResult.success).toBe(false);
        if (!parseResult.success) {
          telemetryHub.trackError(parseResult.error, {
            source: 'zod_validation',
            customMessage: 'Exercise validation failed',
          });
        }

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.source).toBe('zod_validation');
        expect(payload.message).not.toContain('invalid_string_with_secret_123kg');
        expect(payload.type).toMatch(/ZodError|ValidationError/);
      });

      it('F6-2: production fallback reporter extracts a Zod issue path and code without raw input', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_zod_test');

        const schema = z.object({ age: z.number() });
        const result = schema.safeParse({ age: 'private-value' });
        expect(result.success).toBe(false);
        if (result.success) throw new Error('Expected invalid Zod input');

        reportZodSchemaFallback({
          schema: 'UserProfileSchema',
          fallbackUsed: 'default_empty_profile',
          error: result.error,
        });
        await vi.advanceTimersByTimeAsync(100);

        const errorCalls = mockSentryTransport.mock.calls.filter((call: any) =>
          call[0] === 'error' && call[1].source === 'zod_schema_fallback'
        );
        expect(mockSentryTransport.mock.calls).toHaveLength(1);
        expect(errorCalls).toHaveLength(1);
        expect(errorCalls[0][1].message).toContain('UserProfileSchema [age]: invalid_type');
        expect(errorCalls[0][1].message).toContain('expected number');
        expect(mockSentryTransport.mock.calls.some((call: any) => call[0] === 'event')).toBe(false);
        expect(JSON.stringify(mockSentryTransport.mock.calls)).not.toContain('private-value');
      });

      it('F6-3: actual DomainParsers fallback emits only a technical error', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_zod_test');

        const parsed = DomainParsers.parseProfile('invalid_profile_root');
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe('object');
        await vi.advanceTimersByTimeAsync(100);

        const errorCalls = mockSentryTransport.mock.calls.filter((call: any) =>
          call[0] === 'error' && call[1].source === 'zod_schema_fallback'
        );
        expect(mockSentryTransport.mock.calls).toHaveLength(1);
        expect(errorCalls).toHaveLength(1);
        expect(errorCalls[0][1].type).toBe('ZodSchemaFallbackError');
        expect(errorCalls[0][1].message).toContain('UserProfileSchema');
        expect(mockSentryTransport.mock.calls.some((call: any) => call[0] === 'event')).toBe(false);
        expect(JSON.stringify(mockSentryTransport.mock.calls)).not.toContain('invalid_profile_root');
      });

      it('F6-4: deduplicates identical Zod schema validation errors', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_zod_test');

        const schema = z.object({ reps: z.number() });
        const err = schema.safeParse({ reps: 'nan' });

        expect(err.success).toBe(false);
        if (!err.success) {
          telemetryHub.trackError(err.error, { source: 'zod_validation' });
          telemetryHub.trackError(err.error, { source: 'zod_validation' });
          telemetryHub.trackError(err.error, { source: 'zod_validation' });
        }

        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.count).toBe(3);
      });

      it('F6-5: multi-issue Zod failures dispatch a sanitized technical report', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_multi_zod');

        const schema = z.object({ a: z.string(), b: z.number(), c: z.boolean() });
        const result = schema.safeParse({ a: 1, b: 'two', c: 'not_bool' });
        expect(result.success).toBe(false);
        if (result.success) throw new Error('Expected invalid Zod input');
        expect(result.error.issues).toHaveLength(3);

        telemetryHub.trackError(result.error, { source: 'zod_validation' });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
        const payload = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.type).toBe('ZodError');
        expect(payload.source).toBe('zod_validation');
        expect(payload.userId).toBe('user_multi_zod');
        // Zod 4 exposes the issue paths in its Error.message JSON.
        for (const field of ['a', 'b', 'c']) {
          expect(payload.message).toContain(`"${field}"`);
        }
        expect(payload.message).not.toContain('not_bool');
      });
    });
  });
});
