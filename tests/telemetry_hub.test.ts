import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import * as firebaseLib from '../src/lib/firebase';
import { z } from 'zod';
import {
  scrubPII,
  truncateStack,
  detectDerivedPlatform,
  isStandaloneMode,
  getTelemetryContext,
  computeErrorHash,
  hashError,
  sanitizeErrorPayload,
  APP_VERSION,
} from '../src/lib/telemetrySanitizer';
import {
  TelemetryHub,
  telemetryHub,
  RATE_LIMIT_WINDOW_MS,
  SESSION_ID_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';

describe('Telemetry Sanitizer & Telemetry Hub Unit & Integration Suite', () => {
  let mockSetDoc: any;

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

    telemetryHub.reset();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    telemetryHub.reset();
  });

  // =========================================================================
  // 1. PII Sanitizer & Privacy Engine
  // =========================================================================
  describe('1. PII Sanitizer & Privacy Engine', () => {
    it('redacts standard and complex email addresses', () => {
      const input = 'Error contacting user.name+tag@company.co.uk and athlete@gym.it';
      const output = scrubPII(input);
      expect(output).toBe('Error contacting [REDACTED_EMAIL] and [REDACTED_EMAIL]');
    });

    it('redacts IPv4 and IPv6 addresses without touching valid semantic version numbers', () => {
      const inputV4 = 'Connection refused from 192.168.1.105:8080 and 10.0.0.1 on app version 1.2.3';
      const outputV4 = scrubPII(inputV4);
      expect(outputV4).not.toContain('192.168.1.105');
      expect(outputV4).not.toContain('10.0.0.1');
      expect(outputV4).toContain('[REDACTED_IP]');
      expect(outputV4).toContain('1.2.3'); // Version number is preserved

      const inputV6 = 'Host 2001:0db8:85a3:0000:0000:8a2e:0370:7334 and ::1 failed';
      const outputV6 = scrubPII(inputV6);
      expect(outputV6).not.toContain('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
      expect(outputV6).toContain('[REDACTED_IP]');
    });

    it('redacts Bearer tokens, Firebase AIza API keys, and JWT tokens', () => {
      const bearer = 'Failed auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature123';
      const outputBearer = scrubPII(bearer);
      expect(outputBearer).toBe('Failed auth: Bearer [REDACTED_TOKEN]');

      const apiKey = 'Firebase request failed with key AIzaSyA1234567890abcdefghijklmnopqrstuv';
      const outputKey = scrubPII(apiKey);
      expect(outputKey).toBe('Firebase request failed with key [REDACTED_TOKEN]');

      const rawJwt = 'Token expired: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';
      const outputJwt = scrubPII(rawJwt);
      expect(outputJwt).toBe('Token expired: [REDACTED_TOKEN]');
    });

    it('redacts Windows and Unix local filesystem user paths', () => {
      const winBackslash = 'Crash at C:\\Users\\gerar\\Documents\\GitHub\\logbook\\src\\main.tsx:10:5';
      expect(scrubPII(winBackslash)).toBe('Crash at [REDACTED_PATH]:10:5');

      const winForward = 'Crash at C:/Users/gerar/Documents/GitHub/logbook/src/main.tsx:10:5';
      expect(scrubPII(winForward)).toBe('Crash at [REDACTED_PATH]:10:5');

      const unixHome = 'Crash at /home/developer/projects/logbook/src/store.ts:25:2';
      expect(scrubPII(unixHome)).toBe('Crash at [REDACTED_PATH]:25:2');

      const macUsers = 'Crash at /Users/john/projects/logbook/src/App.tsx:42:1';
      expect(scrubPII(macUsers)).toBe('Crash at [REDACTED_PATH]:42:1');
    });

    it('redacts sensitive query string parameters and JSON keys', () => {
      const queryStr = 'https://api.logbook.app/sync?token=secret123&apiKey=key456&auth=abc&routineId=r1';
      const scrubbedQuery = scrubPII(queryStr);
      expect(scrubbedQuery).toContain('token=[REDACTED]');
      expect(scrubbedQuery).toContain('apiKey=[REDACTED]');
      expect(scrubbedQuery).toContain('auth=[REDACTED]');
      expect(scrubbedQuery).toContain('routineId=r1'); // Safe param preserved

      const jsonStr = '{"password": "my_secret_pass", "refreshToken": "ref123", "name": "Squat"}';
      const scrubbedJson = scrubPII(jsonStr);
      expect(scrubbedJson).not.toContain('my_secret_pass');
      expect(scrubbedJson).not.toContain('ref123');
      expect(scrubbedJson).toContain('"name": "Squat"');
    });

    it('handles non-string, null, undefined, and empty string inputs safely', () => {
      expect(scrubPII('')).toBe('');
      expect(scrubPII(null as any)).toBe('');
      expect(scrubPII(undefined as any)).toBe('');
      expect(scrubPII(12345 as any)).toBe('12345');
    });
  });

  // =========================================================================
  // 2. Stack Truncation
  // =========================================================================
  describe('2. Stack Truncation', () => {
    it('returns undefined for undefined or null stack traces, and empty string for empty string', () => {
      expect(truncateStack(undefined)).toBeUndefined();
      expect(truncateStack(null as any)).toBeUndefined();
      expect(truncateStack('')).toBe('');
    });

    it('preserves stack trace under 1000 characters and scrubs PII inside it', () => {
      const stack = 'Error: workout failed\n    at C:\\Users\\gerar\\app.ts:12:1';
      const truncated = truncateStack(stack, 1000);
      expect(truncated).toBe('Error: workout failed\n    at [REDACTED_PATH]:12:1');
      expect(truncated!.length).toBeLessThanOrEqual(1000);
    });

    it('truncates stack trace exceeding maxLength cleanly and appends ellipsis marker', () => {
      const longStack = 'Error: massive recursion\n' + '    at computeRoutine (bundle.js:10:1)\n'.repeat(50);
      expect(longStack.length).toBeGreaterThan(1000);

      const truncated = truncateStack(longStack, 1000);
      expect(truncated).toBeDefined();
      expect(truncated!.length).toBeLessThanOrEqual(1000);
      expect(truncated).toContain('...[TRUNCATED]');
    });

    it('handles very small maxLength values correctly', () => {
      const stack = 'Error: short error';
      const truncated = truncateStack(stack, 10);
      expect(truncated!.length).toBeLessThanOrEqual(10);
    });
  });

  // =========================================================================
  // 3. Telemetry Context Provider & Platform Derivation
  // =========================================================================
  describe('3. Telemetry Context Provider & Platform Derivation', () => {
    it('provides standard appVersion, displayMode, platform, and online state', () => {
      const ctx = getTelemetryContext();
      expect(ctx.appVersion).toBe(APP_VERSION);
      expect(['ios', 'ipados', 'other']).toContain(ctx.platform);
      expect(['standalone', 'browser']).toContain(ctx.displayMode);
      expect(typeof ctx.online).toBe('boolean');
    });

    it('correctly derives iOS platform for iPhone and iPod user agents', () => {
      const iphoneNav = {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
      } as Navigator;
      expect(detectDerivedPlatform(iphoneNav)).toBe('ios');

      const ipodNav = {
        userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)',
        platform: 'iPod touch',
        maxTouchPoints: 5,
      } as Navigator;
      expect(detectDerivedPlatform(ipodNav)).toBe('ios');
    });

    it('correctly derives iPadOS platform for iPad UA or MacIntel with touch points', () => {
      const ipadNav = {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
        platform: 'iPad',
        maxTouchPoints: 5,
      } as Navigator;
      expect(detectDerivedPlatform(ipadNav)).toBe('ipados');

      const macTouchNav = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      } as Navigator;
      expect(detectDerivedPlatform(macTouchNav)).toBe('ipados');
    });

    it('derives "other" for desktop browsers or missing/invalid navigators', () => {
      const desktopNav = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        maxTouchPoints: 0,
      } as Navigator;
      expect(detectDerivedPlatform(desktopNav)).toBe('other');

      expect(detectDerivedPlatform(undefined)).toBe('other');
    });

    it('detects standalone display mode via navigator.standalone or matchMedia', () => {
      const iosStandaloneWin = {
        navigator: { standalone: true },
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      } as unknown as Window;
      expect(isStandaloneMode(iosStandaloneWin)).toBe(true);

      const mediaStandaloneWin = {
        navigator: { standalone: false },
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      } as unknown as Window;
      expect(isStandaloneMode(mediaStandaloneWin)).toBe(true);

      const browserWin = {
        navigator: { standalone: false },
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      } as unknown as Window;
      expect(isStandaloneMode(browserWin)).toBe(false);
    });

    it('handles matchMedia throwing security errors gracefully', () => {
      const restrictedWin = {
        navigator: { standalone: false },
        matchMedia: vi.fn().mockImplementation(() => {
          throw new Error('SecurityError');
        }),
      } as unknown as Window;
      expect(isStandaloneMode(restrictedWin)).toBe(false);
    });
  });

  // =========================================================================
  // 4. 32-Bit FNV-1a Error Hashing
  // =========================================================================
  describe('4. 32-Bit FNV-1a Error Hashing', () => {
    it('produces deterministic 8-character hexadecimal hashes', () => {
      const hash1 = computeErrorHash('TypeError', 'Cannot read properties of null');
      const hash2 = computeErrorHash('TypeError', 'Cannot read properties of null');
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{8}$/);
      expect(hashError('TypeError', 'Cannot read properties of null')).toBe(hash1);
    });

    it('produces distinct hashes for different error types or messages', () => {
      const h1 = computeErrorHash('TypeError', 'Failed to fetch');
      const h2 = computeErrorHash('ReferenceError', 'Failed to fetch');
      const h3 = computeErrorHash('TypeError', 'Network timeout');

      expect(h1).not.toBe(h2);
      expect(h1).not.toBe(h3);
      expect(h2).not.toBe(h3);
    });

    it('handles empty or unusual type and message strings safely', () => {
      expect(computeErrorHash('', '')).toMatch(/^[0-9a-f]{8}$/);
      expect(computeErrorHash(null as any, undefined as any)).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  // =========================================================================
  // 5. Error Payload Sanitization
  // =========================================================================
  describe('5. Error Payload Sanitization', () => {
    it('sanitizes standard Error instance with stack', () => {
      const err = new Error('Database connection failed');
      const sanitized = sanitizeErrorPayload(err, { source: 'app_error' });

      expect(sanitized.type).toBe('Error');
      expect(sanitized.message).toBe('Database connection failed');
      expect(sanitized.source).toBe('app_error');
      expect(sanitized.stack).toBeDefined();
    });

    it('sanitizes ZodError without exposing sensitive field data', () => {
      const schema = z.object({
        email: z.string().email(),
        weightKg: z.number().positive(),
      });
      const parseRes = schema.safeParse({ email: 'bad-email', weightKg: -5 });
      expect(parseRes.success).toBe(false);

      if (!parseRes.success) {
        const sanitized = sanitizeErrorPayload(parseRes.error, { source: 'zod_validation' });
        expect(sanitized.type).toBe('ZodError');
        expect(sanitized.source).toBe('zod_validation');
        expect(sanitized.message).toContain('email');
        expect(sanitized.message).toContain('weightKg');
      }
    });

    it('handles circular objects, numbers, and null values without throwing', () => {
      const circular: any = { note: 'test circular' };
      circular.self = circular;

      expect(() => sanitizeErrorPayload(circular)).not.toThrow();
      expect(sanitizeErrorPayload(circular).message).toContain('test circular');

      const numRes = sanitizeErrorPayload(500);
      expect(numRes.message).toBe('500');

      const nullRes = sanitizeErrorPayload(null);
      expect(nullRes.message).toBe('null');
    });
  });

  // =========================================================================
  // 6. 60-Second Sliding Window Deduplication & Aggregation
  // =========================================================================
  describe('6. 60-Second Sliding Window Deduplication & Aggregation', () => {
    it('dispatches the first occurrence immediately and aggregates consecutive identical errors', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_dedup_test');

      const err = new TypeError('Failed to load exercise list');
      telemetryHub.trackError(err);
      telemetryHub.trackError(err);
      telemetryHub.trackError(err);

      // Microtask execution
      await vi.advanceTimersByTimeAsync(100);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.type).toBe('TypeError');
      expect(payload.message).toBe('Failed to load exercise list');
      expect(payload.count).toBe(3);
    });

    it('updates lastSeen timestamp while maintaining original firstSeen on duplicates', async () => {
      vi.useFakeTimers();
      const baseTime = 1724486400000;
      vi.setSystemTime(baseTime);

      telemetryHub.init();
      telemetryHub.setUserId('user_seen_test');

      const err = new Error('Lock acquisition timeout');
      telemetryHub.trackError(err); // t = 0

      vi.setSystemTime(baseTime + 20000); // t = 20s
      telemetryHub.trackError(err);

      await vi.advanceTimersByTimeAsync(100);

      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.firstSeen).toBe(baseTime);
      expect(payload.lastSeen).toBe(baseTime + 20000);
      expect(payload.count).toBe(2);
    });

    it('dispatches trailing aggregation update when additional errors occur after initial dispatch and window expires', async () => {
      vi.useFakeTimers();
      const baseTime = 1724486400000;
      vi.setSystemTime(baseTime);

      telemetryHub.init();
      telemetryHub.setUserId('user_trailing_test');

      const err = new Error('Intermittent network error');
      telemetryHub.trackError(err); // Initial dispatch

      await vi.advanceTimersByTimeAsync(100);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      // Subsequent errors occur at t = 10s
      vi.setSystemTime(baseTime + 10000);
      telemetryHub.trackError(err);
      telemetryHub.trackError(err);

      // No new immediate dispatch
      await vi.advanceTimersByTimeAsync(100);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      // Advance past the 60s window
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_WINDOW_MS);
      expect(mockSetDoc).toHaveBeenCalledTimes(2);

      const secondPayload = mockSetDoc.mock.calls[1][1] as TelemetryErrorPayload;
      expect(secondPayload.count).toBe(3);
    });

    it('starts a new rate limiting window when an error arrives after 60s', async () => {
      vi.useFakeTimers();
      const baseTime = 1724486400000;
      vi.setSystemTime(baseTime);

      telemetryHub.init();
      telemetryHub.setUserId('user_window_reset');

      const err = new Error('Cache miss error');
      telemetryHub.trackError(err);
      await vi.advanceTimersByTimeAsync(100);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      // Advance by 65 seconds
      vi.setSystemTime(baseTime + 65000);
      await vi.advanceTimersByTimeAsync(65000);

      // New occurrence starts new window
      telemetryHub.trackError(err);
      await vi.advanceTimersByTimeAsync(100);
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
    });

    it('allows manual flushing of rate limiters via flushRateLimiters', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_flush_test');

      const err = new Error('Flushable error');
      telemetryHub.trackError(err);
      await vi.advanceTimersByTimeAsync(100);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      telemetryHub.trackError(err);
      telemetryHub.trackError(err);

      await telemetryHub.flushRateLimiters();
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
    });

    it('clears active rate limiters and cancels timers on clearRateLimiters', () => {
      vi.useFakeTimers();
      telemetryHub.init();

      telemetryHub.trackError(new Error('Clear test'));
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(1);

      telemetryHub.clearRateLimiters();
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
    });
  });

  // =========================================================================
  // 7. Non-Blocking Firestore Dispatch & Timeout Resilience
  // =========================================================================
  describe('7. Non-Blocking Firestore Dispatch & Timeout Resilience', () => {
    it('returns false and does not attempt Firestore write when userId is null (guest mode)', async () => {
      localStorage.setItem('logbook_is_guest', 'true');
      telemetryHub.init();
      telemetryHub.setUserId(null);

      const payload: TelemetryErrorPayload = {
        type: 'Error',
        message: 'Guest error',
        source: 'custom',
        context: getTelemetryContext(),
        userId: null,
        sessionId: 'sess_1',
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      };

      const result = await telemetryHub.dispatchErrorToFirestore(payload);
      expect(result).toBe(false);
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('handles Firestore network timeouts gracefully within 5000ms timeout', async () => {
      mockSetDoc.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 6000))
      );

      telemetryHub.init();
      telemetryHub.setUserId('user_timeout_check');

      const payload: TelemetryErrorPayload = {
        type: 'Error',
        message: 'Timeout test',
        source: 'custom',
        context: getTelemetryContext(),
        userId: 'user_timeout_check',
        sessionId: 'sess_1',
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      };

      const result = await telemetryHub.dispatchErrorToFirestore(payload);
      expect(result).toBe(false);
    });

    it('suppresses Firestore permission-denied errors without throwing to UI', async () => {
      mockSetDoc.mockRejectedValue(new Error('FirebaseError: [code=permission-denied]'));

      telemetryHub.init();
      telemetryHub.setUserId('user_perm');

      expect(() => {
        telemetryHub.trackError(new Error('Perm test'));
        telemetryHub.trackEvent('custom_event');
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 8. Global Window Event Interception
  // =========================================================================
  describe('8. Global Window Event Interception', () => {
    it('intercepts window.onerror and triggers trackError with window_error source', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_win_err');

      const errEvent = new ErrorEvent('error', {
        error: new TypeError('Cannot access null reference'),
        message: 'Uncaught TypeError: Cannot access null reference',
      });

      window.dispatchEvent(errEvent);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.source).toBe('window_error');
      expect(payload.type).toBe('TypeError');
    });

    it('intercepts window.onunhandledrejection with Error or string reasons', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_rej');

      const rejectedPromise = Promise.reject('Rejected string reason');
      rejectedPromise.catch(() => {}); // Prevent unhandled rejection in test runner process

      const rejection = new PromiseRejectionEvent('unhandledrejection', {
        promise: rejectedPromise,
        reason: 'Rejected string reason',
      });

      window.dispatchEvent(rejection);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.source).toBe('unhandled_rejection');
      expect(payload.message).toContain('Rejected string reason');
    });

    it('cleans up window event listeners upon destroy/reset', () => {
      telemetryHub.init();
      telemetryHub.destroy();

      window.dispatchEvent(new ErrorEvent('error', { message: 'Post destroy message' }));
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(0);
    });
  });

  // =========================================================================
  // 9. Session ID Generation & Persistence
  // =========================================================================
  describe('9. Session ID Generation & Persistence', () => {
    it('generates session ID with sess_ prefix and persists it in sessionStorage', () => {
      const sessionId = telemetryHub.getSessionId();
      expect(sessionId).toMatch(/^sess_\d+_[a-z0-9]+$/);
      expect(sessionStorage.getItem(SESSION_ID_KEY)).toBe(sessionId);
    });

    it('returns existing session ID on subsequent calls within the same tab', () => {
      sessionStorage.setItem(SESSION_ID_KEY, 'sess_existing_12345');
      const hub = TelemetryHub.getInstance();
      hub.destroy(); // Reset in-memory cache to force reading from sessionStorage

      expect(hub.getSessionId()).toBe('sess_existing_12345');
    });
  });

  // =========================================================================
  // 10. Offline Queue & Replay
  // =========================================================================
  describe('10. Offline Queue & Replay', () => {
    it('enqueues errors and events into localStorage when offline', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_offline_test');

      telemetryHub.trackError(new Error('Offline error'));
      telemetryHub.trackEvent('workout_started', { offline: true });

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(2);
      expect(queue[0].itemType).toBe('error');
      expect(queue[1].itemType).toBe('event');

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('enforces FIFO eviction at TELEMETRY_QUEUE_CAPACITY (50 items)', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      for (let i = 1; i <= 60; i++) {
        telemetryHub.trackEvent(`event_${i}`);
      }

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(TELEMETRY_QUEUE_CAPACITY);
      expect(queue[0].payload.type).toBe('event_11');
      expect(queue[queue.length - 1].payload.type).toBe('event_60');

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('flushes offline queue on window online event', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_replay_test');

      telemetryHub.trackEvent('offline_item_1');
      expect(telemetryHub.getQueuedEvents().length).toBe(1);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));

      await vi.waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalled();
        expect(telemetryHub.getQueuedEvents().length).toBe(0);
      });
    });
  });
});
