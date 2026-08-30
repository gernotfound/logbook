/**
 * LogBook - Unified Telemetry Hub Core
 */

import { doc, setDoc } from 'firebase/firestore';
import { getDb, auth, ensureAppCheck } from './firebase';
import {
  computeErrorHash,
  sanitizeErrorPayload,
  scrubPII,
  truncateStack,
  getTelemetryContext,
  type TelemetryContext,
} from './telemetrySanitizer';

export type ErrorSource =
  | 'react_boundary'
  | 'react_root'
  | 'react_caught'
  | 'react_uncaught'
  | 'react_recoverable'
  | 'window_error'
  | 'unhandled_rejection'
  | 'zod_validation'
  | 'zod_schema_fallback'
  | 'app_error'
  | 'custom'
  | string;

export type TelemetryEventType =
  | 'pwa_prompt_shown'
  | 'pwa_install_impression'
  | 'pwa_install_click'
  | 'pwa_install_clicked'
  | 'pwa_install_prompt_outcome'
  | 'pwa_prompt_accepted'
  | 'pwa_prompt_dismissed'
  | 'pwa_appinstalled'
  | 'pwa_installed'
  | 'workout_started'
  | 'workout_saved'
  | 'storage_recovery_anomaly'
  | 'zod_schema_fallback'
  | 'custom_event'
  | string;

export interface TelemetryErrorPayload {
  timestamp?: number;
  id?: string;
  hash?: string;
  type: string;
  message: string;
  stack?: string;
  componentStack?: string;
  source: ErrorSource;
  context: TelemetryContext;
  userId: string | null;
  sessionId: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface TelemetryEventPayload {
  timestamp: number;
  id?: string;
  type: TelemetryEventType;
  details?: Record<string, any>;
  context: TelemetryContext;
  userId: string | null;
  sessionId: string;
}

export interface TrackErrorOptions {
  source?: ErrorSource;
  componentStack?: string;
  customMessage?: string;
}

export interface QueuedTelemetryItem {
  id: string;
  timestamp: number;
  itemType: 'error' | 'event';
  payload: TelemetryErrorPayload | TelemetryEventPayload;
  queuedAt?: number;
  retryCount?: number;
}

interface RateLimitEntry {
  hash: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  payload: TelemetryErrorPayload;
  timerId: ReturnType<typeof setTimeout> | null;
  lastDispatchedCount: number;
  isDispatchPending: boolean;
}

export const RATE_LIMIT_WINDOW_MS = 60000;
export const DEDUP_WINDOW_MS = 60000;
export const FIRESTORE_DISPATCH_TIMEOUT_MS = 5000;
export const TELEMETRY_QUEUE_KEY = 'logbook_telemetry_queue';
export const TELEMETRY_QUEUE_CAPACITY = 50;
export const SESSION_ID_KEY = 'logbook_telemetry_session_id';
export const MAX_ACTIVE_RATE_LIMITERS = 1000;
export const MAX_ITEM_RETRIES = 3;
export const INITIAL_RETRY_DELAY_MS = 1000;
export const MAX_RETRY_DELAY_MS = 30000;

export class TelemetryHub {
  private static instance: TelemetryHub | null = null;
  private static hashCache = new Map<string, { hash: string; scrubbed: string }>();
  private initialized = false;
  private customUserId: string | null | undefined = undefined;
  private cachedUserId: string | null = 'anonymous';
  private cachedUserIdTime = 0;
  private inMemorySessionId: string | null = null;
  private activeRateLimiters = new Map<string, RateLimitEntry>();
  private isErrorMicrotaskPending = false;
  private isFlushing = false;
  private flushRetryCount = 0;
  private flushRetryTimerId: ReturnType<typeof setTimeout> | null = null;
  private cachedQueue: QueuedTelemetryItem[] | null = null;
  private isDiskSyncScheduled = false;
  private originalOnError?: typeof window.onerror;

  private constructor() {
    this.inMemorySessionId = this.getOrCreateSessionId();
  }

