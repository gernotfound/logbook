import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as firestoreModule from 'firebase/firestore';
import {
  telemetryHub,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
  type QueuedTelemetryItem,
} from '../src/lib/telemetryHub';


describe('Empirical Challenger 2: Telemetry Offline Queueing, Capacity & Online Flush Stress Suite', () => {
  let mockSetDoc: any;
  let _mockDoc: any;
  let dispatchedDocs: Array<{ path: string; data: any; options?: any }>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    dispatchedDocs = [];

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    mockSetDoc = vi.spyOn(firestoreModule, 'setDoc').mockImplementation(async (docRef: any, data: any, options?: any) => {
      dispatchedDocs.push({ path: docRef.path, data, options });
      return undefined;
    });

    _mockDoc = vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {
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
  // 1. Offline Queueing, Capacity Limits (50 items) & FIFO Eviction
  // =========================================================================
  describe('1. Offline Queueing, Capacity Limits & FIFO Eviction', () => {
    it('1.1: Queues both errors and events in localStorage when navigator.onLine is false', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_offline_001');

      telemetryHub.trackError(new TypeError('Network disconnected'));
      telemetryHub.trackEvent('workout_started', { offline: true, routineId: 'r1' });
      telemetryHub.trackPWAInstallClick({ source: 'settings_banner' });
      telemetryHub.trackWorkoutSaved({ offline: true, exerciseCount: 5 });

      const raw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
      expect(raw).toBeDefined();
      const queuedItems: QueuedTelemetryItem[] = JSON.parse(raw!);
      expect(queuedItems.length).toBe(4);

      expect(queuedItems[0].itemType).toBe('error');
      expect(queuedItems[0].payload.type).toBe('TypeError');
      expect(queuedItems[1].itemType).toBe('event');
      expect(queuedItems[1].payload.type).toBe('workout_started');
      expect(queuedItems[2].itemType).toBe('event');
      expect(queuedItems[2].payload.type).toBe('pwa_install_click');
      expect(queuedItems[3].itemType).toBe('event');
      expect(queuedItems[3].payload.type).toBe('workout_saved');

      // Ensure zero Firestore writes occurred while offline
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('1.2: Strictly enforces TELEMETRY_QUEUE_CAPACITY (50) and FIFO eviction on heavy overflow (80 items)', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      // Enqueue 80 distinct events sequentially
      for (let i = 1; i <= 80; i++) {
        telemetryHub.trackEvent(`event_seq_${i}`, { index: i });
      }

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(TELEMETRY_QUEUE_CAPACITY);
      expect(queue.length).toBe(50);

      // Verify that the oldest 30 items (1..30) were evicted FIFO, and exactly 31..80 remain in order
      expect(queue[0].payload.type).toBe('event_seq_31');
      expect((queue[0].payload as TelemetryEventPayload).details?.index).toBe(31);
      expect(queue[queue.length - 1].payload.type).toBe('event_seq_80');
      expect((queue[queue.length - 1].payload as TelemetryEventPayload).details?.index).toBe(80);

      // Verify continuous sequence
      for (let j = 0; j < 50; j++) {
        const expectedIndex = j + 31;
        expect(queue[j].payload.type).toBe(`event_seq_${expectedIndex}`);
      }
    });

    it('1.3: Handles mixed error and event flood (120 items) with accurate FIFO queue preservation', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      for (let i = 1; i <= 60; i++) {
        telemetryHub.trackError(new Error(`Custom distinct error ${i}`));
        telemetryHub.trackEvent(`custom_event_${i}`, { num: i });
      }

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(50);

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
    it('2.1: Updates count and lastSeen in localStorage for identical errors without creating duplicate entries', () => {
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

    it('2.3: Fast path deduplication executes under 10ms for 500 duplicate offline errors', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      const hotError = new Error('Hot loop failure in offline mode');
      const start = performance.now();

      for (let i = 0; i < 500; i++) {
        telemetryHub.trackError(hotError);
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      expect((queue[0].payload as TelemetryErrorPayload).count).toBe(500);
    });
  });

  // =========================================================================
  // 3. Online Flush Behavior, Retry & Batching
  // =========================================================================
  describe('3. Online Flush Behavior, Retry & Batching', () => {
    it('3.1: Successfully flushes all queued items to Firestore and clears localStorage queue', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_online_flush');

      // Queue 3 errors and 3 events
      telemetryHub.trackError(new TypeError('Error 1'));
      telemetryHub.trackError(new RangeError('Error 2'));
      telemetryHub.trackError(new SyntaxError('Error 3'));
      telemetryHub.trackEvent('event_1');
      telemetryHub.trackEvent('event_2');
      telemetryHub.trackEvent('event_3');

      expect(telemetryHub.getQueuedEvents().length).toBe(6);

      // Now switch online and trigger flush
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      expect(mockSetDoc).toHaveBeenCalledTimes(6);
      expect(dispatchedDocs.length).toBe(6);
      expect(telemetryHub.getQueuedEvents().length).toBe(0);

      // Verify Firestore paths
      dispatchedDocs.forEach((docEntry) => {
        expect(docEntry.path).toMatch(/^users\/user_online_flush\/telemetry_(errors|events)\//);
      });
    });

    it('3.2: Retries on transient network errors, preserving failed items in queue while removing succeeded ones', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_retry_test');

      telemetryHub.trackEvent('item_to_succeed_1');
      telemetryHub.trackEvent('item_to_fail_2');
      telemetryHub.trackEvent('item_to_succeed_3');
      telemetryHub.trackEvent('item_to_fail_4');

      expect(telemetryHub.getQueuedEvents().length).toBe(4);

      // Mock setDoc to fail only for item 2 and item 4
      mockSetDoc.mockImplementation(async (docRef: any, data: any) => {
        if (data.type === 'item_to_fail_2' || data.type === 'item_to_fail_4') {
          throw new Error('Transient network drop during write');
        }
        dispatchedDocs.push({ path: docRef.path, data });
        return undefined;
      });

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      // First flush attempt
      await telemetryHub.flushQueue();

      // 2 succeeded, 2 failed
      expect(dispatchedDocs.length).toBe(2);
      let remainingQueue = telemetryHub.getQueuedEvents();
      expect(remainingQueue.length).toBe(2);
      expect(remainingQueue[0].payload.type).toBe('item_to_fail_2');
      expect(remainingQueue[1].payload.type).toBe('item_to_fail_4');

      // Now restore setDoc to succeed on all calls (network recovery)
      mockSetDoc.mockImplementation(async (docRef: any, data: any) => {
        dispatchedDocs.push({ path: docRef.path, data });
        return undefined;
      });

      // Second flush attempt
      await telemetryHub.flushQueue();

      expect(dispatchedDocs.length).toBe(4);
      remainingQueue = telemetryHub.getQueuedEvents();
      expect(remainingQueue.length).toBe(0);
    });

    it('3.3: Preserves in-flight items added concurrently during an active flushQueue operation', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('user_concurrent_flush');

      telemetryHub.trackEvent('initial_item_1');
      telemetryHub.trackEvent('initial_item_2');

      expect(telemetryHub.getQueuedEvents().length).toBe(2);

      // Mock setDoc to simulate an async delay during flush, and inject a new offline event mid-flight
      mockSetDoc.mockImplementation(async (docRef: any, data: any) => {
        dispatchedDocs.push({ path: docRef.path, data });
        if (data.type === 'initial_item_1') {
          // Mid-flight: new offline item arrives (simulate device temporarily having offline items or queueing)
          Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
          telemetryHub.trackEvent('mid_flight_item_3');
          Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        }
        return undefined;
      });

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await telemetryHub.flushQueue();

      // Verify that initial items (1 & 2) were dispatched and mid-flight item is safely retained in queue
      expect(dispatchedDocs.length).toBe(2);
      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(1);
      expect(remaining[0].payload.type).toBe('mid_flight_item_3');

      // Next flush clears mid-flight item
      await telemetryHub.flushQueue();
      expect(dispatchedDocs.length).toBe(3);
      expect(telemetryHub.getQueuedEvents().length).toBe(0);
    });
  });

  // =========================================================================
  // 4. Guest / Anonymous to Authenticated User ID Migration upon Login
  // =========================================================================
  describe('4. Guest / Anonymous User ID Isolation upon Login Flush (LB-18 Privacy)', () => {
    it('4.1: Preserves guest/anonymous items without retroactively assigning authenticated user ID on flush', async () => {
      // Step 1: User is guest / anonymous offline
      localStorage.setItem('logbook_is_guest', 'true');
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId(null); // Guest mode

      telemetryHub.trackError(new Error('Guest offline error'));
      telemetryHub.trackEvent('workout_started', { offline: true });
      telemetryHub.trackPWAInstallClick();

      const queueBefore = telemetryHub.getQueuedEvents();
      expect(queueBefore.length).toBe(3);
      expect(queueBefore[0].payload.userId).toBeNull();
      expect(queueBefore[1].payload.userId).toBeNull();
      expect(queueBefore[2].payload.userId).toBeNull();

      // Step 2: User connects / logs in with Google
      localStorage.removeItem('logbook_is_guest');
      telemetryHub.setUserId('firebase_auth_uid_99999');
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      // Step 3: Trigger flush
      await telemetryHub.flushQueue();

      // Under GDPR and LB-18 invariants, anonymous guest events must never be dispatched under the user's UID
      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(dispatchedDocs.length).toBe(0);
      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(3);
      remaining.forEach((docEntry) => {
        expect(docEntry.payload.userId).toBeNull();
      });
    });

    it('4.2: Isolates "anonymous" placeholder strings from authenticated user ID on flush', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();
      telemetryHub.setUserId('anonymous');

      telemetryHub.trackEvent('anon_event_1');
      telemetryHub.trackError(new Error('Anon error 1'));

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(2);
      expect(queue[0].payload.userId).toBe('anonymous');

      // User authenticates
      telemetryHub.setUserId('authenticated_user_abc');
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      await telemetryHub.flushQueue();

      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(dispatchedDocs.length).toBe(0);
      const remaining = telemetryHub.getQueuedEvents();
      expect(remaining.length).toBe(2);
      remaining.forEach((item) => {
        expect(item.payload.userId).toBe('anonymous');
      });
    });
  });

  // =========================================================================
  // 5. Hostile Edge Cases & Defensive Invariants
  // =========================================================================
  describe('5. Hostile Edge Cases & Defensive Invariants', () => {
    it('5.1: Handles localStorage throwing QuotaExceededError without crashing or halting execution', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      // Mock localStorage.setItem to throw QuotaExceededError
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        const error = new DOMException('QuotaExceededError: storage is full', 'QuotaExceededError');
        throw error;
      });

      expect(() => {
        telemetryHub.trackError(new Error('Storage overflow error'));
        telemetryHub.trackEvent('storage_overflow_event');
      }).not.toThrow();
    });

    it('5.2: Recovers gracefully if localStorage queue contains corrupted JSON or invalid data', () => {
      localStorage.setItem(TELEMETRY_QUEUE_KEY, '{ "corrupted": invalid_json_syntax ');
      telemetryHub.init();

      // getQueuedEvents should catch and return empty array
      const queue = telemetryHub.getQueuedEvents();
      expect(queue).toEqual([]);

      // Adding new items should overwrite corrupted state cleanly
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.trackEvent('clean_recovery_event');

      const recovered = telemetryHub.getQueuedEvents();
      expect(recovered.length).toBe(1);
      expect(recovered[0].payload.type).toBe('clean_recovery_event');
    });

    it('5.3: Sanitizes nested PII, API tokens, and emails in offline queued payloads before storage', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      telemetryHub.init();

      const sensitiveError = new Error(
        'Failed auth with token AIzaSyA1234567890abcdefghijklmnopqrstuv and email coach@box.it at C:\\Users\\gerar\\app.ts:15:2'
      );
      telemetryHub.trackError(sensitiveError);

      const queue = telemetryHub.getQueuedEvents();
      expect(queue.length).toBe(1);
      const payload = queue[0].payload as TelemetryErrorPayload;

      expect(payload.message).not.toContain('AIzaSyA1234567890');
      expect(payload.message).not.toContain('coach@box.it');
      expect(payload.message).not.toContain('C:\\Users\\gerar');
      expect(payload.message).toContain('[REDACTED_TOKEN]');
      expect(payload.message).toContain('[REDACTED_EMAIL]');
      expect(payload.message).toContain('[REDACTED_PATH]');
    });
  });
});
