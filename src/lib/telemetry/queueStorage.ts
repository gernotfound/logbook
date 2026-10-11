import { deviceKey } from '../sync/deviceStorage';
import { storageOwner } from '../sync/session';
import {
  TELEMETRY_QUEUE_CAPACITY,
  TELEMETRY_QUEUE_MAX_AGE_MS,
  TELEMETRY_QUEUE_KEY,
  type QueuedTelemetryItem,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
} from './contracts';
import { sanitizeTelemetryDetails } from './detailSanitizer';
import { createTelemetryId } from './id';

function minimizeEventPayload(payload: TelemetryEventPayload): TelemetryEventPayload {
  if (payload.details === undefined) return payload;
  return {
    ...payload,
    details: sanitizeTelemetryDetails(payload.details),
  };
}

function minimizeQueuedItem(item: QueuedTelemetryItem): QueuedTelemetryItem {
  if (item.itemType !== 'event') return item;
  return {
    ...item,
    payload: minimizeEventPayload(item.payload as TelemetryEventPayload),
  };
}

function parseQueuedItems(raw: string | null): QueuedTelemetryItem[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        item.payload &&
        typeof item.payload === 'object'
    )
    .map((item) => minimizeQueuedItem(item as QueuedTelemetryItem));
}

// The timestamp is the fallback for queues saved by previous builds without queuedAt.
// An absent, malformed or implausibly future timestamp must not extend retention.
function retainUnexpiredItems(items: QueuedTelemetryItem[], now = Date.now()): QueuedTelemetryItem[] {
  return items.filter((item) => {
    const enqueuedAt = item.queuedAt === undefined ? item.timestamp : item.queuedAt;
    return typeof enqueuedAt === 'number'
      && Number.isFinite(enqueuedAt)
      && enqueuedAt > 0
      && enqueuedAt <= now + 24 * 60 * 60 * 1000
      && now - enqueuedAt < TELEMETRY_QUEUE_MAX_AGE_MS;
  }).slice(-TELEMETRY_QUEUE_CAPACITY);
}

export class TelemetryQueueStorage {
  private cachedQueue: QueuedTelemetryItem[] | null = null;
  private cachedQueueKey: string | null = null;
  private isDiskSyncScheduled = false;

  constructor(private readonly getUserId: () => string | null) {}

  public getQueueStorageKey(): string {
    const uid = this.getUserId();
    const owner = uid && uid !== 'anonymous' ? `user:${uid}` : (storageOwner() || 'guest');
    return deviceKey('telemetry_queue', owner);
  }

  public getQueuedEvents(): QueuedTelemetryItem[] {
    const ownerKey = this.getQueueStorageKey();
    if (this.cachedQueue !== null && this.cachedQueueKey === ownerKey) {
      const recent = retainUnexpiredItems(this.cachedQueue);
      if (recent.length !== this.cachedQueue.length) {
        this.saveQueuedEvents(recent, true);
      }
      return recent;
    }

    try {
      if (typeof localStorage !== 'undefined') {
        const ownerRaw = localStorage.getItem(ownerKey);
        if (ownerRaw !== null) {
          const parsed = parseQueuedItems(ownerRaw);
          const recent = retainUnexpiredItems(parsed);
          if (recent.length !== parsed.length) {
            localStorage.setItem(ownerKey, JSON.stringify(recent));
          }
          return recent;
        }

        // One-way migration from the pre-owner-scoped queue. Telemetry is
        // best-effort, so entries are migrated only when their embedded UID
        // proves that they belong to the current owner. Everything else is
        // discarded rather than attributed to another account.
        const legacyRaw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
        if (legacyRaw !== null) {
          const uid = this.getUserId();
          const legacyItems = retainUnexpiredItems(parseQueuedItems(legacyRaw));
          const migrated = legacyItems.filter((item) => {
            const payloadUid = item.payload?.userId;
            return uid && uid !== 'anonymous'
              ? payloadUid === uid
              : !payloadUid || payloadUid === 'anonymous';
          });
          localStorage.setItem(ownerKey, JSON.stringify(migrated));
          localStorage.removeItem(TELEMETRY_QUEUE_KEY);
          return migrated;
        }
      }
    } catch {
      try {
        // A corrupted owner queue may contain sensitive diagnostic payloads;
        // do not leave it on disk forever or touch any other owner's queue.
        localStorage.removeItem(ownerKey);
        localStorage.removeItem(TELEMETRY_QUEUE_KEY);
      } catch {
        // Corrupted/unavailable storage remains non-blocking telemetry state.
      }
    }

    return [];
  }

