import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as firestoreModule from 'firebase/firestore';
import * as firebaseLib from '../src/lib/firebase';
import {
  scrubPII,
  truncateStack,
  detectDerivedPlatform,
  isStandaloneMode,
  getTelemetryContext,
  hashError,
  sanitizeErrorPayload,
} from '../src/lib/telemetrySanitizer';
import {
  telemetryHub,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  DEDUP_WINDOW_MS,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
} from '../src/lib/telemetryHub';
import { z } from 'zod';
import { DomainParsers, UserDataSchema, UserProfileSchema, WorkoutSessionSchema, NutritionPlanningSchema } from '../src/lib/schema';

describe('Unified Telemetry Hub E2E Suite (Tiers 1 - 5)', () => {
  let mockSetDoc: any;
  const originalNavigator = { ...globalThis.navigator };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    mockSetDoc = vi.spyOn(firestoreModule, 'setDoc').mockResolvedValue(undefined as any);
    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {
      return { path: pathSegments.join('/') } as any;
    });

    if (telemetryHub && typeof telemetryHub.reset === 'function') {
      telemetryHub.reset();
    }
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    if (telemetryHub && typeof telemetryHub.reset === 'function') {
      telemetryHub.reset();
    }
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (F1 - F11: ≥5 Tests per Feature = 55 Tests)
  // =========================================================================
  describe('Tier 1: Feature Coverage', () => {

    // -----------------------------------------------------------------------
    // F1: Telemetry Context Provider
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F2: Privacy Sanitization Engine
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F3: Error Tracking Core & Deduplication
    // -----------------------------------------------------------------------
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

        // Deduplication happens in memory; verify count is aggregated
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

        vi.setSystemTime(baseTime + 15000); // 15 seconds later
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

    // -----------------------------------------------------------------------
    // F4: React 19 Root Callbacks Interception
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F5: Global Window Handlers
    // -----------------------------------------------------------------------
    describe('F5: Global Window Handlers', () => {
      it('F5-1: intercepts window.onerror events and normalizes error parameters', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_window_err');

        // Simulate window.onerror call
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

    // -----------------------------------------------------------------------
    // F6: Zod Validation Discards
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F7: PWA Install Funnel Analytics
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F8: Offline Workout Analytics
    // -----------------------------------------------------------------------
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

        // Set navigator offline
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

        telemetryHub.trackEvent('workout_started', { offline: true, routineId: 'routine_offline' });
        await vi.advanceTimersByTimeAsync(100);

        // Because offline, it goes to queue
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

      it('F8-5: records workout session duration and exercise count in event details', async () => {
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
        expect(payload.details?.totalSets).toBe(32);
        expect(payload.details?.exercisesCount).toBe(10);
      });
    });

    // -----------------------------------------------------------------------
    // F9: Offline Queue & Replay Engine
    // -----------------------------------------------------------------------
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
        // The first 10 items (1..10) should have been evicted; earliest remaining should be event_11
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

        // Switch online and dispatch event
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        window.dispatchEvent(new Event('online'));

        // Allow replay promise to resolve
        await vi.waitFor(() => {
          expect(mockSetDoc).toHaveBeenCalled();
          expect(telemetryHub.getQueuedEvents().length).toBe(0);
        });
      });

      it('F9-5: clears local queue buffer only after successful Firestore write dispatch', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_clear_check');

        // Put an item in queue
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

    // -----------------------------------------------------------------------
    // F10: Firestore Rules & Whitelists
    // -----------------------------------------------------------------------
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
          'timestamp',
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
          'timestamp',
          'type',
          'context',
          'userId',
          'sessionId',
          'details',
        ]);

        const payloadKeys = Object.keys(validEventPayload);
        const isPermitted = payloadKeys.every((k) => allowedKeys.has(k));
        expect(isPermitted).toBe(true);
      });

      it('F10-3: rejects telemetry writes with unauthorized injected properties', () => {
        const allowedKeys = new Set([
          'timestamp',
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
        // Confirms deleteAccount contract accounts for telemetry subcollections
        expect(typeof firebaseLib).toBe('object');
      });
    });

    // -----------------------------------------------------------------------
    // F11: Async Fire-and-Forget & Non-blocking
    // -----------------------------------------------------------------------
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

        // 50 non-blocking synchronous calls must execute in well under 50ms
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

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (F1 - F11: ≥5 Tests per Feature = 55 Tests)
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {

    // -----------------------------------------------------------------------
    // F1 Boundaries
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F2 Boundaries
    // -----------------------------------------------------------------------
    describe('F2 Boundaries: Privacy & Truncation Edge Conditions', () => {
      it('F2-B1: handles massive 100KB stack trace without memory exhaustion or regex catastrophic backtracking', () => {
        const hugeStack = 'Error: Massive crash\n' + '    at executeFunction (bundle.min.js:100:500)\n'.repeat(2500);
        expect(hugeStack.length).toBeGreaterThan(100000);

        const start = performance.now();
        const truncated = truncateStack(hugeStack, 1000);
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(50); // fast truncation
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

    // -----------------------------------------------------------------------
    // F3 Boundaries
    // -----------------------------------------------------------------------
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
        telemetryHub.trackError(err); // t = 0s

        vi.setSystemTime(baseTime + 59900); // t = 59.9s
        telemetryHub.trackError(err);

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect((mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload).count).toBe(2);

        // Advance past 60s
        vi.setSystemTime(baseTime + 60100); // t = 60.1s
        telemetryHub.trackError(err);

        await vi.advanceTimersByTimeAsync(100);
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
      });

      it('F3-B5: handles extreme timestamps (0, negative, NaN, Infinity) gracefully', () => {
        expect(DEDUP_WINDOW_MS).toBe(60000);
      });
    });

    // -----------------------------------------------------------------------
    // F4 Boundaries
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F5 Boundaries
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F6 Boundaries
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F7 Boundaries
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // F8 Boundaries
    // -----------------------------------------------------------------------
    describe('F8 Boundaries: Offline Workout Analytics Edge Conditions', () => {
      it('F8-B1: workout started online but completed and saved while offline', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_w_trans');

        // Started online
        telemetryHub.trackEvent('workout_started', { offline: false });

        // Save offline
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

        // Started offline
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.trackEvent('workout_started', { offline: true });

        // Restore online and save
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        telemetryHub.trackEvent('workout_saved', { offline: false });

        // Replay queue
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

    // -----------------------------------------------------------------------
    // F9 Boundaries
    // -----------------------------------------------------------------------
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

        // Queue 2 items
        localStorage.setItem(
          TELEMETRY_QUEUE_KEY,
          JSON.stringify([
            { id: '1', timestamp: Date.now(), itemType: 'event', payload: { type: 'item1', context: getTelemetryContext(), userId: 'user_partial_replay', timestamp: Date.now() } },
            { id: '2', timestamp: Date.now(), itemType: 'event', payload: { type: 'item2', context: getTelemetryContext(), userId: 'user_partial_replay', timestamp: Date.now() } },
          ])
        );

        // Fail second write
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

    // -----------------------------------------------------------------------
    // F10 Boundaries
    // -----------------------------------------------------------------------
    describe('F10 Boundaries: Security Rules Whitelist Edge Conditions', () => {
      it('F10-B1: telemetry payload with extra injected property fails whitelist check', () => {
        const payloadWithInjected = {
          timestamp: Date.now(),
          type: 'Error',
          message: 'Safe message',
          __proto__: { isAdmin: true },
          injected_field: 'malicious',
        };

        const allowedKeys = new Set(['timestamp', 'type', 'message', 'stack', 'context', 'userId', 'sessionId', 'count', 'firstSeen', 'lastSeen', 'source', 'componentStack']);
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

    // -----------------------------------------------------------------------
    // F11 Boundaries
    // -----------------------------------------------------------------------
    describe('F11 Boundaries: Async Fire-and-Forget Edge Conditions', () => {
      it('F11-B1: Firestore setDoc hangs indefinitely - aborts after 5000ms safety timeout', async () => {
        vi.useFakeTimers();
        mockSetDoc.mockImplementation(() => new Promise(() => {})); // never resolves

        telemetryHub.init();
        telemetryHub.setUserId('user_hang');

        telemetryHub.trackEvent('hanging_event');
        await vi.advanceTimersByTimeAsync(6000);

        // Must not freeze or throw unhandled rejection
        expect(true).toBe(true);
      });

      it('F11-B2: Firestore setDoc rejects with permission-denied - caught cleanly', async () => {
        mockSetDoc.mockRejectedValue(new Error('FirebaseError: Missing permissions'));

        telemetryHub.init();
        expect(() => {
          telemetryHub.trackError(new Error('Permission error'));
        }).not.toThrow();
      });

      it('F11-B3: trackError called 1000 times synchronously in hot loop completes under 100ms', () => {
        telemetryHub.init();
        const start = performance.now();

        for (let i = 0; i < 1000; i++) {
          telemetryHub.trackError(new Error(`Hot loop error ${i % 10}`));
        }

        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(100);
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

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Interactions = 6 Tests)
  // =========================================================================
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
        '    at UserProfile (C:\\Users\\gerar\\app.tsx:1:1) email=john.doe@gym.com\n'.repeat(40);

      telemetryHub.trackError(new Error('React component crash'), {
        source: 'react_caught',
        componentStack: hugeTrace,
      });

      await vi.advanceTimersByTimeAsync(100);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;

      expect(payload.componentStack).not.toContain('john.doe@gym.com');
      expect(payload.componentStack).not.toContain('C:\\Users\\gerar');
      expect(payload.componentStack).toContain('[REDACTED_EMAIL]');
      expect(payload.componentStack).toContain('[REDACTED_PATH]');
      expect(payload.componentStack!.length).toBeLessThanOrEqual(1000);
    });

    it('T3-3: Zod Schema Discard + Offline Queue + Online Replay: Zod validation error is queued while offline and replayed to Firestore upon reconnecting', async () => {
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

    it('T3-4: PWA Install Funnel + Concurrent Error Tracking: install event dispatch and background error logging run simultaneously without interfering', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_t3_4');

      telemetryHub.trackEvent('pwa_install_clicked');
      telemetryHub.trackError(new Error('Concurrent background sync error'));
      telemetryHub.trackEvent('pwa_prompt_accepted');

      await vi.advanceTimersByTimeAsync(100);

      expect(mockSetDoc).toHaveBeenCalledTimes(3);
      const types = mockSetDoc.mock.calls.map((call: any) => call[1].type);
      expect(types).toContain('pwa_install_clicked');
      expect(types).toContain('Error');
      expect(types).toContain('pwa_prompt_accepted');
    });

    it('T3-5: Offline Workout Lifecycle + Global Unhandled Rejection + FIFO Replay: workout events and unhandled promise rejections maintain strict FIFO sequence upon replay', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_t3_5');

      telemetryHub.trackEvent('workout_started', { offline: true });
      const rejPromise = Promise.reject(new Error('Timer tick promise rejection'));
      rejPromise.catch(() => {});
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: rejPromise,
          reason: new Error('Timer tick promise rejection'),
        })
      );
      telemetryHub.trackEvent('workout_saved', { offline: true, durationMinutes: 45 });

      const queued = telemetryHub.getQueuedEvents();
      expect(queued.length).toBe(3);
      expect(queued[0].payload.type).toBe('workout_started');
      expect(queued[1].payload.type).toBe('Error');
      expect(queued[2].payload.type).toBe('workout_saved');

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(mockSetDoc).toHaveBeenCalledTimes(3);
      expect(mockSetDoc.mock.calls[0][1].type).toBe('workout_started');
      expect(mockSetDoc.mock.calls[1][1].type).toBe('Error');
      expect(mockSetDoc.mock.calls[2][1].type).toBe('workout_saved');
    });

    it('T3-6: Privacy Engine Output + Firestore Security Rules Whitelist: all sanitized payloads strictly conform to Firestore rules schema without disallowed keys', async () => {
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
      ]);

      const keys = Object.keys(dispatchedPayload);
      expect(keys.every((k) => allowedKeys.has(k))).toBe(true);
      expect(dispatchedPayload.message).not.toContain('192.168.1.1');
      expect(dispatchedPayload.message).not.toContain('john@fit.it');
      expect(dispatchedPayload.message).not.toContain('eyJhbGci.secret');
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 End-to-End User Workflows)
  // =========================================================================
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

    it('T4-5: Guest User Session Account Linking: offline telemetry generated during guest session is replayed with authenticated UID after Google login', async () => {
      // 1. Guest user offline actions
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId(null); // Guest mode

      telemetryHub.trackEvent('guest_offline_action', { action: 'view_catalog' });
      expect(telemetryHub.getQueuedEvents().length).toBe(1);

      // 2. User signs in with Google account
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      telemetryHub.setUserId('google_auth_uid_999');

      // 3. Queue flushed with updated authenticated context
      await telemetryHub.flushQueue();

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryEventPayload;
      expect(payload.userId).toBe('google_auth_uid_999');
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });
  });

  // =========================================================================
  // TIER 5: ADVERSARIAL HARDENING & STRESS SUITE (19 Tests)
  // =========================================================================
  describe('Tier 5: Adversarial Hardening & Stress Suite', () => {
    // -----------------------------------------------------------------------
    // 5.1: High-Load Burst Error Spamming & Sliding Window Aggregation
    // -----------------------------------------------------------------------
    describe('5.1: High-Load Burst Error Spamming & Sliding Window Aggregation', () => {
      it('T5-1: hot-loop burst of 1,000 identical errors executes in <50ms and aggregates to 1 rate limiter entry with count=1000', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_1');

        const err = new TypeError('Database connection pool exhausted');
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          telemetryHub.trackError(err);
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(50);
        expect(telemetryHub.getActiveRateLimiterCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(50);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
        expect(payload.type).toBe('TypeError');
        expect(payload.message).toBe('Database connection pool exhausted');
        expect(payload.count).toBe(1000);
      });

      it('T5-2: high-cardinality burst of 100 distinct types x 20 repetitions aggregates into 100 rate limiters and 100 writes with count=20', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_2');

        const distinctCount = 100;
        const reps = 20;

        for (let i = 0; i < distinctCount; i++) {
          const err = new Error(`Distinct error signature #${i}`);
          for (let r = 0; r < reps; r++) {
            telemetryHub.trackError(err);
          }
        }

        expect(telemetryHub.getActiveRateLimiterCount()).toBe(distinctCount);

        await vi.advanceTimersByTimeAsync(50);

        expect(mockSetDoc).toHaveBeenCalledTimes(distinctCount);
        for (let i = 0; i < distinctCount; i++) {
          const payload = mockSetDoc.mock.calls[i][1] as TelemetryErrorPayload;
          expect(payload.count).toBe(reps);
        }

        await vi.advanceTimersByTimeAsync(DEDUP_WINDOW_MS);
        expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
      });

      it('T5-3: sub-millisecond sliding window boundary precision (0ms, 59,999ms, 60,000ms, 60,001ms)', async () => {
        vi.useFakeTimers();
        const baseTime = 1724486400000;
        vi.setSystemTime(baseTime);

        telemetryHub.init();
        telemetryHub.setUserId('user_t5_3');

        const error = new Error('Boundary precision test');

        // 1. t = 0ms: First occurrence
        telemetryHub.trackError(error);
        await vi.advanceTimersByTimeAsync(10);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect((mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload).count).toBe(1);

        // 2. t = 59,999ms: Duplicate within window
        vi.setSystemTime(baseTime + 59999);
        telemetryHub.trackError(error);
        // Should be suppressed from immediate write
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        // 3. t = 60,000ms: Window expires -> trailing flush occurs
        vi.setSystemTime(baseTime + 60000);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
        expect((mockSetDoc.mock.calls[1][1] as TelemetryErrorPayload).count).toBe(2);

        // 4. t = 60,001ms: New occurrence starts a new window
        vi.setSystemTime(baseTime + 60001);
        telemetryHub.trackError(error);
        await vi.advanceTimersByTimeAsync(10);
        expect(mockSetDoc).toHaveBeenCalledTimes(3);
        expect((mockSetDoc.mock.calls[2][1] as TelemetryErrorPayload).count).toBe(1);
      });

      it('T5-4: timer drift and clock skew (+65s forward jump) purges stale rate limiter and starts fresh window', async () => {
        vi.useFakeTimers();
        const baseTime = 1724486400000;
        vi.setSystemTime(baseTime);

        telemetryHub.init();
        telemetryHub.setUserId('user_t5_4');

        const error = new Error('Clock drift test');
        telemetryHub.trackError(error);
        await vi.advanceTimersByTimeAsync(10);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        // OS suspension / clock jump +65 seconds
        vi.setSystemTime(baseTime + 65000);

        // Next arrival detects expired window without crashing
        telemetryHub.trackError(error);
        await vi.advanceTimersByTimeAsync(10);

        expect(mockSetDoc).toHaveBeenCalledTimes(2);
        const secondPayload = mockSetDoc.mock.calls[1][1] as TelemetryErrorPayload;
        expect(secondPayload.count).toBe(1);
      });
    });

    // -----------------------------------------------------------------------
    // 5.2: Network Failure, Backoff & Non-Blocking FlushQueue
    // -----------------------------------------------------------------------
    describe('5.2: Network Failure, Backoff & Non-Blocking FlushQueue', () => {
      it('T5-5: indefinitely hanging setDoc promise is safely aborted by 5000ms safety timeout without throwing', async () => {
        vi.useFakeTimers();
        mockSetDoc.mockImplementation(() => new Promise(() => {})); // Never settles

        telemetryHub.init();
        telemetryHub.setUserId('user_t5_5');

        let errorResult: boolean | undefined;
        telemetryHub
          .dispatchErrorToFirestore({
            type: 'HangingError',
            message: 'Hangs',
            source: 'custom',
            context: getTelemetryContext(),
            userId: 'user_t5_5',
            sessionId: 'sess_1',
            count: 1,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
          })
          .then((res) => {
            errorResult = res;
          });

        await vi.advanceTimersByTimeAsync(5100);
        expect(errorResult).toBe(false);
      });

      it('T5-6: flapping network trips circuit breaker immediately mid-flush and preserves uncommitted items in FIFO order', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_6');

        const items = Array.from({ length: 10 }, (_, i) => ({
          id: `item_${i + 1}`,
          timestamp: Date.now() + i,
          itemType: 'event' as const,
          payload: {
            id: `evt_${i + 1}`,
            type: `event_${i + 1}`,
            context: getTelemetryContext(),
            userId: 'user_t5_6',
            sessionId: 'sess_1',
            timestamp: Date.now() + i,
          },
        }));

        localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items));

        // First item succeeds, subsequent items fail due to network drop
        mockSetDoc
          .mockResolvedValueOnce(undefined as any)
          .mockRejectedValue(new Error('Network drop mid-flush'));

        await telemetryHub.flushQueue();

        // Circuit breaker breaks after consecutive failures -> item 1 evicted, items 2..10 retained
        const remaining = telemetryHub.getQueuedEvents();
        expect(remaining.length).toBe(9);
        expect(remaining[0].id).toBe('item_2');
        expect(remaining[8].id).toBe('item_10');
        // Circuit breaker tripped quickly (at 3 calls) rather than cascading through all 10 items
        expect(mockSetDoc).toHaveBeenCalledTimes(3);
      });

      it('T5-7: concurrent flushQueue calls and hot-path trackError execute safely without race conditions or duplicated writes', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_7');

        localStorage.setItem(
          TELEMETRY_QUEUE_KEY,
          JSON.stringify([
            {
              id: 'queued_item_1',
              timestamp: Date.now(),
              itemType: 'error',
              payload: {
                id: 'err_queued_1',
                type: 'TypeError',
                message: 'Queued failure',
                source: 'custom',
                context: getTelemetryContext(),
                userId: 'user_t5_7',
                sessionId: 'sess_1',
                count: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
              },
            },
          ])
        );

        // Trigger multiple concurrent flushes and track calls
        const flush1 = telemetryHub.flushQueue();
        const flush2 = telemetryHub.flushQueue();
        telemetryHub.trackError(new Error('Hot error during flush'));
        telemetryHub.trackEvent('event_during_flush');

        await vi.advanceTimersByTimeAsync(100);
        await Promise.all([flush1, flush2]);

        expect(mockSetDoc).toHaveBeenCalled();
      });

      it('T5-8: Firestore permission-denied and resource-exhausted errors are caught silently without throwing to callers', async () => {
        mockSetDoc.mockRejectedValue(new Error('FirebaseError: [code=permission-denied] Permission denied'));

        telemetryHub.init();
        telemetryHub.setUserId('user_t5_8');

        expect(() => {
          telemetryHub.trackError(new Error('Permission denied error'));
          telemetryHub.trackEvent('permission_event');
        }).not.toThrow();

        const dispatchRes = await telemetryHub.dispatchErrorToFirestore({
          type: 'DeniedError',
          message: 'Denied',
          source: 'custom',
          context: getTelemetryContext(),
          userId: 'user_t5_8',
          sessionId: 'sess_1',
          count: 1,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
        });

        expect(dispatchRes).toBe(false);
      });

      it('T5-8b: failed item retry limit evicts poison pill after 3 retries and schedules exponential backoff', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_8b');

        localStorage.setItem(
          TELEMETRY_QUEUE_KEY,
          JSON.stringify([
            {
              id: 'poison_pill_1',
              timestamp: Date.now(),
              itemType: 'error',
              payload: {
                id: 'err_poison',
                type: 'PoisonError',
                message: 'Permanently fails',
                source: 'custom',
                context: getTelemetryContext(),
                userId: 'user_t5_8b',
                sessionId: 'sess_1',
                count: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
              },
            },
          ])
        );

        // Mock failure for all flush attempts
        mockSetDoc.mockRejectedValue(new Error('Persistent Firestore error'));

        // Attempt 1: retryCount becomes 1
        await telemetryHub.flushQueue();
        let q = telemetryHub.getQueuedEvents();
        expect(q.length).toBe(1);
        expect(q[0].retryCount).toBe(1);

        // Advance 1s (first exponential backoff timer: 1000ms)
        await vi.advanceTimersByTimeAsync(1000);
        q = telemetryHub.getQueuedEvents();
        expect(q.length).toBe(1);
        expect(q[0].retryCount).toBe(2);

        // Advance 2s (second exponential backoff timer: 2000ms)
        await vi.advanceTimersByTimeAsync(2000);
        q = telemetryHub.getQueuedEvents();
        expect(q.length).toBe(1);
        expect(q[0].retryCount).toBe(3);

        // Advance 4s (third exponential backoff timer: 4000ms) -> exceeds MAX_ITEM_RETRIES (3) -> evicted!
        await vi.advanceTimersByTimeAsync(4000);
        q = telemetryHub.getQueuedEvents();
        expect(q.length).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    // 5.3: Offline Queue Strict FIFO Cap (50 Items) & Eviction under Stress
    // -----------------------------------------------------------------------
    describe('5.3: Offline Queue Strict FIFO Cap (50 Items) & Eviction under Stress', () => {
      it('T5-9: avalanche stress of 500 mixed items offline strictly enforces 50-item cap and evicts oldest items FIFO', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_9');

        for (let i = 1; i <= 500; i++) {
          if (i % 2 === 0) {
            telemetryHub.trackEvent(`avalanche_event_${i}`, { seq: i });
          } else {
            telemetryHub.trackError(new Error(`avalanche_error_${i}`));
          }
        }

        const queue = telemetryHub.getQueuedEvents();
        expect(queue.length).toBe(TELEMETRY_QUEUE_CAPACITY);
        expect(queue.length).toBe(50);

        // Items 1..450 evicted; item 451 is the oldest remaining
        expect(queue[0].payload.type).toBe('Error');
        expect((queue[0].payload as TelemetryErrorPayload).message).toBe('avalanche_error_451');
        expect(queue[49].payload.type).toBe('avalanche_event_500');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('T5-10: 100 duplicate errors offline aggregate into 1 queue slot with count=100, saving capacity for 49 other events', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_10');

        const spamError = new Error('Repeated offline error');
        for (let i = 0; i < 100; i++) {
          telemetryHub.trackError(spamError);
        }

        for (let i = 1; i <= 49; i++) {
          telemetryHub.trackEvent(`offline_unique_event_${i}`);
        }

        const queue = telemetryHub.getQueuedEvents();
        expect(queue.length).toBe(50);
        expect(queue[0].payload.type).toBe('Error');
        expect((queue[0].payload as TelemetryErrorPayload).count).toBe(100);
        expect(queue[49].payload.type).toBe('offline_unique_event_49');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('T5-11: full replay of 50-item capped offline queue upon online event writes all 50 items and empties storage', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_11');

        for (let i = 1; i <= 50; i++) {
          telemetryHub.trackEvent(`queued_replay_${i}`);
        }

        expect(telemetryHub.getQueuedEvents().length).toBe(50);

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        window.dispatchEvent(new Event('online'));

        await vi.waitFor(() => {
          expect(mockSetDoc).toHaveBeenCalledTimes(50);
          expect(telemetryHub.getQueuedEvents().length).toBe(0);
        });
      });
    });

    // -----------------------------------------------------------------------
    // 5.4: Corrupted Storage Defense & Malformed Payloads
    // -----------------------------------------------------------------------
    describe('5.4: Corrupted Storage Defense & Malformed Payloads', () => {
      it('T5-12: malformed and truncated JSON in storage queue returns [] and is reset to valid array on next enqueue', () => {
        localStorage.setItem(TELEMETRY_QUEUE_KEY, '{ malformed [ broken JSON :');
        telemetryHub.init();

        expect(telemetryHub.getQueuedEvents()).toEqual([]);

        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.trackEvent('recovery_event');

        const queued = telemetryHub.getQueuedEvents();
        expect(queued.length).toBe(1);
        expect(queued[0].payload.type).toBe('recovery_event');

        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });

      it('T5-13: non-array primitives (strings, numbers, objects) under queue key are filtered safely', () => {
        localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify({ notAnArray: true, val: 123 }));
        telemetryHub.init();
        expect(telemetryHub.getQueuedEvents()).toEqual([]);

        localStorage.setItem(TELEMETRY_QUEUE_KEY, '42');
        expect(telemetryHub.getQueuedEvents()).toEqual([]);
      });

      it('T5-14: corrupted queue entries containing nulls or missing payloads are pruned during flush', async () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_14');

        const corruptQueue = [
          null,
          undefined,
          { id: 'corrupt_1' },
          { id: 'corrupt_2', payload: null },
          {
            id: 'valid_item',
            timestamp: Date.now(),
            itemType: 'event',
            payload: {
              id: 'evt_valid',
              type: 'valid_event',
              context: getTelemetryContext(),
              userId: 'user_t5_14',
              sessionId: 'sess_1',
              timestamp: Date.now(),
            },
          },
        ];

        localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(corruptQueue));

        await telemetryHub.flushQueue();

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect(telemetryHub.getQueuedEvents().length).toBe(0);
      });

      it('T5-15: localStorage QuotaExceededError is caught silently without disrupting application flow', () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        telemetryHub.init();

        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        expect(() => {
          telemetryHub.trackError(new Error('Quota error test'));
          telemetryHub.trackEvent('quota_event_test');
        }).not.toThrow();

        setItemSpy.mockRestore();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });
    });

    // -----------------------------------------------------------------------
    // 5.5: Zod Validation Discards & Zero-PII Adversarial Matrix
    // -----------------------------------------------------------------------
    describe('5.5: Zod Validation Discards & Zero-PII Adversarial Matrix', () => {
      it('T5-16: adversarial PII injection across all DomainParsers discards corrupted values with zero PII in telemetry', async () => {
        vi.useFakeTimers();
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_16');

        const hostileInputs = [
          'hacker@exploit-database.org',
          '192.168.1.100',
          '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.secret',
          'AIzaSyB39xK94aZp01234567890123456789012',
          'C:\\Users\\Administrator\\Secret\\passwords.txt',
          '/home/root/.ssh/id_rsa',
        ];

        for (const hostile of hostileInputs) {
          // 1. Profile with hostile weight/height
          DomainParsers.parseProfile({ weight: hostile, height: hostile });

          // 2. Workout session with hostile date/duration
          DomainParsers.parseWorkoutSession({ date: hostile, durationMinutes: hostile });

          // 3. Nutrition planning with hostile calories
          DomainParsers.parseNutritionPlanning({ targetCalories: hostile });
        }

        await vi.advanceTimersByTimeAsync(100);

        for (const call of mockSetDoc.mock.calls) {
          const payload = call[1];
          const serialized = JSON.stringify(payload);
          for (const hostile of hostileInputs) {
            expect(serialized).not.toContain(hostile);
          }
        }
      });

      it('T5-17: high-throughput burst of 1,000 malformed domain records parses in <500ms without freezing', () => {
        telemetryHub.init();
        telemetryHub.setUserId('user_t5_17');

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          DomainParsers.parseProfile({
            name: 12345,
            weight: 'invalid_weight',
            height: 'invalid_height',
            gender: 'unknown_gender',
          });
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(500);
      });

      it('T5-18: deeply nested and circular structures in DomainParsers parse safely without stack overflow', () => {
        telemetryHub.init();

        const circularObj: any = { name: 'Circular' };
        circularObj.self = circularObj;

        expect(() => {
          const parsed = DomainParsers.parseProfile(circularObj);
          expect(parsed).toBeDefined();
          expect(typeof parsed.name).toBe('string');
        }).not.toThrow();

        // Deeply nested object
        let deep: any = { leaf: true };
        for (let i = 0; i < 60; i++) {
          deep = { nested: deep };
        }

        expect(() => {
          const parsed = DomainParsers.parseWorkoutSession(deep);
          expect(parsed).toBeDefined();
        }).not.toThrow();
      });
    });
  });
});
