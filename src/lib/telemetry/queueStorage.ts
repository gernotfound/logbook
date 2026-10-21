import { deviceKey } from '../sync/deviceStorage';
import { storageOwner } from '../sync/session';
import { isVaultUnlocked } from '../sync/secureArchiveSession';
import {
  TELEMETRY_QUEUE_CAPACITY,
  TELEMETRY_QUEUE_MAX_AGE_MS,
  type QueuedTelemetryItem,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
} from './contracts';
import { sanitizeTelemetryDetails } from './detailSanitizer';
import { createTelemetryId } from './id';
import { readEncryptedTelemetry, storeEncryptedTelemetry } from './secureQueueDevice';

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
  // Reports collected while locked must be merged with any pre-existing
  // ciphertext after unlock, not overwrite it blindly.
  private needsUnlockReconciliation = false;

  constructor(private readonly getUserId: () => string | null) {}

  private getOwner(): string {
    const uid = this.getUserId();
    return uid && uid !== 'anonymous' ? `user:${uid}` : (storageOwner() || 'guest');
  }

  public getQueueStorageKey(): string {
    // Logical owner identity retained for lifecycle fencing.
    // New reports are stored only under the sealed namespace.
    return deviceKey('telemetry_queue', this.getOwner());
  }

  public getQueuedEvents(): QueuedTelemetryItem[] {
    const ownerKey = this.getQueueStorageKey();
    const owner = this.getOwner();
    if (this.cachedQueue !== null && this.cachedQueueKey === ownerKey) {
      const recent = retainUnexpiredItems(this.cachedQueue);
      if (recent.length !== this.cachedQueue.length) this.saveQueuedEvents(recent, true);
      else this.syncQueueToDisk(ownerKey); // Persist an in-memory pre-unlock queue once the vault is ready.
      return this.cachedQueue ?? recent;
    }

    try {
      if (typeof localStorage !== 'undefined') {
        const protectedRaw = readEncryptedTelemetry(owner);
        if (protectedRaw !== null) {
          const parsed = parseQueuedItems(protectedRaw);
          const recent = retainUnexpiredItems(parsed);
          if (recent.length !== parsed.length) storeEncryptedTelemetry(owner, JSON.stringify(recent));
          // Encrypted owner-scoped storage is the only durable source.
          return recent;
        }
      }
    } catch {
      // A missing key, corrupted ciphertext, quota error or unavailable
      // localStorage is not proof that the encrypted copy can be discarded.
      // Technical telemetry is best-effort; business data is unaffected.
    }
    return [];
  }

  private saveQueuedEvents(items: QueuedTelemetryItem[], immediateDiskSync: boolean = true): void {
    const ownerKey = this.getQueueStorageKey();
    this.cachedQueue = retainUnexpiredItems(items);
    this.cachedQueueKey = ownerKey;
    if (!isVaultUnlocked(this.getOwner())) this.needsUnlockReconciliation = true;
    if (immediateDiskSync) {
      this.syncQueueToDisk(ownerKey);
    }
  }

  private syncQueueToDisk(ownerKey: string): boolean {
    if (this.cachedQueueKey !== ownerKey || this.cachedQueue === null) return false;
    try {
      // Never create new plaintext report storage, even before vault setup.
      // In-memory diagnostics still work if the archive is locked or unavailable.
      const owner = this.getOwner();
      if (!isVaultUnlocked(owner)) return false;
      if (this.needsUnlockReconciliation) {
        const persisted = readEncryptedTelemetry(owner);
        if (persisted !== null) {
          const previous = retainUnexpiredItems(parseQueuedItems(persisted));
          const knownIds = new Set(previous.map(item => item.id));
          const additions = this.cachedQueue.filter(item => !knownIds.has(item.id));
          this.cachedQueue = retainUnexpiredItems([...previous, ...additions]);
        }
      }
      const saved = storeEncryptedTelemetry(owner, JSON.stringify(this.cachedQueue));
      // A failed save may conceal durable reports that become readable again.
      // Reconcile on the next attempt rather than blindly replacing them.
      this.needsUnlockReconciliation = !saved;
      return saved;
    } catch {
      this.needsUnlockReconciliation = true;
      return false;
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
          if (this.syncQueueToDisk(ownerKey)) {
            this.cachedQueue = null;
            this.cachedQueueKey = null;
          }
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
        // Standalone events are accepted but not emitted by the Sentry boundary.
        // They must never evict actionable error diagnostics from the offline queue.
        const eventIndex = items.findIndex(item => item.itemType === 'event');
        if (eventIndex >= 0) items.splice(eventIndex, 1);
        else items.shift();
      }

      this.saveQueuedEvents(items, true);
    } catch {
      // Telemetry queueing is best-effort.
    }
  }

  public flushPendingDiskSync(): void {
    if (!this.isDiskSyncScheduled) return;

    this.isDiskSyncScheduled = false;
    if (this.cachedQueueKey !== null && this.syncQueueToDisk(this.cachedQueueKey)) {
      this.cachedQueue = null;
      this.cachedQueueKey = null;
    }
  }

  /** Re-read the durable queue after cloud delivery. Do not discard reports
   * retained in RAM if their encrypted write has not succeeded yet.
   */
  public refreshAfterFlush(): void {
    if (!isVaultUnlocked(this.getOwner())) return;
    const ownerKey = this.getQueueStorageKey();
    // A successfully persisted cache can be discarded: reread disk so we
    // do not overwrite reports added by another tab. Only retry a dirty cache.
    if (this.cachedQueue !== null && this.cachedQueueKey === ownerKey
      && (this.needsUnlockReconciliation || this.isDiskSyncScheduled)
      && !this.syncQueueToDisk(ownerKey)) return;
    this.invalidateCache();
  }

  public invalidateCache(): void {
    this.cachedQueue = null;
    this.cachedQueueKey = null;
    this.isDiskSyncScheduled = false;
    this.needsUnlockReconciliation = false;
  }

  public replaceQueue(items: QueuedTelemetryItem[]): void {
    this.saveQueuedEvents(items.map(minimizeQueuedItem), true);
  }

  public reset(): void {
    this.invalidateCache();
  }
}