  public static getInstance(): TelemetryHub {
    if (!TelemetryHub.instance) {
      TelemetryHub.instance = new TelemetryHub();
    }
    return TelemetryHub.instance;
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Warm up context and sanitizer
    getTelemetryContext();
    this.getUserId();
    this.getSessionId();
    scrubPII('');
    truncateStack('');

    if (typeof window !== 'undefined') {
      window.addEventListener('error', this.handleWindowError, false);
      window.addEventListener('unhandledrejection', this.handleUnhandledRejection, false);
      window.addEventListener('online', this.handleOnlineEvent, false);

      this.originalOnError = window.onerror;
      window.onerror = (event, source, lineno, colno, error) => {
        try {
          const err = error || new Error(typeof event === 'string' ? event : 'Script error.');
          this.trackError(err, { source: 'window_error' });
        } catch {
          // Ignore
        }
        if (typeof this.originalOnError === 'function') {
          return this.originalOnError(event, source, lineno, colno, error);
        }
        return false;
      };

      if (!this.isOffline()) {
        this.flushQueue().catch(() => {});
      }
    }
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('error', this.handleWindowError, false);
      window.removeEventListener('unhandledrejection', this.handleUnhandledRejection, false);
      window.removeEventListener('online', this.handleOnlineEvent, false);
      if (this.originalOnError !== undefined) {
        window.onerror = this.originalOnError;
        this.originalOnError = undefined;
      }
    }
    this.clearRateLimiters();
    if (this.flushRetryTimerId) {
      clearTimeout(this.flushRetryTimerId);
      this.flushRetryTimerId = null;
    }
    this.flushRetryCount = 0;
    this.isFlushing = false;
    this.inFlightFlushPromise = null;
    this.cachedQueue = null;
    this.isDiskSyncScheduled = false;
    TelemetryHub.hashCache.clear();
    this.initialized = false;
    this.customUserId = undefined;
    this.cachedUserId = 'anonymous';
    this.cachedUserIdTime = 0;
    this.inMemorySessionId = null;
    this.isErrorMicrotaskPending = false;
  }

  public reset(): void {
    this.destroy();
  }

  private handleWindowError = (event: ErrorEvent): void => {
    try {
      const error = event.error || new Error(event.message || 'Window error');
      this.trackError(error, { source: 'window_error' });
    } catch {
      // Ignore
    }
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    try {
      const reason = event.reason;
      const error =
        reason instanceof Error
          ? reason
          : new Error(typeof reason === 'string' ? reason : typeof reason === 'number' ? String(reason) : 'Unhandled rejection');
      this.trackError(error, { source: 'unhandled_rejection' });
    } catch {
      // Ignore
    }
  };

  private handleOnlineEvent = (): void => {
    this.flushQueue().catch(() => {});
  };

  public setUserId(userId: string | null | undefined): void {
    this.customUserId = userId;
    this.cachedUserId = userId !== undefined ? userId : 'anonymous';
    this.cachedUserIdTime = userId !== undefined ? Date.now() + 100000 : 0;
  }

