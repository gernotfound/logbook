import { deviceKey } from '../sync/deviceStorage';
import { storageOwner } from '../sync/session';
import { isVaultUnlocked } from '../sync/secureArchiveSession';
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
import { readEncryptedTelemetry, storeEncryptedTelemetry, discardLegacyUnscopedTelemetry } from './secureQueueDevice';

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

  private getOwner(): string {
    const uid = this.getUserId();
    return uid && uid !== 'anonymous' ? `user:${uid}` : (storageOwner() || 'guest');
  }

  public getQueueStorageKey(): string {
    // Logical owner identity, retained for lifecycle fencing and old-tab
    // migration; new reports are stored ONLY under the sealed namespace.
    return deviceKey('telemetry_queue', this.getOwner());
  }

  public getQueuedEvents(): QueuedTelemetryItem[] {
    const ownerKey = this.getQueueStorageKey();
    const owner = this.getOwner();
    if (this.cachedQueue !== null && this.cachedQueueKey === ownerKey) {
      const recent = retainUnexpiredItems(this.cachedQueue);
      if (recent.length !== this.cachedQueue.length) this.saveQueuedEvents(recent, true);
      else this.syncQueueToDisk(ownerKey); // Persist an in-memory pre-unlock queue once the vault is ready.
      return recent;
    }

    try {
      if (typeof localStorage !== 'undefined') {
        const protectedRaw = readEncryptedTelemetry(owner);
        if (protectedRaw !== null) {
          const parsed = parseQueuedItems(protectedRaw);
          const recent = retainUnexpiredItems(parsed);
          if (recent.length !== parsed.length) storeEncryptedTelemetry(owner, JSON.stringify(recent));
          // An obsolete tab can recreate the old plaintext queue after a
          // sealed write. Only the protected copy is authoritative.
          localStorage.removeItem(ownerKey);
          discardLegacyUnscopedTelemetry();
          return recent;
        }

        // One-way migration of existing unencrypted technical reports.
        // Never erase the last owner-scoped copy until AEAD read-back succeeds.
        const legacyRaw = localStorage.getItem(ownerKey);
        const globalRaw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
        const source = legacyRaw ?? globalRaw;
        if (source !== null) {
          const uid = this.getUserId();
          let items: QueuedTelemetryItem[];
          try {
            items = retainUnexpiredItems(parseQueuedItems(source));
          } catch {
            // Only obsolete plaintext diagnostics are expendable. Never treat
            // an encrypted read/decryption failure as authorization to erase.
            localStorage.removeItem(ownerKey);
            discardLegacyUnscopedTelemetry();
            return [];
          }
          const filtered = items.filter(item => uid && uid !== 'anonymous'
            ? item.payload?.userId === uid
            : !item.payload?.userId || item.payload.userId === 'anonymous');
          if (storeEncryptedTelemetry(owner, JSON.stringify(filtered))) {
            discardLegacyUnscopedTelemetry();
          } else if (!isVaultUnlocked(owner)) {
            // Previously saved plaintext diagnostics must not stay on disk
            // indefinitely while the account/guest vault is unavailable.
            // Retain the valid remainder in RAM, then erase only the legacy
            // best-effort copy; business snapshots are never handled here.
            this.cachedQueue = filtered;
            this.cachedQueueKey = ownerKey;
            localStorage.removeItem(ownerKey);
            discardLegacyUnscopedTelemetry();
          }
          return filtered;
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
    if (immediateDiskSync) {
      this.syncQueueToDisk(ownerKey);
    }
  }

  private syncQueueToDisk(ownerKey: string): boolean {
    if (this.cachedQueueKey !== ownerKey || this.cachedQueue === null) return false;
    try {
      // Never create new plaintext report storage, even before vault setup.
      // In-memory diagnostics still work if the archive is locked or unavailable.
      return storeEncryptedTelemetry(this.getOwner(), JSON.stringify(this.cachedQueue));
    } catch {
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
    if (this.cachedQueueKey !== null && this.syncQueueToDisk(this.cachedQueueKey)) {
      this.cachedQueue = null;
      this.cachedQueueKey = null;
    }
  }

  /** Re-read a durable queue after cloud delivery, but do not erase an
   * in-memory-only queue while the owner vault is still locked.
   */
  public refreshAfterFlush(): void {
    if (!isVaultUnlocked(this.getOwner())) return;
    this.invalidateCache();
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
