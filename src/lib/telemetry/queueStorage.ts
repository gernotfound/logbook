import { deviceKey } from '../sync/deviceStorage';
import { storageOwner } from '../sync/session';
import {
  TELEMETRY_QUEUE_CAPACITY,
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

export class TelemetryQueueStorage {
  private cachedQueue: QueuedTelemetryItem[] | null = null;
  private isDiskSyncScheduled = false;

  constructor(private readonly getUserId: () => string | null) {}

  public getQueueStorageKey(): string {
    const uid = this.getUserId();
    const owner = uid && uid !== 'anonymous' ? `user:${uid}` : (storageOwner() || 'guest');
    return deviceKey('telemetry_queue', owner);
  }

  public getQueuedEvents(): QueuedTelemetryItem[] {
    if (this.cachedQueue !== null) {
      return this.cachedQueue;
    }

    try {
      if (typeof localStorage !== 'undefined') {
        const ownerKey = this.getQueueStorageKey();
        const raw = localStorage.getItem(ownerKey) || localStorage.getItem(TELEMETRY_QUEUE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
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
        }
      }
    } catch {
      // Corrupted JSON or unavailable storage is treated as an empty best-effort queue.
    }

    return [];
  }

  private saveQueuedEvents(items: QueuedTelemetryItem[], immediateDiskSync: boolean = true): void {
    this.cachedQueue = items;
    if (immediateDiskSync) {
      this.syncQueueToDisk();
    }
  }

  private syncQueueToDisk(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const itemsToSave = this.cachedQueue ?? this.getQueuedEvents();
        const ownerKey = this.getQueueStorageKey();
        localStorage.setItem(ownerKey, JSON.stringify(itemsToSave));
        localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(itemsToSave));
      }
    } catch {
      // QuotaExceededError and SecurityError must not block the application.
    }
  }

  public updateQueuedErrorCount(id?: string, count: number = 1, lastSeen: number = Date.now()): void {
    if (!id) return;

    try {
      if (this.cachedQueue === null) {
        this.cachedQueue = this.getQueuedEvents();
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
          this.isDiskSyncScheduled = false;
          this.syncQueueToDisk();
          this.cachedQueue = null;
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
    this.syncQueueToDisk();
    this.cachedQueue = null;
  }

  public invalidateCache(): void {
    this.cachedQueue = null;
  }

  public replaceQueue(items: QueuedTelemetryItem[]): void {
    this.saveQueuedEvents(items.map(minimizeQueuedItem), true);
  }

  public reset(): void {
    this.cachedQueue = null;
    this.isDiskSyncScheduled = false;
  }
}