  public getUserId(): string | null {
    if (this.customUserId !== undefined) {
      return this.customUserId;
    }
    const now = Date.now();
    if (now - this.cachedUserIdTime < 1000) {
      return this.cachedUserId;
    }
    this.cachedUserIdTime = now;
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('logbook_is_guest') === 'true') {
        this.cachedUserId = null;
        return null;
      }
      if (typeof auth !== 'undefined' && auth && auth.currentUser) {
        this.cachedUserId = auth.currentUser.uid;
        return auth.currentUser.uid;
      }
    } catch {
      // Ignore
    }
    this.cachedUserId = 'anonymous';
    return 'anonymous';
  }

  public getSessionId(): string {
    if (this.inMemorySessionId) {
      return this.inMemorySessionId;
    }
    return this.getOrCreateSessionId();
  }

  private getOrCreateSessionId(): string {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(SESSION_ID_KEY);
        if (stored) {
          this.inMemorySessionId = stored;
          return stored;
        }
        const newId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        sessionStorage.setItem(SESSION_ID_KEY, newId);
        this.inMemorySessionId = newId;
        return newId;
      }
    } catch {
      // Fallback
    }
    if (!this.inMemorySessionId) {
      this.inMemorySessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }
    return this.inMemorySessionId;
  }

  private isOffline(): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return !navigator.onLine;
    }
    return false;
  }

  private updateQueuedErrorCount(id?: string, count: number = 1, lastSeen: number = Date.now()): void {
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
      if (found) {
        if (!this.isDiskSyncScheduled) {
          this.isDiskSyncScheduled = true;
          queueMicrotask(() => {
            this.isDiskSyncScheduled = false;
            this.syncQueueToDisk();
            this.cachedQueue = null;
          });
        }
      }
    } catch {
      // Ignore
    }
  }

  public trackError(error: unknown, options: TrackErrorOptions = {}): void {
    try {
      const now = Date.now();

      // Fast check for active rate limiter to optimize hot loops (< 100ms for 1000 calls)
      const fastType = (error instanceof Error ? error.name : typeof error === 'string' ? 'Error' : 'UnknownError') || 'Error';
      let fastMsg = options.customMessage || (typeof error === 'string' ? error : (error as any)?.message);
      if (!fastMsg && (error as any)?.issues && Array.isArray((error as any).issues)) {
        const issues = (error as any).issues;
        if (issues.length > 0) {
          fastMsg = issues
            .map((iss: any) => {
              const p = Array.isArray(iss.path) ? iss.path.join('.') : '';
              return `${p ? `${p}: ` : ''}${iss.message || iss.code}`;
            })
            .join('; ');
        }
      }

      let fastHash: string | undefined;
      let fastScrubbed: string | undefined;

      if (fastMsg) {
        const cacheKey = fastType + ':' + fastMsg;
        const cached = TelemetryHub.hashCache.get(cacheKey);
        if (cached) {
          fastHash = cached.hash;
          fastScrubbed = cached.scrubbed;
        } else {
          fastScrubbed = scrubPII(fastMsg);
          fastHash = computeErrorHash(fastType, fastScrubbed);
          if (TelemetryHub.hashCache.size >= 512) {
            const firstKey = TelemetryHub.hashCache.keys().next().value;
            if (firstKey) TelemetryHub.hashCache.delete(firstKey);
          }
          TelemetryHub.hashCache.set(cacheKey, { hash: fastHash, scrubbed: fastScrubbed });
        }

        const activeEntry = this.activeRateLimiters.get(fastHash);

        if (activeEntry && now - activeEntry.firstSeen < RATE_LIMIT_WINDOW_MS) {
          activeEntry.count += 1;
          activeEntry.lastSeen = now;
          activeEntry.payload.count = activeEntry.count;
          activeEntry.payload.lastSeen = now;

          if (!activeEntry.timerId) {
            const remaining = Math.max(0, RATE_LIMIT_WINDOW_MS - (now - activeEntry.firstSeen));
            activeEntry.timerId = setTimeout(() => {
              this.onRateLimitWindowExpiry(fastHash!);
            }, remaining);
          }

          if (this.isOffline()) {
            this.updateQueuedErrorCount(activeEntry.payload.id, activeEntry.count, activeEntry.lastSeen);
          }
          return;
        }

        if (activeEntry && now - activeEntry.firstSeen >= RATE_LIMIT_WINDOW_MS) {
          if (activeEntry.timerId) clearTimeout(activeEntry.timerId);
          this.activeRateLimiters.delete(fastHash);
        }
      }

      if (error instanceof Error && !options.customMessage && fastHash && fastScrubbed !== undefined) {
        const errorId = 'err_' + fastHash;
        const uid = this.customUserId !== undefined ? this.customUserId : this.getUserId();
        const sessId = this.inMemorySessionId || this.getSessionId();
        const ctx = getTelemetryContext();

        let _stack: string | undefined;
        let _compStack: string | undefined;
        const errObj = error;
        const compStackOpt = options.componentStack;

        const payload: TelemetryErrorPayload = {
          timestamp: now,
          id: errorId,
          hash: fastHash,
          type: fastType,
          message: fastScrubbed,
          source: (options.source || 'custom') as ErrorSource,
          context: ctx,
          userId: uid,
          sessionId: sessId,
          count: 1,
          firstSeen: now,
          lastSeen: now,
          get stack(): string | undefined {
            if (_stack === undefined) {
              const raw = (errObj as any).stack;
              if (raw && typeof raw === 'string') {
                _stack = truncateStack(raw, 1000);
              }
            }
            return _stack;
          },
          set stack(val: string | undefined) {
            _stack = val;
          },
          get componentStack(): string | undefined {
            if (_compStack === undefined && compStackOpt) {
              _compStack = truncateStack(compStackOpt, 1000);
            }
            return _compStack;
          },
          set componentStack(val: string | undefined) {
            _compStack = val;
          },
        };

        const newEntry: RateLimitEntry = {
          hash: fastHash,
          count: 1,
          firstSeen: now,
          lastSeen: now,
          payload,
          timerId: null,
          lastDispatchedCount: 0,
          isDispatchPending: true,
        };

        if (this.activeRateLimiters.size >= MAX_ACTIVE_RATE_LIMITERS) {
          const oldestKey = this.activeRateLimiters.keys().next().value;
          if (oldestKey) {
            const entry = this.activeRateLimiters.get(oldestKey);
            if (entry?.timerId) clearTimeout(entry.timerId);
            this.activeRateLimiters.delete(oldestKey);
          }
        }

        this.activeRateLimiters.set(fastHash, newEntry);

        if (this.isOffline()) {
          newEntry.isDispatchPending = false;
          newEntry.lastDispatchedCount = newEntry.count;
          this.enqueueItem('error', newEntry.payload);
        } else if (!this.isErrorMicrotaskPending) {
          this.isErrorMicrotaskPending = true;
          queueMicrotask(() => {
            this.isErrorMicrotaskPending = false;
            this.flushPendingDispatches();
          });
        }
        return;
      }

      const sanitized = sanitizeErrorPayload(error, {
        ...options,
        preScrubbedMessage: fastScrubbed || undefined,
      });
      const hash = fastHash || computeErrorHash(sanitized.type, sanitized.message);

      let activeEntry = fastHash ? undefined : this.activeRateLimiters.get(hash);

      if (activeEntry && now - activeEntry.firstSeen >= RATE_LIMIT_WINDOW_MS) {
        if (activeEntry.timerId) clearTimeout(activeEntry.timerId);
        this.activeRateLimiters.delete(hash);
        activeEntry = undefined;
      }

      if (!activeEntry) {
        const errorId = 'err_' + hash;
        const payload: TelemetryErrorPayload = {
          timestamp: now,
          id: errorId,
          hash,
          type: sanitized.type,
          message: sanitized.message,
          source: (options.source || sanitized.source || 'custom') as ErrorSource,
          context: getTelemetryContext(),
          userId: this.getUserId(),
          sessionId: this.getSessionId(),
          count: 1,
          firstSeen: now,
          lastSeen: now,
        };

        if (sanitized.stack) {
          payload.stack = sanitized.stack;
        }
        if (sanitized.componentStack) {
          payload.componentStack = sanitized.componentStack;
        }

        const newEntry: RateLimitEntry = {
          hash,
          count: 1,
          firstSeen: now,
          lastSeen: now,
          payload,
          timerId: null,
          lastDispatchedCount: 0,
          isDispatchPending: true,
        };

        if (this.activeRateLimiters.size >= MAX_ACTIVE_RATE_LIMITERS) {
          const oldestKey = this.activeRateLimiters.keys().next().value;
          if (oldestKey) {
            const entry = this.activeRateLimiters.get(oldestKey);
            if (entry?.timerId) clearTimeout(entry.timerId);
            this.activeRateLimiters.delete(oldestKey);
          }
        }

        this.activeRateLimiters.set(hash, newEntry);

        if (this.isOffline()) {
          newEntry.isDispatchPending = false;
          newEntry.lastDispatchedCount = newEntry.count;
          this.enqueueItem('error', newEntry.payload);
        } else if (!this.isErrorMicrotaskPending) {
          this.isErrorMicrotaskPending = true;
          queueMicrotask(() => {
            this.isErrorMicrotaskPending = false;
            this.flushPendingDispatches();
          });
        }
      } else {
        activeEntry.count += 1;
        activeEntry.lastSeen = now;
        activeEntry.payload.count = activeEntry.count;
        activeEntry.payload.lastSeen = activeEntry.lastSeen;

        if (!activeEntry.timerId) {
          const remaining = Math.max(0, RATE_LIMIT_WINDOW_MS - (now - activeEntry.firstSeen));
          activeEntry.timerId = setTimeout(() => {
            this.onRateLimitWindowExpiry(hash);
          }, remaining);
        }

        if (this.isOffline()) {
          this.updateQueuedErrorCount(activeEntry.payload.id, activeEntry.count, activeEntry.lastSeen);
        }
      }
    } catch (err) {
      console.warn('[TelemetryHub] trackError failed silently:', err);
    }
  }

  private flushPendingDispatches(): void {
    for (const entry of this.activeRateLimiters.values()) {
      if (entry.isDispatchPending) {
        entry.isDispatchPending = false;
        entry.lastDispatchedCount = entry.count;
        this.dispatchErrorToFirestore(entry.payload).catch(() => {});
      }
    }
  }

  private onRateLimitWindowExpiry(hash: string): void {
    const entry = this.activeRateLimiters.get(hash);
    if (!entry) return;

    this.activeRateLimiters.delete(hash);

    if (entry.count > entry.lastDispatchedCount) {
      entry.lastDispatchedCount = entry.count;
      if (this.isOffline()) {
        this.enqueueItem('error', entry.payload);
      } else {
        this.dispatchErrorToFirestore(entry.payload).catch(() => {});
      }
    }
  }

  public clearRateLimiters(): void {
    for (const entry of this.activeRateLimiters.values()) {
      if (entry.timerId) clearTimeout(entry.timerId);
    }
    this.activeRateLimiters.clear();
  }

  public async flushRateLimiters(): Promise<void> {
    const entries = Array.from(this.activeRateLimiters.values());
    this.clearRateLimiters();

    for (const entry of entries) {
      if (entry.count > entry.lastDispatchedCount) {
        entry.lastDispatchedCount = entry.count;
        if (this.isOffline()) {
          this.enqueueItem('error', entry.payload);
        } else {
          await this.dispatchErrorToFirestore(entry.payload);
        }
      }
    }
  }

  public getActiveRateLimiterCount(): number {
    return this.activeRateLimiters.size;
  }

  public trackEvent(type: TelemetryEventType | string, details?: Record<string, any>): void {
    try {
      const now = Date.now();
      const eventId = `evt_${now}_${Math.random().toString(36).slice(2, 9)}`;
      const context = getTelemetryContext();
      const payload: TelemetryEventPayload = {
        timestamp: now,
        id: eventId,
        type: type as TelemetryEventType,
        context,
        userId: this.getUserId(),
        sessionId: this.getSessionId(),
      };
      if (details && typeof details === 'object') {
        payload.details = details;
      }

      if (this.isOffline()) {
        this.enqueueItem('event', payload);
      } else {
        queueMicrotask(() => {
          this.dispatchEventToFirestore(payload)
            .then((success) => {
              if (!success) {
                this.enqueueItem('event', payload);
              }
            })
            .catch(() => {
              this.enqueueItem('event', payload);
            });
        });
      }
    } catch (err) {
      console.warn('[TelemetryHub] trackEvent failed silently:', err);
    }
  }

  public getQueuedEvents(): QueuedTelemetryItem[] {
    if (this.cachedQueue !== null) {
      return this.cachedQueue;
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
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
      // Corrupted JSON or parsing error -> return empty array
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
        localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(itemsToSave));
      }
    } catch {
      // QuotaExceededError or SecurityError caught safely
    }
  }

  private enqueueItem(kind: 'error' | 'event', payload: TelemetryErrorPayload | TelemetryEventPayload): void {
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
      // Ignore
    }
  }

  private inFlightFlushPromise: Promise<void> | null = null;

  public async flushQueue(): Promise<void> {
    if (this.isFlushing) {
      return this.inFlightFlushPromise || Promise.resolve();
    }

    if (this.isDiskSyncScheduled) {
      this.isDiskSyncScheduled = false;
      this.syncQueueToDisk();
      this.cachedQueue = null;
    }

    const items = this.getQueuedEvents();
    if (items.length === 0) {
      return;
    }

    this.isFlushing = true;
    const flushPromise = (async () => {
      try {
        await this.executeFlushQueue(items);
      } finally {
        this.isFlushing = false;
        this.inFlightFlushPromise = null;
      }
    })();
    this.inFlightFlushPromise = flushPromise;
    return flushPromise;
  }

  private async executeFlushQueue(items: QueuedTelemetryItem[]): Promise<void> {
    try {
      const successfullyDispatchedIds = new Set<string>();
      const itemsToRetainWithRetry: QueuedTelemetryItem[] = [];
      let consecutiveFailures = 0;
      let processedCount = 0;

      for (const item of items) {
        if (!item || !item.payload || typeof item.payload !== 'object') {
          if (item?.id) {
            successfullyDispatchedIds.add(item.id);
          }
          continue;
        }

        if (consecutiveFailures >= 2) {
          // Circuit breaker tripped after consecutive failures
          break;
        }

        if (!item.payload.userId || item.payload.userId === 'anonymous') {
          const currentUid = this.getUserId();
          if (currentUid && currentUid !== 'anonymous') {
            item.payload.userId = currentUid;
          }
        }

        let success = false;
        if (item.itemType === 'error') {
          success = await this.dispatchErrorToFirestore(item.payload as TelemetryErrorPayload);
        } else {
          success = await this.dispatchEventToFirestore(item.payload as TelemetryEventPayload);
        }

        processedCount++;

        if (success) {
          consecutiveFailures = 0;
          if (item.id) {
            successfullyDispatchedIds.add(item.id);
          }
        } else {
          consecutiveFailures++;
          const currentRetries = (item.retryCount || 0) + 1;
          if (currentRetries > MAX_ITEM_RETRIES) {
            console.warn('[TelemetryHub] Evicting poison pill item after max retries:', item.id);
            if (item.id) {
              successfullyDispatchedIds.add(item.id);
            }
          } else {
            item.retryCount = currentRetries;
            itemsToRetainWithRetry.push(item);
          }
          if (consecutiveFailures >= 2) {
            break;
          }
        }

        if (processedCount > 0 && processedCount % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      this.cachedQueue = null;
      const currentLiveQueue = this.getQueuedEvents();
      const updatedQueue: QueuedTelemetryItem[] = [];

      for (const liveItem of currentLiveQueue) {
        if (!liveItem || !liveItem.id || successfullyDispatchedIds.has(liveItem.id)) {
          continue;
        }
        const retryMatch = itemsToRetainWithRetry.find((r) => r.id === liveItem.id);
        if (retryMatch) {
          updatedQueue.push(retryMatch);
        } else {
          updatedQueue.push(liveItem);
        }
      }

      this.saveQueuedEvents(updatedQueue, true);

      if (updatedQueue.length === 0) {
        this.flushRetryCount = 0;
        if (this.flushRetryTimerId) {
          clearTimeout(this.flushRetryTimerId);
          this.flushRetryTimerId = null;
        }
      } else if (!this.isOffline() && consecutiveFailures > 0) {
        this.scheduleExponentialBackoff();
      }
    } catch (err) {
      console.warn('[TelemetryHub] flushQueue failed silently:', err);
    }
  }

  private scheduleExponentialBackoff(): void {
    if (this.flushRetryTimerId) return;
    this.flushRetryCount = Math.min(5, this.flushRetryCount + 1);
    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      INITIAL_RETRY_DELAY_MS * Math.pow(2, this.flushRetryCount - 1)
    );
    this.flushRetryTimerId = setTimeout(() => {
      this.flushRetryTimerId = null;
      this.flushQueue().catch(() => {});
    }, delay);
  }

  public async dispatchErrorToFirestore(payload: TelemetryErrorPayload): Promise<boolean> {
    try {
      const uid = payload.userId || this.getUserId();
      if (!uid || uid === 'anonymous') {
        return false;
      }

      const errorId = payload.id || `err_${payload.hash || computeErrorHash(payload.type, payload.message)}`;
      await ensureAppCheck();
      const docRef = doc(getDb(), 'users', uid, 'telemetry_errors', errorId);

      const firestorePayload: Record<string, any> = {
        timestamp: payload.timestamp || payload.firstSeen || Date.now(),
        type: payload.type,
        message: payload.message,
        context: payload.context,
        userId: uid,
        sessionId: payload.sessionId,
        count: payload.count,
        firstSeen: payload.firstSeen,
        lastSeen: payload.lastSeen,
        source: payload.source,
      };

      if (payload.stack) {
        firestorePayload.stack = payload.stack;
      }
      if (payload.componentStack) {
        firestorePayload.componentStack = payload.componentStack;
      }

      const writePromise = setDoc(docRef, firestorePayload, { merge: true });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Telemetry error dispatch timeout')), FIRESTORE_DISPATCH_TIMEOUT_MS)
      );

      await Promise.race([writePromise, timeoutPromise]);
      return true;
    } catch (err) {
      console.warn('[TelemetryHub] dispatchErrorToFirestore failed non-blockingly:', err);
      return false;
    }
  }

  public async dispatchEventToFirestore(payload: TelemetryEventPayload): Promise<boolean> {
    try {
      const uid = payload.userId || this.getUserId();
      if (!uid || uid === 'anonymous') {
        return false;
      }

      const eventId = payload.id || `evt_${payload.timestamp}_${Math.random().toString(36).slice(2, 9)}`;
      await ensureAppCheck();
      const docRef = doc(getDb(), 'users', uid, 'telemetry_events', eventId);

      const firestorePayload: Record<string, any> = {
        timestamp: payload.timestamp,
        type: payload.type,
        context: payload.context,
        userId: uid,
        sessionId: payload.sessionId,
      };

      if (payload.details !== undefined) {
        firestorePayload.details = payload.details;
      }

      const writePromise = setDoc(docRef, firestorePayload, { merge: true });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Telemetry event dispatch timeout')), FIRESTORE_DISPATCH_TIMEOUT_MS)
      );

      await Promise.race([writePromise, timeoutPromise]);
      return true;
    } catch (err) {
      console.warn('[TelemetryHub] dispatchEventToFirestore failed non-blockingly:', err);
      return false;
    }
  }

  // PWA Install Funnel Analytics Helpers
  public trackPWAImpression(details?: Record<string, any>): void {
    this.trackEvent('pwa_install_impression', details);
  }

  public trackPWAInstallClick(details?: Record<string, any>): void {
    this.trackEvent('pwa_install_click', details);
  }

  public trackPWAOutcome(outcome: 'accepted' | 'dismissed', details?: Record<string, any>): void {
    this.trackEvent('pwa_install_prompt_outcome', { outcome, ...details });
  }

  public trackPWAInstalled(details?: Record<string, any>): void {
    this.trackEvent('pwa_appinstalled', details);
  }

  // Offline Workout Lifecycle Analytics Helpers
  public trackWorkoutStarted(details: {
    offline?: boolean;
    routineId?: string | null;
    routineName?: string | null;
    [key: string]: any;
  }): void {
    const isOff = details.offline !== undefined ? details.offline : this.isOffline();
    this.trackEvent('workout_started', {
      ...details,
      offline: isOff,
      routineId: details.routineId ?? null,
      routineName: details.routineName ?? null,
    });
  }

  public trackWorkoutSaved(details: {
    offline?: boolean;
    duration?: string | number;
    exerciseCount?: number;
    [key: string]: any;
  }): void {
    const isOff = details.offline !== undefined ? details.offline : this.isOffline();
    this.trackEvent('workout_saved', {
      ...details,
      offline: isOff,
    });
  }
}

export const telemetryHub = TelemetryHub.getInstance();
