import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import type { TelemetryErrorPayload } from '../src/lib/telemetry/contracts';
import { z } from 'zod';
import { scrubPII, truncateStack, sanitizeErrorPayload } from '../src/lib/telemetrySanitizer';
import { telemetryHub } from '../src/lib/telemetryHub';

describe('Empirical Adversarial Testing Challenger Suite - Telemetry & Sanitizer', () => {
  let mockSentryTransport: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();

    mockSentryTransport = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);

    telemetryHub.reset();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();

    telemetryHub.reset();
  });

  // =========================================================================
  // 1. Complex & Adversarial Email Patterns
  // =========================================================================
  describe('1. Complex & Adversarial Email Patterns', () => {
    it('redacts complex subdomains, tags, uppercase, and country code TLDs', () => {
      const inputs = [
        'john.doe+tag-123_45@sub.domain.co.uk',
        'ATHLETE_SUPER.STAR+FILTER@GYM-PRO.ORG',
        'user%test@example-domain.museum',
        'contact@sub3.sub2.sub1.company.it',
        '<admin.service@internal-corp.net>',
        'mailto:support@logbook.app?subject=urgent',
        'a@b.co',
      ];

      for (const email of inputs) {
        const scrubbed = scrubPII(`Error occurred for user ${email} during sync`);
        // Check the actual email from each fixture rather than unrelated constants.
        const originalAddress = email.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0];
        expect(originalAddress).toBeDefined();
        expect(scrubbed).not.toContain(originalAddress!);
        expect(scrubbed).toContain('[REDACTED_EMAIL]');
      }
    });

    it('redacts multiple emails in a single string with mixed formatting', () => {
      const text = 'Failed sending report to coach@team.com, cc athlete.one@gym.it and bcc: admin@logbook.io';
      const scrubbed = scrubPII(text);
      expect(scrubbed).toBe('Failed sending report to [REDACTED_EMAIL], cc [REDACTED_EMAIL] and bcc: [REDACTED_EMAIL]');
    });

    it('redacts emails embedded inside serialized JSON and URL query strings', () => {
      const jsonPayload = '{"userEmail":"secret.athlete@gmail.com","backupEmail":"coach@gym.org"}';
      const scrubbedJson = scrubPII(jsonPayload);
      expect(scrubbedJson).not.toContain('secret.athlete@gmail.com');
      expect(scrubbedJson).not.toContain('coach@gym.org');
      expect(scrubbedJson).toContain('[REDACTED_EMAIL]');

      const urlQuery = 'https://api.logbook.app/v1/user?email=hidden.user@domain.com&token=secretToken123';
      const scrubbedUrl = scrubPII(urlQuery);
      expect(scrubbedUrl).not.toContain('hidden.user@domain.com');
      expect(scrubbedUrl).toContain('token=[REDACTED]');
    });
  });

  // =========================================================================
  // 2. Embedded JWT Tokens & Bearer Credentials
  // =========================================================================
  describe('2. Embedded JWT Tokens & Bearer Credentials', () => {
    it('redacts 3-segment signed JWT tokens completely', () => {
      const standardJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const msg = `Unauthorized access attempt with token: ${standardJwt}`;
      const scrubbed = scrubPII(msg);

      expect(scrubbed).not.toContain('eyJhbGci');
      expect(scrubbed).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
      expect(scrubbed).toContain('[REDACTED_TOKEN]');
    });

    it('redacts 2-segment unsigned JWT tokens', () => {
      const unsignedJwt = 'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJ1c2VyXzEyMzQ1In0';
      const msg = `Header received: ${unsignedJwt}`;
      const scrubbed = scrubPII(msg);

      expect(scrubbed).not.toContain('eyJhbGciOiJub25lIn0');
      expect(scrubbed).toContain('[REDACTED_TOKEN]');
    });

    it('redacts Bearer tokens with diverse base64 and url-safe characters', () => {
      const bearerTokens = [
        'Bearer dXNlcjpwYXNzd29yZA==',
        'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        'Bearer SecReT_TokEn-123.456~+/===',
        'bearer lower_case_bearer_token_12345',
        'Authorization: Bearer header_token_12345',
      ];

      for (const b of bearerTokens) {
        const scrubbed = scrubPII(`Auth failed: ${b}`);
        expect(scrubbed).toContain('[REDACTED_TOKEN]');
        expect(scrubbed).not.toContain('dXNlcjpwYXNzd29yZA==');
        expect(scrubbed).not.toContain('SecReT_TokEn-123');
      }
    });
  });

  // =========================================================================
  // 3. Firebase API Keys & Sensitive Key-Value Secrets
  // =========================================================================
  describe('3. Firebase API Keys & Sensitive Key-Value Secrets', () => {
    it('redacts authentic Firebase AIza 39-character API keys', () => {
      const apiKey1 = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
      const apiKey2 = 'AIzaSyD-TEST_KEY_9876543210abcdefghijkl';
      const msg = `Firestore init failed with key ${apiKey1} and secondary ${apiKey2}`;
      const scrubbed = scrubPII(msg);

      expect(scrubbed).not.toContain(apiKey1);
      expect(scrubbed).not.toContain(apiKey2);
      expect(scrubbed).toContain('[REDACTED_TOKEN]');
    });

    it('redacts sensitive parameters in query strings and JSON bodies', () => {
      const query = '?password=superSecret123&refreshToken=rt_9999&accessToken=at_8888&code=oauth_code_777';
      const scrubbedQuery = scrubPII(query);

      expect(scrubbedQuery).not.toContain('superSecret123');
      expect(scrubbedQuery).not.toContain('rt_9999');
      expect(scrubbedQuery).not.toContain('at_8888');
      expect(scrubbedQuery).not.toContain('oauth_code_777');
      expect(scrubbedQuery).toContain('password=[REDACTED]');
      expect(scrubbedQuery).toContain('refreshToken=[REDACTED]');

      const json = '{"password":"pass123","secret":"secret456","accessToken":"tok789"}';
      const scrubbedJson = scrubPII(json);
      expect(scrubbedJson).not.toContain('pass123');
      expect(scrubbedJson).not.toContain('secret456');
      expect(scrubbedJson).not.toContain('tok789');
    });

    it('redacts sensitive KV tokens at string start and after whitespace delimiters', () => {
      const inQuery = '?token=secret123';
      expect(scrubPII(inQuery)).toBe('?token=[REDACTED]');

      expect(scrubPII('token=secret123')).toBe('token=[REDACTED]');
      expect(scrubPII('Auth failed token=secret123 retry=false')).toBe('Auth failed token=[REDACTED] retry=false');
      expect(scrubPII('code=oauth-code-123; status=denied')).toBe('code=[REDACTED]; status=denied');
    });

    it('preserves semantic-version strings rather than treating them as IP addresses', () => {
      const release = 'App version 1.2.3 and 2.0.0-beta.1';
      expect(scrubPII(release)).toBe(release);
    });
  });

  // =========================================================================
  // 4. Local Filesystem Paths (Windows, Linux, macOS)
  // =========================================================================
  describe('4. Local Filesystem Paths (Windows, Linux, macOS)', () => {
    it('redacts standard Windows user paths without spaces', () => {
      const paths = [
        'C:\\Users\\example-user\\Projects\\logbook\\src\\main.tsx:10:5',
        'c:/Users/Administrator/AppData/Local/Temp/bundle.js:100:20',
        'D:\\Users\\JohnDoe\\Desktop\\code.ts:42:1',
        'C:\\Documents and Settings\\User\\Local Settings\\file.js',
      ];

      for (const p of paths) {
        const scrubbed = scrubPII(`Error at ${p}`);
        expect(scrubbed).not.toContain('example-user');
        expect(scrubbed).not.toContain('Administrator');
        expect(scrubbed).not.toContain('JohnDoe');
        expect(scrubbed).toContain('[REDACTED_PATH]');
      }
    });

    it('redacts Linux /home paths and macOS /Users paths', () => {
      const paths = [
        '/home/developer/projects/logbook/src/store/useAppStore.ts:55:12',
        '/home/user.name-123/app/bundle.js:1:100',
        '/Users/sarah_connor/Library/Developer/Xcode/app.js:200:1',
        '/Users/john/workspaces/project/src/main.tsx:10:5',
      ];

      for (const p of paths) {
        const scrubbed = scrubPII(`Trace: ${p}`);
        expect(scrubbed).not.toContain('developer');
        expect(scrubbed).not.toContain('sarah_connor');
        expect(scrubbed).not.toContain('/Users/john');
        expect(scrubbed).toContain('[REDACTED_PATH]');
      }
    });

    it('redacts user paths containing whitespace in usernames or path segments', () => {
      const winWithSpace = 'Crash at C:\\Users\\John Doe\\AppData\\Local\\main.tsx:10:5';
      const macWithSpace = 'Crash at /Users/John Doe/Library/Application Support/logbook/main.js:12:3';

      const scrubbedWin = scrubPII(winWithSpace);
      const scrubbedMac = scrubPII(macWithSpace);

      expect(scrubbedWin).toBe('Crash at [REDACTED_PATH]:10:5');
      expect(scrubbedWin).not.toContain('John Doe');
      expect(scrubbedMac).toBe('Crash at [REDACTED_PATH]:12:3');
      expect(scrubbedMac).not.toContain('John Doe');
    });
  });

  // =========================================================================
  // 5. Massive Stack Traces (>100KB, >500KB) & Length Limits
  // =========================================================================
  describe('5. Massive Stack Traces & Length Limits', () => {
    it('handles >100KB stack traces and enforces strict length <= 1000 characters', () => {
      const frameTemplate = '    at executeWorkout (C:\\Users\\athlete\\logbook\\src\\workout.ts:45:12)\n';
      const massiveStack = 'Error: Stack Overflow\n' + frameTemplate.repeat(2000); // ~150KB

      expect(massiveStack.length).toBeGreaterThan(100000);

      const truncated = truncateStack(massiveStack, 1000);
      expect(truncated).toBeDefined();
      expect(truncated!.length).toBeLessThanOrEqual(1000);
      expect(truncated).toContain('...[TRUNCATED]');
      expect(truncated).not.toContain('athlete');
      expect(truncated).toContain('[REDACTED_PATH]');

      // Retains Challenger 1's extra-large stack case without a wall-clock assertion.
      const megastack = 'Error: Another oversized stack\n' + frameTemplate.repeat(8000);
      expect(megastack.length).toBeGreaterThan(500000);
      const sanitizedMegastack = truncateStack(megastack, 1000);
      expect(sanitizedMegastack).toBeDefined();
      expect(sanitizedMegastack!.length).toBeLessThanOrEqual(1000);
      expect(sanitizedMegastack).toContain('...[TRUNCATED]');
      expect(sanitizedMegastack).not.toContain('athlete');
      expect(sanitizedMegastack).toContain('[REDACTED_PATH]');
    });

    it('preserves exact boundary lengths (999, 1000, 1001 chars) and short limits', () => {
      const exact999 = 'A'.repeat(999);
      expect(truncateStack(exact999, 1000)).toBe(exact999);

      const exact1000 = 'A'.repeat(1000);
      expect(truncateStack(exact1000, 1000)!.length).toBe(1000);
      expect(truncateStack(exact1000, 1000)).not.toContain('...[TRUNCATED]');

      const exact1001 = 'A'.repeat(1001);
      const truncated1001 = truncateStack(exact1001, 1000);
      expect(truncated1001!.length).toBe(1000);
      expect(truncated1001).toContain('...[TRUNCATED]');

      const smallLimit = truncateStack('Long message here', 10);
      expect(smallLimit!.length).toBe(10);
    });
  });

  // =========================================================================
  // 6. Circular Structures, Hostile Getters & Primitive Values
  // =========================================================================
  describe('6. Circular Structures, Hostile Getters & Primitive Values', () => {
    it('handles direct and deeply nested circular object references gracefully', () => {
      const circularDirect: any = { message: 'circular root' };
      circularDirect.self = circularDirect;

      const res1 = sanitizeErrorPayload(circularDirect);
      expect(res1.message).toBe('circular root');

      const circularNested: any = { a: { b: { c: {} } } };
      circularNested.a.b.c.parent = circularNested;
      const res2 = sanitizeErrorPayload(circularNested);
      expect(res2.message).toContain('[Circular]');

      // Mutual and array cycles from the retired Challenger harness.
      const a: any = { name: 'NodeA' };
      const b: any = { name: 'NodeB' };
      a.b = b;
      b.a = a;
      const mutual = sanitizeErrorPayload(a);
      expect(mutual.type).toBe('NodeA');
      expect(mutual.message).toContain('[Circular]');

      const circularArray: any[] = ['item1'];
      circularArray.push(circularArray);
      const arrayResult = sanitizeErrorPayload(circularArray);
      expect(arrayResult.message).toContain('[Circular]');
    });

    it('redacts nested metadata in non-Error objects before the technical Sentry boundary', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('nested-diagnostic-owner');

      const rawKey = ['AIza', 'SyA1234567890abcdefghijklmnopqrstuv'].join('');
      const diagnostic = {
        name: 'NestedDiagnosticError',
        metadata: {
          email: 'admin.super+tag@secret-corp.com',
          ip: '192.168.1.150',
          bearer: 'Bearer secret_access_token_12345',
          apiKey: rawKey,
          file: '/home/developer/private/app.ts:10:1',
        },
      };
      telemetryHub.trackError(diagnostic);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
      expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
      const dispatched = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
      for (const secret of [
        'admin.super+tag@secret-corp.com',
        '192.168.1.150',
        'secret_access_token_12345',
        rawKey,
        '/home/developer',
      ]) {
        expect(JSON.stringify(dispatched)).not.toContain(secret);
      }
      expect(dispatched.message).toContain('[REDACTED_EMAIL]');
      expect(dispatched.message).toContain('[REDACTED_IP]');
      expect(dispatched.message).toContain('[REDACTED_TOKEN]');
      expect(dispatched.message).toContain('[REDACTED_PATH]');
    });

    it('handles hostile objects with throwing getters or throwing toString methods safely', () => {
      const getterBomb = {
        get name() {
          throw new Error('Name getter exploded');
        },
        get message() {
          throw new Error('Message getter exploded');
        },
      };

      expect(() => sanitizeErrorPayload(getterBomb)).not.toThrow();
      const res1 = sanitizeErrorPayload(getterBomb);
      expect(res1.type).toBeDefined();

      const unstringable = {
        name: 'UnstringableError',
        toString() {
          throw new Error('Cannot toString');
        },
      };
      expect(() => sanitizeErrorPayload(unstringable)).not.toThrow();
    });

    it('sanitizes all JavaScript primitive types cleanly without crashing', () => {
      const primitives = [
        { input: null, expectedMsg: 'null' },
        { input: undefined, expectedMsg: 'undefined' },
        { input: 0, expectedMsg: '0' },
        { input: -123.45, expectedMsg: '-123.45' },
        { input: NaN, expectedMsg: 'NaN' },
        { input: Infinity, expectedMsg: 'Infinity' },
        { input: true, expectedMsg: 'true' },
        { input: false, expectedMsg: 'false' },
        { input: '', expectedMsg: '' },
        { input: Symbol('secretSymbol'), expectedMsg: 'Symbol(secretSymbol)' },
        { input: BigInt(9007199254740991), expectedMsg: '9007199254740991' },
      ];

      for (const item of primitives) {
        const sanitized = sanitizeErrorPayload(item.input);
        expect(sanitized.message).toBe(item.expectedMsg);
      }
    });

    it('handles ZodError with missing paths, empty issues array, or non-standard structures', () => {
      const zodErr1 = new z.ZodError([]);
      const res1 = sanitizeErrorPayload(zodErr1);
      expect(res1.type).toBe('ZodError');

      const customZodLike = new Error('Custom validation');
      (customZodLike as any).issues = [
        { path: null, message: 'Invalid without path' },
        { path: ['nested', 0, 'field'], message: 'Deep error' },
      ];
      const res2 = sanitizeErrorPayload(customZodLike);
      expect(res2.message).toContain('Invalid without path');
      expect(res2.message).toContain('nested.0.field: Deep error');
    });
  });

  // =========================================================================
  // 7. Concurrency, Rapid Fire & Memory Safety
  // =========================================================================
  describe('7. Concurrency, Rapid Fire & Memory Safety', () => {
    it('aggregates 500 synchronous errors into ten technical Sentry reports', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_rapid_stress');

      for (let i = 0; i < 500; i++) {
        const errType = i % 5 === 0 ? 'TypeError' : i % 5 === 1 ? 'RangeError' : 'Error';
        const err = new Error(`Rapid error ${i % 10}`);
        err.name = errType;
        telemetryHub.trackError(err);
      }

      // Ten message fingerprints across three error names, each repeated 50 times.
      expect(telemetryHub.getActiveRateLimiterCount()).toBe(10);

      await vi.advanceTimersByTimeAsync(100);
      expect(mockSentryTransport).toHaveBeenCalledTimes(10);
      const calls = mockSentryTransport.mock.calls as Array<[string, TelemetryErrorPayload]>;
      const errors = calls.map((call) => call[1]);
      expect(errors.reduce((total, payload) => total + payload.count, 0)).toBe(500);
      expect(errors.every((payload) => payload.count === 50)).toBe(true);
    });
  });

  // =========================================================================
  // 8. Leak Verification at the Sentry transport boundary
  // =========================================================================
  describe('8. Error Payload Privacy at the Sentry Transport Boundary', () => {
    it('rejects raw PII, JWTs, API keys, and oversized stacks at the technical error transport', async () => {
      vi.useFakeTimers();
      telemetryHub.init();
      telemetryHub.setUserId('user_leak_audit');

      const hostileError = new Error(
        'Crash in athlete.secret@gym.com with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature at C:\\Users\\example-user\\main.tsx:10:5 using key AIzaSyA1234567890abcdefghijklmnopqrstuv'
      );
      hostileError.stack =
        'Error: Crash\n' +
        '    at C:\\Users\\example-user\\Projects\\logbook\\src\\main.tsx:10:5\n'.repeat(100) +
        '    at user=victim@logbook.app\n';

      telemetryHub.trackError(hostileError, {
        source: 'react_caught',
        componentStack:
          '\n    at UserProfile (/Users/admin/projects/logbook/src/UserProfile.tsx:10:1)\n    at ?token=superSecretToken123',
      });

      await vi.advanceTimersByTimeAsync(100);

      expect(mockSentryTransport).toHaveBeenCalledTimes(1);
      expect(mockSentryTransport.mock.calls[0][0]).toBe('error');
      const dispatchedDoc = mockSentryTransport.mock.calls[0][1] as TelemetryErrorPayload;
      expect(dispatchedDoc.message).toContain('[REDACTED_EMAIL]');
      expect(dispatchedDoc.message).toContain('[REDACTED_TOKEN]');
      expect(dispatchedDoc.stack).toContain('[REDACTED_PATH]');

      // Recursive inspector to check all string values in the payload
      const verifyNoLeaks = (obj: any) => {
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') {
            expect(value).not.toContain('athlete.secret@gym.com');
            expect(value).not.toContain('victim@logbook.app');
            expect(value).not.toContain('eyJhbGci');
            expect(value).not.toContain('AIzaSyA');
            expect(value).not.toContain('C:\\Users\\example-user');
            expect(value).not.toContain('/Users/admin');
            expect(value).not.toContain('superSecretToken123');

            if (key === 'stack' || key === 'componentStack') {
              expect(value.length).toBeLessThanOrEqual(1000);
            }
          } else if (typeof value === 'object' && value !== null) {
            verifyNoLeaks(value);
          }
        }
      };

      verifyNoLeaks(dispatchedDoc);
    });
  });
});
