import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TELEMETRY_QUEUE_CAPACITY,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_MAX_AGE_MS,
  type QueuedTelemetryItem,
} from '../src/lib/telemetry/contracts';
import { TelemetryQueueStorage } from '../src/lib/telemetry/queueStorage';

const CLOCK = new Date('2026-10-11T12:00:00Z');

function queued(id: string, timestamp: number, userId = 'owner-a'): QueuedTelemetryItem {
  return {
    id,
    timestamp,
    queuedAt: timestamp,
    itemType: 'event',
    payload: {
      timestamp,
      type: 'technical_failure',
      context: { appVersion: '1.1.0', platform: 'other', displayMode: 'browser', online: false },
      userId,
      sessionId: 'session-a',
    },
    retryCount: 0,
  };
}

describe('Offline technical telemetry data minimization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOCK);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('expires old on-disk reports while retaining recent reports and migrating old timestamp-only entries', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const key = storage.getQueueStorageKey();
    const now = Date.now();
    const old = queued('old', now - TELEMETRY_QUEUE_MAX_AGE_MS - 1);
    const recent = queued('recent', now - TELEMETRY_QUEUE_MAX_AGE_MS + 1);
    delete recent.queuedAt;
    localStorage.setItem(key, JSON.stringify([old, recent]));

    expect(storage.getQueuedEvents().map(item => item.id)).toEqual(['recent']);
    expect(JSON.parse(localStorage.getItem(key) || '[]').map((item: QueuedTelemetryItem) => item.id)).toEqual(['recent']);
  });

  it('expires cached items and updates disk when time passes while the app is open', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    storage.enqueueItem('event', queued('live', Date.now()).payload);
    const key = storage.getQueueStorageKey();
    expect(storage.getQueuedEvents()).toHaveLength(1);

    vi.setSystemTime(Date.now() + TELEMETRY_QUEUE_MAX_AGE_MS);
    expect(storage.getQueuedEvents()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(key) || '[]')).toEqual([]);
  });

  it('never restores stale reports during an in-flight flush reconciliation', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const now = Date.now();
    storage.replaceQueue([
      queued('expired', now - TELEMETRY_QUEUE_MAX_AGE_MS - 10),
      queued('live', now),
    ]);
    expect(storage.getQueuedEvents().map(item => item.id)).toEqual(['live']);
    expect(JSON.parse(localStorage.getItem(storage.getQueueStorageKey()) || '[]')).toHaveLength(1);
  });

  it('prunes legacy unscoped reports at migration and caps oversized persisted queues', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const now = Date.now();
    const longQueue = Array.from({ length: TELEMETRY_QUEUE_CAPACITY + 10 },
      (_, n) => queued('entry-' + n, now - 1000));
    localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify([
      queued('old', now - TELEMETRY_QUEUE_MAX_AGE_MS - 1),
      ...longQueue,
    ]));
    const result = storage.getQueuedEvents();
    expect(result).toHaveLength(TELEMETRY_QUEUE_CAPACITY);
    expect(result[0].id).toBe('entry-10');
    expect(localStorage.getItem(TELEMETRY_QUEUE_KEY)).toBeNull();
  });

  it('cleans malformed owner data without touching another account queue', () => {
    const ownerA = new TelemetryQueueStorage(() => 'owner-a');
    const ownerB = new TelemetryQueueStorage(() => 'owner-b');
    const keyA = ownerA.getQueueStorageKey();
    const keyB = ownerB.getQueueStorageKey();
    localStorage.setItem(keyA, '{broken json with sensitive data');
    localStorage.setItem(keyB, JSON.stringify([queued('b', Date.now(), 'owner-b')]));
    expect(ownerA.getQueuedEvents()).toEqual([]);
    expect(localStorage.getItem(keyA)).toBeNull();
    expect(ownerB.getQueuedEvents().map(item => item.id)).toEqual(['b']);
  });

  it('drops reports whose timestamps cannot establish a safe retention window', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const now = Date.now();
    const invalid = queued('invalid', now);
    invalid.queuedAt = Number.NaN;
    const future = queued('future', now + 2 * 24 * 60 * 60 * 1000);
    const noTime = queued('missing', now);
    noTime.timestamp = Number.NaN;
    delete noTime.queuedAt;
    localStorage.setItem(storage.getQueueStorageKey(), JSON.stringify([invalid, future, noTime]));
    expect(storage.getQueuedEvents()).toEqual([]);
  });
});
