import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import { scrubPII, truncateStack, computeErrorHash, sanitizeErrorPayload } from '../src/lib/telemetrySanitizer';
import { telemetryHub, type TelemetryErrorPayload, RATE_LIMIT_WINDOW_MS } from '../src/lib/telemetryHub';

describe('Challenger 4: Final Adversarial Telemetry & Stress Verification Harness', () => {
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

  describe('1. Adversarial IPv6 & IPv4-Mapped IPv6 Stress Matrix', () => {
    const ipv4MappedVariants = [
      { raw: '::ffff:192.0.2.1', expected: '[REDACTED_IP]' },
      { raw: '::ffff:127.0.0.1', expected: '[REDACTED_IP]' },
      { raw: '::ffff:10.0.0.1', expected: '[REDACTED_IP]' },
      { raw: '::ffff:172.16.0.1', expected: '[REDACTED_IP]' },
      { raw: '::ffff:255.255.255.255', expected: '[REDACTED_IP]' },
      { raw: '::ffff:0.0.0.0', expected: '[REDACTED_IP]' },
      { raw: '0:0:0:0:0:ffff:192.0.2.1', expected: '[REDACTED_IP]' },
      { raw: '::FFFF:192.0.2.1', expected: '[REDACTED_IP]' },
      { raw: 'Client remote ::ffff:192.0.2.1 connected', expected: 'Client remote [REDACTED_IP] connected' },
      { raw: 'http://[::ffff:192.0.2.1]:8080/api/v1', expected: 'http://[[REDACTED_IP]]:8080/api/v1' },
      { raw: 'https://gateway.internal:443?source=::ffff:192.0.2.1&debug=1', expected: 'https://gateway.internal:443?source=[REDACTED_IP]&debug=1' },
      { raw: 'Error at [::ffff:192.0.2.1]: socket hang up', expected: 'Error at [[REDACTED_IP]]: socket hang up' },
      { raw: '("::ffff:192.0.2.1")', expected: '("[REDACTED_IP]")' },
      { raw: '::ffff:192.0.2.1.', expected: '[REDACTED_IP].' },
      { raw: '::ffff:192.0.2.1; failed', expected: '[REDACTED_IP]; failed' },
      { raw: '::ffff:192.0.2.1, retry', expected: '[REDACTED_IP], retry' },
    ];

    for (const { raw, expected } of ipv4MappedVariants) {
      it(`sanitizes IPv4-mapped IPv6: "${raw}" -> "${expected}"`, () => {
        const result = scrubPII(raw);
        expect(result).toBe(expected);
        expect(result).not.toContain('192.0.2.1');
        expect(result).not.toContain('ffff');
        expect(result).not.toContain('127.0.0.1');
        expect(result).not.toContain('10.0.0.1');
      });
    }

    const standardIpv6Variants = [
      { name: 'loopback isolated', raw: '::1', expected: '[REDACTED_IP]' },
      { name: 'loopback bracketed', raw: '[::1]:8080', expected: '[[REDACTED_IP]]:8080' },
      { name: 'loopback in sentence', raw: 'Proxy set to ::1 on port 3000', expected: 'Proxy set to [REDACTED_IP] on port 3000' },
      { name: 'unspecified address', raw: '::', expected: '[REDACTED_IP]' },
      { name: 'full 8 hextet', raw: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', expected: '[REDACTED_IP]' },
      { name: 'compressed leading', raw: '::2001:db8', expected: '[REDACTED_IP]' },
      { name: 'compressed middle', raw: '2001:db8::1', expected: '[REDACTED_IP]' },
      { name: 'compressed trailing', raw: '2001:db8::', expected: '[REDACTED_IP]' },
      { name: 'link-local full', raw: 'fe80::1ff:fe23:4567:890a', expected: '[REDACTED_IP]' },
      { name: 'link-local bracketed with port', raw: 'https://[fe80::1ff:fe23:4567:890a]:443/status', expected: 'https://[[REDACTED_IP]]:443/status' },
      { name: 'mixed case hextets', raw: '2001:0Db8:85A3::8A2E:0370:7334', expected: '[REDACTED_IP]' },
    ];

    for (const { name, raw, expected } of standardIpv6Variants) {
      it(`sanitizes IPv6 (${name}): "${raw}" -> "${expected}"`, () => {
        const result = scrubPII(raw);
        expect(result).toBe(expected);
        expect(result).not.toMatch(/2001:[0-9a-fA-F:]+/);
        expect(result).not.toMatch(/fe80:[0-9a-fA-F:]+/);
      });
    }

    const falsePositiveEdgeCases = [
      { name: 'stack line and column numbers', raw: '    at Function.calc (src/lib/calc.ts:130:23)', expected: '    at Function.calc (src/lib/calc.ts:130:23)' },
      { name: 'ISO 8601 timestamps', raw: 'Timestamp: 2026-08-24T14:46:22.000Z in log', expected: 'Timestamp: 2026-08-24T14:46:22.000Z in log' },
      { name: 'time strings', raw: 'Failed at 14:30:00 UTC', expected: 'Failed at 14:30:00 UTC' },
      { name: 'JSON key-value colons', raw: '{"status":"error","code":500}', expected: '{"status":"error","code":500}' },
      { name: 'CSS hex colors', raw: 'background: #00e5ff; color: #cc00ff;', expected: 'background: #00e5ff; color: #cc00ff;' },
      { name: 'regular colon text', raw: 'Note: the operation timed out: connection refused', expected: 'Note: the operation timed out: connection refused' },
    ];

    for (const { name, raw, expected } of falsePositiveEdgeCases) {
      it(`preserves valid non-IP colon structures (${name}): "${raw}"`, () => {
        const result = scrubPII(raw);
        expect(result).toBe(expected);
      });
    }
  });

  describe('2. Empirical Hot Loop Performance Benchmarks', () => {
    it('2.1: Hot loop with 1,000 distinct Error objects completes in < 100ms', () => {
      telemetryHub.init();
      telemetryHub.setUserId('user_bench_distinct_1000');

      // Pre-warm JIT
      for (let i = 0; i < 20; i++) {
        telemetryHub.trackError(new Error(`warmup_${i}`));
      }
      telemetryHub.clearRateLimiters();

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        const err = new TypeError(`Unique distinct error #${i} - pointer invalid at offset 0x${(i * 13).toString(16)}`);
        telemetryHub.trackError(err);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(1000);
    });

    it('2.2: Hot loop with 1,000 duplicate Error objects completes in < 50ms and collapses into 1 entry', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_bench_dup_1000');

      const sharedError = new Error('Database connection pool exhausted: ECONNRESET');

      // Pre-warm JIT
      for (let i = 0; i < 10; i++) {
        telemetryHub.trackError(sharedError);
      }
      telemetryHub.clearRateLimiters();

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        telemetryHub.trackError(sharedError);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(1);

      // Flush microtasks
      await vi.advanceTimersByTimeAsync(50);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      const payload = mockSetDoc.mock.calls[0][1] as TelemetryErrorPayload;
      expect(payload.type).toBe('Error');
      expect(payload.message).toBe('Database connection pool exhausted: ECONNRESET');
      expect(payload.count).toBe(1000);
    });

    it('2.3: Hot loop with 1,000 duplicate errors across multiple threads/batches handles rate limiting cleanly', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_multi_batch_1000');

      const errA = new Error('Batch A Error');
      const errB = new Error('Batch B Error');

      const start = performance.now();
      for (let i = 0; i < 500; i++) {
        telemetryHub.trackError(errA);
        telemetryHub.trackError(errB);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(2);

      await vi.advanceTimersByTimeAsync(50);
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
    });
  });

  describe('3. PII Sanitization, Truncation, and Integrity Rigor', () => {
    it('3.1: Stack traces over 1,000 characters are safely truncated to exactly <= 1000 with marker', () => {
      const longStack = 'Error: Stack explosion\n' + '    at execute (src/file.ts:1:1)\n'.repeat(100);
      expect(longStack.length).toBeGreaterThan(3000);

      const truncated = truncateStack(longStack, 1000);
      expect(truncated).toBeDefined();
      expect(truncated!.length).toBeLessThanOrEqual(1000);
      expect(truncated!).toContain('...[TRUNCATED]');
    });

    it('3.2: Sanitizes credentials, tokens, emails, IPs, and local paths simultaneously from stack trace', () => {
      const dirtyStack = `Error: Authentication failed for user john.doe@example.com
    at authenticate (C:\\Users\\john_doe\\Documents\\app\\auth.ts:42:15)
    at login (http://[::ffff:192.0.2.1]:8080/api?token=secret12345&apiKey=AIzaSyD_TEST_KEY_123456789012345)
    at process (Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis)`;

      const cleanStack = truncateStack(dirtyStack, 1000);
      expect(cleanStack).toBeDefined();
      expect(cleanStack).not.toContain('john.doe@example.com');
      expect(cleanStack).not.toContain('john_doe');
      expect(cleanStack).not.toContain('192.0.2.1');
      expect(cleanStack).not.toContain('secret12345');
      expect(cleanStack).not.toContain('AIzaSyD_TEST_KEY_123456789012345');
      expect(cleanStack).not.toContain('doNotLeakThis');

      expect(cleanStack).toContain('[REDACTED_EMAIL]');
      expect(cleanStack).toContain('[REDACTED_PATH]');
      expect(cleanStack).toContain('[REDACTED_IP]');
      expect(cleanStack).toContain('token=[REDACTED]');
      expect(cleanStack).toContain('[REDACTED_TOKEN]');
    });

    it('3.3: Correctly computes error hash deterministically', () => {
      const hash1 = computeErrorHash('TypeError', 'Cannot read property id of undefined');
      const hash2 = computeErrorHash('TypeError', 'Cannot read property id of undefined');
      const hash3 = computeErrorHash('TypeError', 'Cannot read property name of undefined');

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1).toHaveLength(8);
      expect(/^[0-9a-f]{8}$/.test(hash1)).toBe(true);
    });
  });

  describe('4. Offline Resilience and Queue Invariant Stress', () => {
    it('4.1: Offline queue strictly enforces FIFO maximum capacity of 50 items', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_queue_overflow');

      // Enqueue 75 distinct events
      for (let i = 0; i < 75; i++) {
        telemetryHub.trackEvent('test_event', { index: i });
      }

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(50);
      // Oldest 25 dropped (indices 0..24), newest 50 retained (indices 25..74)
      expect((queue[0].payload as any).details.index).toBe(25);
      expect((queue[49].payload as any).details.index).toBe(74);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('4.2: Online event triggers replay of all buffered events and cleans queue upon success', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_replay_test');

      telemetryHub.trackError(new Error('Offline Error 1'));
      telemetryHub.trackEvent('workout_started', { routineId: 'r1' });
      telemetryHub.trackEvent('workout_saved', { routineId: 'r1', duration: 3600 });

      expect(telemetryHub.getQueuedEvents().length).toBe(3);

      // Transition back online
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSetDoc).toHaveBeenCalledTimes(3);
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });
  });
});
