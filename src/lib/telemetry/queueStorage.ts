import { deviceKey } from '../sync/deviceStorage';
import { storageOwner } from '../sync/session';
import {
  TELEMETRY_QUEUE_CAPACITY,
  TELEMETRY_QUEUE_KEY,
  type QueuedTelemetryItem,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
} from './contracts';

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
            return parsed.filter(
              (item) =>
                item &&
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                item.payload &&
                typeof item.payload === 'object'
            );
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
      const newItem: QueuedTelemetryItem = {
        id: payload.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: payload.timestamp || Date.now(),
        itemType: kind,
        payload,
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
    this.saveQueuedEvents(items, true);
  }

  public reset(): void {
    this.cachedQueue = null;
    this.isDiskSyncScheduled = false;
  }
}
