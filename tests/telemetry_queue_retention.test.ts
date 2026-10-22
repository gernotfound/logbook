import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TELEMETRY_QUEUE_MAX_AGE_MS,
  type QueuedTelemetryItem,
} from '../src/lib/telemetry/contracts';
import { TelemetryQueueStorage } from '../src/lib/telemetry/queueStorage';
import { readEncryptedTelemetry, storeEncryptedTelemetry } from '../src/lib/telemetry/secureQueueDevice';
import { protectedDeviceKey } from '../src/lib/sync/deviceStorage';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { lockAllVaults, unlockVaultForOwner } from '../src/lib/sync/secureArchiveSession';

const CLOCK = new Date('2026-10-11T12:00:00Z');
const RETIRED_GLOBAL_QUEUE_KEY = 'logbook_telemetry_queue';

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
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOCK);
    lockAllVaults();
    localStorage.clear();
    await createAndMigrateVault('user:owner-a');
  });

  afterEach(() => {
    lockAllVaults();
    localStorage.clear();
    vi.useRealTimers();
  });

  it('expires encrypted reports while retaining valid timestamps', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const now = Date.now();
    const old = queued('old', now - TELEMETRY_QUEUE_MAX_AGE_MS - 1);
    const recent = queued('recent', now - TELEMETRY_QUEUE_MAX_AGE_MS + 1);
    delete recent.queuedAt;
    expect(storeEncryptedTelemetry('user:owner-a', JSON.stringify([old, recent]))).toBe(true);

    expect(storage.getQueuedEvents().map(item => item.id)).toEqual(['recent']);
    expect(JSON.parse(readEncryptedTelemetry('user:owner-a') || '[]').map((item: QueuedTelemetryItem) => item.id)).toEqual(['recent']);
  });

  it('expires cached items and updates disk when time passes while the app is open', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    storage.enqueueItem('event', queued('live', Date.now()).payload);
    expect(storage.getQueuedEvents()).toHaveLength(1);

    vi.setSystemTime(Date.now() + TELEMETRY_QUEUE_MAX_AGE_MS);
    expect(storage.getQueuedEvents()).toHaveLength(0);
    expect(JSON.parse(readEncryptedTelemetry('user:owner-a') || '[]')).toEqual([]);
  });

  it('never restores stale reports during an in-flight flush reconciliation', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const now = Date.now();
    storage.replaceQueue([
      queued('expired', now - TELEMETRY_QUEUE_MAX_AGE_MS - 10),
      queued('live', now),
    ]);
    expect(storage.getQueuedEvents().map(item => item.id)).toEqual(['live']);
    expect(JSON.parse(readEncryptedTelemetry('user:owner-a') || '[]')).toHaveLength(1);
  });

  it('never adopts or deletes an unsupported global plaintext queue', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const old = JSON.stringify([queued('old-shared', Date.now())]);
    localStorage.setItem(RETIRED_GLOBAL_QUEUE_KEY, old);

    expect(storage.getQueuedEvents()).toEqual([]);
    expect(localStorage.getItem(RETIRED_GLOBAL_QUEUE_KEY)).toBe(old);

    storage.enqueueItem('event', queued('current', Date.now()).payload);
    expect(storage.getQueuedEvents().map(item => item.id)).toHaveLength(1);
    expect(JSON.parse(readEncryptedTelemetry('user:owner-a') || '[]')).toHaveLength(1);
    expect(localStorage.getItem(RETIRED_GLOBAL_QUEUE_KEY)).toBe(old);
  });

  it('ignores unsupported plaintext in two accounts while retaining valid ciphertext', async () => {
    const ownerA = new TelemetryQueueStorage(() => 'owner-a');
    await createAndMigrateVault('user:owner-b');
    const ownerB = new TelemetryQueueStorage(() => 'owner-b');
    const keyA = ownerA.getQueueStorageKey();
    const keyB = ownerB.getQueueStorageKey();
    localStorage.setItem(keyA, '{broken json with sensitive data');
    localStorage.setItem(keyB, JSON.stringify([queued('retired-b', Date.now(), 'owner-b')]));
    expect(storeEncryptedTelemetry('user:owner-b',
      JSON.stringify([queued('sealed-b', Date.now(), 'owner-b')]))).toBe(true);

    expect(ownerA.getQueuedEvents()).toEqual([]);
    expect(localStorage.getItem(keyA)).toBe('{broken json with sensitive data');
    expect(ownerB.getQueuedEvents().map(item => item.id)).toEqual(['sealed-b']);
    expect(localStorage.getItem(keyB)).not.toBeNull();
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
    expect(storeEncryptedTelemetry('user:owner-a', JSON.stringify([invalid, future, noTime]))).toBe(true);
    expect(storage.getQueuedEvents()).toEqual([]);
  });
  it('stores diagnostic payload only as owner-bound authenticated ciphertext', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const sensitiveMessage = 'diagnostic marker never in plaintext';
    storage.enqueueItem('error', {
      type: 'error', message: sensitiveMessage, source: 'custom',
      context: { appVersion: '1.1.0', platform: 'other', displayMode: 'browser', online: false },
      userId: 'owner-a', sessionId: 'session-a', count: 1,
      firstSeen: Date.now(), lastSeen: Date.now(),
    });
    const sealedKey = protectedDeviceKey('telemetry_queue', 'user:owner-a');
    const stored = localStorage.getItem(sealedKey);
    expect(stored).toMatch(/^tlb-sealed:v1:/);
    expect(stored).not.toContain(sensitiveMessage);
    expect(localStorage.getItem(storage.getQueueStorageKey())).toBeNull();
    expect(new TelemetryQueueStorage(() => 'owner-a').getQueuedEvents()).toHaveLength(1);
  });

  it('does not create plaintext when the owner vault is locked or unavailable', () => {
    lockAllVaults();
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    storage.enqueueItem('event', queued('volatile', Date.now()).payload);
    expect(storage.getQueuedEvents().map(x => x.id)).toHaveLength(1);
    expect(localStorage.getItem(storage.getQueueStorageKey())).toBeNull();
    expect(localStorage.getItem(protectedDeviceKey('telemetry_queue', 'user:owner-a'))).toBeNull();
  });

  it('keeps newly queued reports in RAM without importing plaintext while locked', () => {
    lockAllVaults();
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const raw = JSON.stringify([queued('retired', Date.now())]);
    localStorage.setItem(storage.getQueueStorageKey(), raw);

    expect(storage.getQueuedEvents()).toEqual([]);
    expect(localStorage.getItem(storage.getQueueStorageKey())).toBe(raw);
    storage.enqueueItem('event', { ...queued('volatile', Date.now()).payload, id: 'volatile' });
    expect(storage.getQueuedEvents().map(item => item.id)).toEqual(['volatile']);
    expect(localStorage.getItem(storage.getQueueStorageKey())).toBe(raw);
    expect(localStorage.getItem(protectedDeviceKey('telemetry_queue', 'user:owner-a'))).toBeNull();
  });

  it('never interprets unsupported plaintext non-array JSON as an encrypted report', () => {
    lockAllVaults();
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    localStorage.setItem(storage.getQueueStorageKey(), 'null');
    expect(storage.getQueuedEvents()).toEqual([]);
    expect(localStorage.getItem(storage.getQueueStorageKey())).toBe('null');
  });

  it('preserves durable encrypted reports when volatile reports arrive before unlock', async () => {
    const disk = new TelemetryQueueStorage(() => 'owner-a');
    disk.replaceQueue([queued('durable', Date.now())]);
    const sealedKey = protectedDeviceKey('telemetry_queue', 'user:owner-a');
    expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);

    lockAllVaults();
    const volatile = new TelemetryQueueStorage(() => 'owner-a');
    volatile.enqueueItem('event', { ...queued('new', Date.now()).payload, id: 'new' });
    expect(volatile.getQueuedEvents().map(item => item.id)).toEqual(['new']);
    expect(localStorage.getItem(volatile.getQueueStorageKey())).toBeNull();

    await unlockVaultForOwner('user:owner-a');
    expect(volatile.getQueuedEvents().map(item => item.id)).toEqual(['durable', 'new']);
    expect(JSON.parse(readEncryptedTelemetry('user:owner-a') || '[]')
      .map((item: QueuedTelemetryItem) => item.id)).toEqual(['durable', 'new']);
  });

  it('preserves unreadable ciphertext instead of overwriting it on a new report', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const sealedKey = protectedDeviceKey('telemetry_queue', 'user:owner-a');
    const tampered = 'tlb-sealed:v1:invalid-ciphertext';
    localStorage.setItem(sealedKey, tampered);

    storage.enqueueItem('event', queued('new', Date.now()).payload);

    expect(localStorage.getItem(sealedKey)).toBe(tampered);
    expect(localStorage.getItem(storage.getQueueStorageKey())).toBeNull();
    expect(storage.getQueuedEvents()).toHaveLength(1);
  });

  it('merges reports collected during ciphertext failure after the encrypted backup is restored', () => {
    const sealedKey = protectedDeviceKey('telemetry_queue', 'user:owner-a');
    const original = new TelemetryQueueStorage(() => 'owner-a');
    original.replaceQueue([queued('durable', Date.now())]);
    const savedCiphertext = localStorage.getItem(sealedKey);
    expect(savedCiphertext).toMatch(/^tlb-sealed:v1:/);

    localStorage.setItem(sealedKey, 'tlb-sealed:v1:invalid-ciphertext');
    const recovering = new TelemetryQueueStorage(() => 'owner-a');
    recovering.enqueueItem('event', { ...queued('new', Date.now()).payload, id: 'new' });
    expect(localStorage.getItem(sealedKey)).toBe('tlb-sealed:v1:invalid-ciphertext');
    expect(recovering.getQueuedEvents().map(item => item.id)).toEqual(['new']);

    // An independent recovery mechanism restored a valid encrypted backup.
    localStorage.setItem(sealedKey, savedCiphertext!);
    expect(recovering.getQueuedEvents().map(item => item.id)).toEqual(['durable', 'new']);
    expect(JSON.parse(readEncryptedTelemetry('user:owner-a') || '[]')
      .map((item: QueuedTelemetryItem) => item.id)).toEqual(['durable', 'new']);
  });

  it('does not discard RAM-only reports on a failed post-flush persistence refresh', () => {
    const sealedKey = protectedDeviceKey('telemetry_queue', 'user:owner-a');
    const existing = new TelemetryQueueStorage(() => 'owner-a');
    existing.replaceQueue([queued('durable', Date.now())]);
    const validCiphertext = localStorage.getItem(sealedKey);
    expect(validCiphertext).toMatch(/^tlb-sealed:v1:/);

    localStorage.setItem(sealedKey, 'tlb-sealed:v1:invalid-ciphertext');
    const pending = new TelemetryQueueStorage(() => 'owner-a');
    pending.enqueueItem('event', { ...queued('volatile', Date.now()).payload, id: 'volatile' });
    expect(pending.getQueuedEvents().map(item => item.id)).toEqual(['volatile']);

    // A completed transport must not clear a volatile queue when the
    // durable reconciliation still fails.
    pending.refreshAfterFlush();
    expect(localStorage.getItem(sealedKey)).toBe('tlb-sealed:v1:invalid-ciphertext');
    expect(pending.getQueuedEvents().map(item => item.id)).toEqual(['volatile']);

    localStorage.setItem(sealedKey, validCiphertext!);
    expect(pending.getQueuedEvents().map(item => item.id)).toEqual(['durable', 'volatile']);
    expect(JSON.parse(readEncryptedTelemetry('user:owner-a') || '[]')
      .map((item: QueuedTelemetryItem) => item.id)).toEqual(['durable', 'volatile']);
  });

  it('preserves another tab\'s appended events when a previously persisted tab queues again', () => {
    const firstTab = new TelemetryQueueStorage(() => 'owner-a');
    const secondTab = new TelemetryQueueStorage(() => 'owner-a');
    firstTab.enqueueItem('event', { ...queued('a', Date.now()).payload, id: 'a' });
    secondTab.enqueueItem('event', { ...queued('b', Date.now()).payload, id: 'b' });

    firstTab.enqueueItem('event', { ...queued('c', Date.now()).payload, id: 'c' });

    expect(new TelemetryQueueStorage(() => 'owner-a').getQueuedEvents()
      .map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(firstTab.getQueuedEvents().map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not resurrect events removed by another tab before the next enqueue', () => {
    const firstTab = new TelemetryQueueStorage(() => 'owner-a');
    const secondTab = new TelemetryQueueStorage(() => 'owner-a');
    firstTab.enqueueItem('event', { ...queued('delivered', Date.now()).payload, id: 'delivered' });
    secondTab.replaceQueue([]);
    expect(new TelemetryQueueStorage(() => 'owner-a').getQueuedEvents()).toEqual([]);

    firstTab.enqueueItem('event', { ...queued('fresh', Date.now()).payload, id: 'fresh' });
    expect(new TelemetryQueueStorage(() => 'owner-a').getQueuedEvents()
      .map(item => item.id)).toEqual(['fresh']);
  });

  it('refreshes a persisted cache on read without erasing another tab\'s new encrypted report', () => {
    const firstTab = new TelemetryQueueStorage(() => 'owner-a');
    firstTab.enqueueItem('event', { ...queued('old', Date.now()).payload, id: 'old' });
    const secondTab = new TelemetryQueueStorage(() => 'owner-a');
    secondTab.enqueueItem('event', { ...queued('new', Date.now()).payload, id: 'new' });
    const durable = readEncryptedTelemetry('user:owner-a');

    expect(firstTab.getQueuedEvents().map(item => item.id)).toEqual(['old', 'new']);
    expect(readEncryptedTelemetry('user:owner-a')).toBe(durable);
  });

  it('does not overwrite another tab\'s newer durable queue after a successful local save', () => {
    const firstTab = new TelemetryQueueStorage(() => 'owner-a');
    firstTab.enqueueItem('event', { ...queued('first', Date.now()).payload, id: 'first' });

    const secondTab = new TelemetryQueueStorage(() => 'owner-a');
    secondTab.enqueueItem('event', { ...queued('second', Date.now()).payload, id: 'second' });
    const beforeRefresh = readEncryptedTelemetry('user:owner-a');

    firstTab.refreshAfterFlush();

    expect(readEncryptedTelemetry('user:owner-a')).toBe(beforeRefresh);
    expect(new TelemetryQueueStorage(() => 'owner-a').getQueuedEvents()
      .map(item => item.id)).toEqual(['first', 'second']);
  });

  it('does not replace an authenticated but incompatible queue format', () => {
    const storage = new TelemetryQueueStorage(() => 'owner-a');
    const sealedKey = protectedDeviceKey('telemetry_queue', 'user:owner-a');
    expect(storeEncryptedTelemetry('user:owner-a', '{"version":2}')).toBe(true);
    const previous = localStorage.getItem(sealedKey);

    storage.enqueueItem('event', queued('new', Date.now()).payload);

    expect(localStorage.getItem(sealedKey)).toBe(previous);
    expect(storage.getQueuedEvents()).toHaveLength(1);
  });

  it('never drops unexpired encrypted ciphertext when the wrapping key is locked', () => {
    const store = new TelemetryQueueStorage(() => 'owner-a');
    store.enqueueItem('event', queued('persisted', Date.now()).payload);
    const ciphertextKey = protectedDeviceKey('telemetry_queue', 'user:owner-a');
    const original = localStorage.getItem(ciphertextKey);
    lockAllVaults();
    expect(new TelemetryQueueStorage(() => 'owner-a').getQueuedEvents()).toEqual([]);
    expect(localStorage.getItem(ciphertextKey)).toBe(original);
  });

});
