import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import {
  scrubPII,
  truncateStack,
  detectDerivedPlatform,
  isStandaloneMode,
  getTelemetryContext,
  computeErrorHash,
  hashError,
  sanitizeErrorPayload,
} from '../src/lib/telemetrySanitizer';
import {
  telemetryHub,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';

describe('Challenger 1: Empirical Adversarial Stress & Benchmark Suite', () => {
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
  // REQUIREMENT 1: RATE LIMITING & HOT LOOP COLLAPSE BENCHMARK
  // =========================================================================
  describe('Requirement 1: Rate Limiting & Hot Loop Performance', () => {
    it('1.1: 1,000 rapid identical errors in hot loop executes in <50ms and collapses into 1 entry with count=1000', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_rate_limit_1000');

      const identicalError = new TypeError('Database connection pool exhausted');

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        telemetryHub.trackError(identicalError);
      }
      const elapsed = performance.now() - start;

      // Assert that 1,000 identical calls execute efficiently (< 50ms)
      expect(elapsed).toBeLessThan(50);

      // Verify active rate limiters count
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(1);

      // Advance microtasks to allow initial dispatch
      await vi.advanceTimersByTimeAsync(50);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.type).toBe('TypeError');
      expect(payload.message).toBe('Database connection pool exhausted');
      expect(payload.count).toBe(1000);
    });

    it('1.2: 1,000 rapid identical string errors in offline mode collapses into 1 queued item with count=1000', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_offline_rate_limit');

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        telemetryHub.trackError('Offline rapid failure');
      }
      const elapsed = performance.now() - start;

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      expect((queue[0].payload as TelemetryErrorPayload).count).toBe(1000);
      expect((queue[0].payload as TelemetryErrorPayload).message).toBe('Offline rapid failure');
      expect(elapsed).toBeLessThan(100);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('1.3: Empirical analysis of 1,000 calls across 10 error variants (F11-B3 benchmark completes in <50ms)', () => {
      telemetryHub.init();
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        telemetryHub.trackError(new Error(`Hot loop error ${i % 10}`));
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(10);
    });

    it('1.4: 1,000 distinct string error messages in hot loop completes in <50ms', () => {
      telemetryHub.init();
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        telemetryHub.trackError(`Distinct unique error payload ${i}`);
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(1000);
    });
  });

  // =========================================================================
  // REQUIREMENT 2: PRIVACY SANITIZER WITH COMPLEX ADVERSARIAL PAYLOADS
  // =========================================================================
  describe('Requirement 2: Privacy Sanitizer Adversarial Payloads', () => {
    it('2.1: Nested objects with sensitive data, tokens, and PII are sanitized safely', () => {
      const nestedPayload = {
        name: 'NestedError',
        message: 'Top-level failure',
        meta: {
          user: {
            email: 'admin.super+tag@secret-corp.com',
            ip: '192.168.1.150',
          },
          auth: {
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123',
            apiKey: 'AIzaSyA1234567890abcdefghijklmnopqrstuv',
            bearer: 'Bearer secret_access_token_12345',
          },
          paths: {
            win: 'C:\\Users\\gerar\\secret_project\\app.ts:10:1',
            unix: '/home/developer/secret_project/app.ts:10:1',
          },
        },
      };

      const sanitized = sanitizeErrorPayload(nestedPayload);
      expect(sanitized.type).toBe('NestedError');
      expect(sanitized.message).toBe('Top-level failure');

      // Test scrubbing the full serialized nested payload
      const serialized = JSON.stringify(nestedPayload);
      const scrubbed = scrubPII(serialized);

      expect(scrubbed).not.toContain('admin.super+tag@secret-corp.com');
      expect(scrubbed).not.toContain('192.168.1.150');
      expect(scrubbed).not.toContain('eyJhbGci');
      expect(scrubbed).not.toContain('AIzaSyA');
      expect(scrubbed).not.toContain('secret_access_token_12345');
      expect(scrubbed).not.toContain('C:\\Users\\gerar');
      expect(scrubbed).not.toContain('/home/developer');

      expect(scrubbed).toContain('[REDACTED_EMAIL]');
      expect(scrubbed).toContain('[REDACTED_IP]');
      expect(scrubbed).toContain('[REDACTED_TOKEN]');
      expect(scrubbed).toContain('[REDACTED_PATH]');
    });

    it('2.2: Circular references (self-referencing, mutual, array) do not cause crash or infinite recursion', () => {
      // Direct circular
      const directCircular: any = { message: 'Direct circular test' };
      directCircular.self = directCircular;

      expect(() => sanitizeErrorPayload(directCircular)).not.toThrow();
      const resDirect = sanitizeErrorPayload(directCircular);
      expect(resDirect.message).toBe('Direct circular test');

      // Mutual circular (a <-> b)
      const a: any = { name: 'NodeA' };
      const b: any = { name: 'NodeB' };
      a.b = b;
      b.a = a;

      expect(() => sanitizeErrorPayload(a)).not.toThrow();
      const resMutual = sanitizeErrorPayload(a);
      expect(resMutual.type).toBe('NodeA');

      // Array circular
      const arr: any[] = ['item1'];
      arr.push(arr);
      expect(() => sanitizeErrorPayload(arr)).not.toThrow();

      // Deeply nested circular object without explicit message property
      const deepCircular: any = { level1: { level2: { level3: {} } } };
      deepCircular.level1.level2.level3.root = deepCircular;
      expect(() => sanitizeErrorPayload(deepCircular)).not.toThrow();
      const resDeep = sanitizeErrorPayload(deepCircular);
      expect(resDeep.message).toContain('[Circular]');
    });

    it('2.3: Query strings with sensitive tokens and keys in various formats are redacted', () => {
      const urls = [
        'https://api.logbook.app/v1/sync?token=secretToken123&apiKey=AIzaSyA1234567890abcdefghijklmnopqrstuv',
        'https://auth.logbook.app/callback?code=oauth_auth_code_9999&accessToken=at_55555&refreshToken=rt_77777',
        'https://app.logbook.app/api?password=superSecretPassword!&auth=bearer123&routineId=leg_day_1',
        '?secret=my_secret_key&apiKey=key_12345',
      ];

      for (const u of urls) {
        const scrubbed = scrubPII(u);
        expect(scrubbed).not.toContain('secretToken123');
        expect(scrubbed).not.toContain('oauth_auth_code_9999');
        expect(scrubbed).not.toContain('at_55555');
        expect(scrubbed).not.toContain('rt_77777');
        expect(scrubbed).not.toContain('superSecretPassword!');
        expect(scrubbed).not.toContain('AIzaSyA');
        expect(scrubbed).toContain('[REDACTED]');
      }
    });

    it('2.4: Empirically tests IPv4 and IPv6 redaction and verifies loopback ::1, :: and compressed IPv6 are fully redacted', () => {
      // Full standard IPv6 and IPv4
      const fullIpv6 = 'Connection error from 2001:0db8:85a3:0000:0000:8a2e:0370:7334 and 192.168.1.100';
      const scrubbedFull = scrubPII(fullIpv6);
      expect(scrubbedFull).not.toContain('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
      expect(scrubbedFull).not.toContain('192.168.1.100');
      expect(scrubbedFull).toContain('[REDACTED_IP]');

      // Semantic versions preserved
      const semverText = 'App version 1.2.3 and 2.0.0-beta.1';
      expect(scrubPII(semverText)).toBe('App version 1.2.3 and 2.0.0-beta.1');

      // Loopback IPv6 ::1 is fully redacted
      const loopbackIpv6 = 'Failed on ::1';
      const scrubbedLoopback = scrubPII(loopbackIpv6);
      expect(scrubbedLoopback).toBe('Failed on [REDACTED_IP]');

      // Unspecified :: is redacted
      const unspecifiedIpv6 = 'Listening on ::';
      const scrubbedUnspecified = scrubPII(unspecifiedIpv6);
      expect(scrubbedUnspecified).toBe('Listening on [REDACTED_IP]');

      // Compressed multi-segment IPv6 with multiple segments after :: is fully redacted
      const compressedIpv6 = 'Host fe80::1ff:fe23:4567:890a unreachable';
      const scrubbedCompressed = scrubPII(compressedIpv6);
      expect(scrubbedCompressed).toBe('Host [REDACTED_IP] unreachable');

      // Additional compressed format
      const compressedIpv6Short = 'Ping 2001:db8::2:1 timeout';
      expect(scrubPII(compressedIpv6Short)).toBe('Ping [REDACTED_IP] timeout');
    });

    it('2.5: Authorization headers and JWT tokens of varying shapes (standard, 2-part, compact base64url)', () => {
      const samples = [
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123',
        'Header: Bearer dXNlcjpwYXNzd29yZA==',
        'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature',
        'Raw token: eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiIxMjMifQ',
      ];

      for (const s of samples) {
        const scrubbed = scrubPII(s);
        expect(scrubbed).not.toContain('eyJhbGci');
        expect(scrubbed).not.toContain('signature123');
        expect(scrubbed).not.toContain('dXNlcjpwYXNzd29yZA==');
        expect(scrubbed).toContain('[REDACTED_TOKEN]');
      }
    });

    it('2.6: Massive stack traces (> 1000 chars, 50KB, 500KB) are truncated to <= 1000 chars without regex catastrophic backtracking', () => {
      const frame = '    at computeCycleProgress (C:\\Users\\gerar\\logbook\\src\\calc.ts:50:12)\n';
      const massive50KB = 'Error: Stack explosion\n' + frame.repeat(700); // ~50KB
      const massive500KB = 'Error: Megastack explosion\n' + frame.repeat(7000); // ~500KB

      const start = performance.now();
      const truncated50 = truncateStack(massive50KB, 1000);
      const elapsed50 = performance.now() - start;

      expect(elapsed50).toBeLessThan(100);
      expect(truncated50).toBeDefined();
      expect(truncated50!.length).toBeLessThanOrEqual(1000);
      expect(truncated50).toContain('...[TRUNCATED]');
      expect(truncated50).not.toContain('gerar');
      expect(truncated50).toContain('[REDACTED_PATH]');

      const start500 = performance.now();
      const truncated500 = truncateStack(massive500KB, 1000);
      const elapsed500 = performance.now() - start500;

      expect(elapsed500).toBeLessThan(200);
      expect(truncated500!.length).toBeLessThanOrEqual(1000);
      expect(truncated500).toContain('...[TRUNCATED]');
    });

    it('2.7: Boundary stack lengths (exact 999, 1000, 1001 chars)', () => {
      const exact999 = 'x'.repeat(999);
      const trunc999 = truncateStack(exact999, 1000);
      expect(trunc999!.length).toBe(999);
      expect(trunc999).not.toContain('...[TRUNCATED]');

      const exact1000 = 'x'.repeat(1000);
      const trunc1000 = truncateStack(exact1000, 1000);
      expect(trunc1000!.length).toBe(1000);
      expect(trunc1000).not.toContain('...[TRUNCATED]');

      const exact1001 = 'x'.repeat(1001);
      const trunc1001 = truncateStack(exact1001, 1000);
      expect(trunc1001!.length).toBe(1000);
      expect(trunc1001).toContain('...[TRUNCATED]');
    });
  });
});
