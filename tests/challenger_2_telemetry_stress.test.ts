import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import {
  telemetryHub,
  type TelemetryErrorPayload,
} from '../src/lib/telemetryHub';

describe('Empirical Challenger 2: Telemetry Offline Queueing, Capacity & Online Flush Stress Suite', () => {
  let mockSentryTransport: any;
  let dispatchedDocs: Array<{ kind: string; data: any }>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    dispatchedDocs = [];

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    mockSentryTransport = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockImplementation(async (kind: any, data: any) => {
      dispatchedDocs.push({ kind, data });
      return true;
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
  // 1. Offline Queueing, Capacity Limits (50 items) & FIFO Eviction
  // =========================================================================
  describe('1. Offline Queueing, Capacity Limits & FIFO Eviction', () => {

    it('1.3: preserves the latest 50 errors when 60 errors overflow queue capacity', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      for (let i = 1; i <= 60; i++) {
        telemetryHub.trackError(new Error(`Custom distinct error ${i}`));
      }

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(50);

      expect(queue.every(item => item.itemType === 'error')).toBe(true);
      expect(queue.map(item => (item.payload as TelemetryErrorPayload).message))
        .toEqual(Array.from({ length: 50 }, (_, index) => `Custom distinct error ${index + 11}`));

      // Verify structure integrity of all queued items
      queue.forEach((item) => {
        expect(item.id).toBeDefined();
        expect(item.timestamp).toBeGreaterThan(0);
        expect(['error', 'event']).toContain(item.itemType);
        expect(item.payload).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 2. Offline Duplicate Count Updates & Rate Limiting
  // =========================================================================
  describe('2. Offline Duplicate Count Updates & Rate Limiting', () => {
    it('2.1: Updates count and lastSeen in RAM for offline errors without duplicate entries', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_offline_dedup');

      const err = new RangeError('Index out of range');

      // First occurrence
      telemetryHub.trackError(err);

      let queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      const initialItem = queue[0].payload as TelemetryErrorPayload;
      expect(initialItem.count).toBe(1);
      const firstSeenTime = initialItem.firstSeen;

      // Repeat 9 more times while offline
      for (let i = 0; i < 9; i++) {
        telemetryHub.trackError(err);
      }

      queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1); // Still exactly 1 item in queue!
      const updatedItem = queue[0].payload as TelemetryErrorPayload;
      expect(updatedItem.count).toBe(10);
      expect(updatedItem.firstSeen).toBe(firstSeenTime);
      expect(updatedItem.lastSeen).toBeGreaterThanOrEqual(firstSeenTime);
    });

    it('2.2: Tracks multiple distinct error streams concurrently with isolated offline count tracking', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      const errorA = new TypeError('Stream A failure');
      const errorB = new ReferenceError('Stream B undefined variable');
      const errorC = new SyntaxError('Stream C bad json');

      // 5 of Error A
      for (let i = 0; i < 5; i++) telemetryHub.trackError(errorA);
      // 3 of Error B
      for (let i = 0; i < 3; i++) telemetryHub.trackError(errorB);
      // 7 of Error C
      for (let i = 0; i < 7; i++) telemetryHub.trackError(errorC);

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(3);

      const payloadA = queue.find((q) => q.payload.type === 'TypeError')?.payload as TelemetryErrorPayload;
      const payloadB = queue.find((q) => q.payload.type === 'ReferenceError')?.payload as TelemetryErrorPayload;
      const payloadC = queue.find((q) => q.payload.type === 'SyntaxError')?.payload as TelemetryErrorPayload;

      expect(payloadA).toBeDefined();
      expect(payloadA.count).toBe(5);

      expect(payloadB).toBeDefined();
      expect(payloadB.count).toBe(3);

      expect(payloadC).toBeDefined();
      expect(payloadC.count).toBe(7);
    });

  });

  // =========================================================================
  // 3. Online Flush Behavior, Retry & Batching
  // =========================================================================
  describe('3. Online Flush Behavior, Retry & Batching', () => {

    it('3.2: transient Sentry failures retain technical errors until retry', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_retry_test');

      for (let i = 1; i <= 4; i++) {
        telemetryHub.trackError(new Error(`Report ${i}`));
      }
      expect(telemetryHub.getQueuedEvents()).toHaveLength(4);

      mockSentryTransport.mockImplementation(async (kind: any, data: any) => {
        if (data.message === 'Report 2' || data.message === 'Report 4') {
          throw new Error('Transient Sentry transport failure');
        }
        dispatchedDocs.push({ kind, data });
        return true;
      });
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(dispatchedDocs.map(item => item.data.message)).toEqual(['Report 1', 'Report 3']);
      expect(telemetryHub.getQueuedEvents().map(item => (item.payload as TelemetryErrorPayload).message))
        .toEqual(['Report 2', 'Report 4']);

      mockSentryTransport.mockImplementation(async (kind: any, data: any) => {
        dispatchedDocs.push({ kind, data });
        return true;
      });
      await telemetryHub.flushQueue();

      expect(dispatchedDocs.map(item => item.data.message))
        .toEqual(['Report 1', 'Report 3', 'Report 2', 'Report 4']);
      expect(dispatchedDocs.every(item => item.kind === 'error')).toBe(true);
      expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
    });

    it('3.3: retains technical errors added while a flush is in flight', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_concurrent_flush');
      telemetryHub.trackError(new Error('Initial 1'));
      telemetryHub.trackError(new Error('Initial 2'));
      expect(telemetryHub.getQueuedEvents()).toHaveLength(2);

      mockSentryTransport.mockImplementation(async (kind: any, data: any) => {
        dispatchedDocs.push({ kind, data });
        if (data.message === 'Initial 1') {
          Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
          telemetryHub.trackError(new Error('In-flight 3'));
          Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        }
        return true;
      });

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(dispatchedDocs.map(item => item.data.message)).toEqual(['Initial 1', 'Initial 2']);
      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining).toHaveLength(1);
      expect((remaining[0].payload as TelemetryErrorPayload).message).toBe('In-flight 3');

      await telemetryHub.flushQueue();
      expect(dispatchedDocs.map(item => item.data.message))
        .toEqual(['Initial 1', 'Initial 2', 'In-flight 3']);
      expect(dispatchedDocs.every(item => item.kind === 'error')).toBe(true);
      expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. Guest / Anonymous Owner Isolation upon Authentication Change
  // =========================================================================
  describe('4. Guest / Anonymous User ID Isolation upon Login Flush (LB-18 Privacy)', () => {

    it('4.2: Isolates "anonymous" placeholder strings from authenticated user ID on flush', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('anonymous');

      telemetryHub.trackError(new Error('Anon error 1'));

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      expect(queue[0].payload.userId).toBe('anonymous');
      const anonymousQueueKey = telemetryHub.getQueueStorageKey();

      // User authenticates
      telemetryHub.setUserId('authenticated_user_abc');
      expect(telemetryHub.getQueueStorageKey()).not.toBe(anonymousQueueKey);
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      await telemetryHub.flushQueue();

      expect(mockSentryTransport).not.toHaveBeenCalled();
      expect(dispatchedDocs.length).toBe(0);
      expect(telemetryHub.getQueuedEvents()).toHaveLength(0);
      expect(localStorage.getItem(anonymousQueueKey)).toBeNull();
    });
  });

  // =========================================================================
  // 5. Hostile Edge Cases & Defensive Invariants
  // =========================================================================
  describe('5. Hostile Edge Cases & Defensive Invariants', () => {

    it('5.3: sanitizes API keys, emails and paths in offline error reports', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      const sensitiveError = new Error(
        'Failed auth with token AIzaSyA1234567890abcdefghijklmnopqrstuv and email coach@box.it at C:\\Users\\example-user\\app.ts:15:2'
      );
      telemetryHub.trackError(sensitiveError);

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      const payload = queue[0].payload as TelemetryErrorPayload;

      expect(payload.message).not.toContain('AIzaSyA1234567890');
      expect(payload.message).not.toContain('coach@box.it');
      expect(payload.message).not.toContain('C:\\Users\\example-user');
      expect(payload.message).toContain('[REDACTED_TOKEN]');
      expect(payload.message).toContain('[REDACTED_EMAIL]');
      expect(payload.message).toContain('[REDACTED_PATH]');
    });
  });
});