  private saveQueuedEvents(items: QueuedTelemetryItem[], immediateDiskSync: boolean = true): void {
    const ownerKey = this.getQueueStorageKey();
    this.cachedQueue = retainUnexpiredItems(items);
    this.cachedQueueKey = ownerKey;
    if (immediateDiskSync) {
      this.syncQueueToDisk(ownerKey);
    }
  }

  private syncQueueToDisk(ownerKey: string): void {
    if (this.cachedQueueKey !== ownerKey || this.cachedQueue === null) return;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ownerKey, JSON.stringify(this.cachedQueue));
        localStorage.removeItem(TELEMETRY_QUEUE_KEY);
      }
    } catch {
      // QuotaExceededError and SecurityError must not block the application.
    }
  }

  public updateQueuedErrorCount(id?: string, count: number = 1, lastSeen: number = Date.now()): void {
    if (!id) return;

    try {
      const ownerKey = this.getQueueStorageKey();
      if (this.cachedQueue === null || this.cachedQueueKey !== ownerKey) {
        this.cachedQueue = this.getQueuedEvents();
        this.cachedQueueKey = ownerKey;
      }

      let found = false;
      for (const item of this.cachedQueue) {
        if (item && item.payload && (item.id === id || (item.payload as any).id === id)) {
          (item.payload as TelemetryErrorPayload).count = count;
          (item.payload as TelemetryErrorPayload).lastSeen = lastSeen;
          found = true;
          break;
        }
      }

      if (found && !this.isDiskSyncScheduled) {
        this.isDiskSyncScheduled = true;
        queueMicrotask(() => {
          // A delayed microtask must not persist or discard another account's cache.
          if (!this.isDiskSyncScheduled || this.cachedQueueKey !== ownerKey) return;
          this.isDiskSyncScheduled = false;
          this.syncQueueToDisk(ownerKey);
          this.cachedQueue = null;
          this.cachedQueueKey = null;
        });
      }
    } catch {
      // Queue aggregation is best-effort.
    }
  }

  public enqueueItem(
    kind: 'error' | 'event',
    payload: TelemetryErrorPayload | TelemetryEventPayload
  ): void {
    try {
      const items = [...this.getQueuedEvents()];
      const minimizedPayload = kind === 'event'
        ? minimizeEventPayload(payload as TelemetryEventPayload)
        : payload;
      const newItem: QueuedTelemetryItem = {
        id: minimizedPayload.id || createTelemetryId('item'),
        timestamp: minimizedPayload.timestamp || Date.now(),
        itemType: kind,
        payload: minimizedPayload,
        queuedAt: Date.now(),
        retryCount: 0,
      };
      items.push(newItem);

      while (items.length > TELEMETRY_QUEUE_CAPACITY) {
        items.shift();
      }

      this.saveQueuedEvents(items, true);
    } catch {
      // Telemetry queueing is best-effort.
    }
  }

  public flushPendingDiskSync(): void {
    if (!this.isDiskSyncScheduled) return;

    this.isDiskSyncScheduled = false;
    if (this.cachedQueueKey !== null) this.syncQueueToDisk(this.cachedQueueKey);
    this.cachedQueue = null;
    this.cachedQueueKey = null;
  }

  public invalidateCache(): void {
    this.cachedQueue = null;
    this.cachedQueueKey = null;
    this.isDiskSyncScheduled = false;
  }

  public replaceQueue(items: QueuedTelemetryItem[]): void {
    this.saveQueuedEvents(items.map(minimizeQueuedItem), true);
  }

  public reset(): void {
    this.invalidateCache();
  }
}
