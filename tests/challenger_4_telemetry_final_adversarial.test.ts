import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import { scrubPII, truncateStack } from '../src/lib/telemetrySanitizer';
import { telemetryHub, type TelemetryErrorPayload } from '../src/lib/telemetryHub';

describe('Challenger 4: Final Adversarial Telemetry & Stress Verification Harness', () => {
  let mockSentryTransport: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    mockSentryTransport = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);

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

    const colonAndPunctuationCases = [
      { name: 'stack line and column numbers', raw: '    at Function.calc (src/lib/calc.ts:130:23)', expected: '    at Function.calc (src/lib/calc.ts:130:23)' },
      { name: 'ISO 8601 timestamps', raw: 'Timestamp: 2026-08-24T14:46:22.000Z in log', expected: 'Timestamp: 2026-08-24T14:46:22.000Z in log' },
      { name: 'time strings', raw: 'Failed at 14:30:00 UTC', expected: 'Failed at 14:30:00 UTC' },
      { name: 'JSON key-value colons', raw: '{"status":"error","code":500}', expected: '{"status":"error","code":500}' },
      { name: 'CSS hex colors', raw: 'background: #00e5ff; color: #cc00ff;', expected: 'background: #00e5ff; color: #cc00ff;' },
      { name: 'regular colon text', raw: 'Note: the operation timed out: connection refused', expected: 'Note: the operation timed out: connection refused' },
      // Non-IP punctuation cases from the retired Challenger 3 suite:
      { name: 'loopback at start', raw: '::1 is localhost', expected: '[REDACTED_IP] is localhost' },
      { name: 'loopback at end', raw: 'Connecting to ::1', expected: 'Connecting to [REDACTED_IP]' },
      { name: 'loopback before period', raw: 'Error on ::1.', expected: 'Error on [REDACTED_IP].' },
      { name: 'loopback before comma', raw: 'Error on ::1, retry.', expected: 'Error on [REDACTED_IP], retry.' },
      { name: 'loopback before semicolon', raw: 'Error on ::1; failed.', expected: 'Error on [REDACTED_IP]; failed.' },
      { name: 'loopback before exclamation', raw: 'Error on ::1!', expected: 'Error on [REDACTED_IP]!' },
      { name: 'loopback before question mark', raw: 'Is it ::1?', expected: 'Is it [REDACTED_IP]?' },
      { name: 'quoted loopback', raw: 'Host "::1" refused.', expected: 'Host "[REDACTED_IP]" refused.' },
      { name: 'single-quoted loopback', raw: "Host ('::1') refused.", expected: "Host ('[REDACTED_IP]') refused." },
      { name: 'parenthesized loopback', raw: '(::1)', expected: '([REDACTED_IP])' },
    ];

    for (const { name, raw, expected } of colonAndPunctuationCases) {
      it(`redacts IPs without corrupting neighboring syntax (${name}): "${raw}"`, () => {
        const result = scrubPII(raw);
        expect(result).toBe(expected);
      });
    }
  });

  describe('3. PII Sanitization and Truncation', () => {
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

  });

  describe('4. Offline Privacy and Sentry Replay', () => {
    it('4.2: replays only redacted offline technical errors to the Sentry transport', async () => {
      const address = '::ffff:192.0.2.1';
      const email = 'coach@example.com';
      // Construct the synthetic Firebase-shaped key at runtime: do not commit credential-like literals.
      const apiKey = ['AIza', 'SyA1234567890abcdefghijklmnopqrstuv'].join('');

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('privacy-replay-owner');
      telemetryHub.trackError(new Error(`Sync failed at ${address} for ${email} with token ${apiKey}`));

      const queue = telemetryHub.getQueuedEvents();
      expect(queue).toHaveLength(1);
      expect(queue[0].itemType).toBe('error');
      expect(queue[0].payload.userId).toBe('privacy-replay-owner');
      const serializedQueue = JSON.stringify(queue);
      for (const secret of [address, email, apiKey]) {
        expect(serializedQueue).not.toContain(secret);
      }
      expect(serializedQueue).toContain('[REDACTED_IP]');
      expect(serializedQueue).toContain('[REDACTED_EMAIL]');
      expect(serializedQueue).toContain('[REDACTED_TOKEN]');
      expect(mockSentryTransport).not.toHaveBeenCalled();

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));

      await vi.waitFor(() => {
        expect(mockSentryTransport).toHaveBeenCalledTimes(1);
        expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
      });

      expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
      const report = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
      expect(report.userId).toBe('privacy-replay-owner');
      expect(report.type).toBe('Error');
      expect(report.message).toContain('[REDACTED_IP]');
      expect(report.message).toContain('[REDACTED_EMAIL]');
      expect(report.message).toContain('[REDACTED_TOKEN]');
      const serializedTransport = JSON.stringify(mockSentryTransport.mock.calls);
      for (const secret of [address, email, apiKey]) {
        expect(serializedTransport).not.toContain(secret);
      }
    });
  });
});
