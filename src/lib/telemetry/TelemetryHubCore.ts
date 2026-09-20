/**
 * LogBook - Unified Telemetry Hub orchestration.
 *
 * Public consumers import through ../telemetryHub; this module keeps the
 * stateful orchestration while storage, transport, identity and rate-limit
 * responsibilities live in focused collaborators.
 */

import {
  computeErrorHash,
  sanitizeErrorPayload,
  scrubPII,
  truncateStack,
  getTelemetryContext,
} from '../telemetrySanitizer';
import {
  MAX_ITEM_RETRIES,
  RATE_LIMIT_WINDOW_MS,
  type ErrorSource,
  type QueuedTelemetryItem,
  type RateLimitEntry,
  type TelemetryErrorPayload,
  type TelemetryEventPayload,
  type TelemetryEventType,
  type TrackErrorOptions,
} from './contracts';
import { createTelemetryId } from './id';
import {
  isTelemetryOffline,
  TelemetryRateLimitState,
  TelemetrySessionState,
} from './sessionRateLimit';
import { TelemetryQueueStorage } from './queueStorage';
import {
  dispatchTelemetryError,
  dispatchTelemetryEvent,
  TelemetryRetryScheduler,
} from './transportRetry';

export class TelemetryHub {
  private static instance: TelemetryHub | null = null;

  private initialized = false;
  private readonly session = new TelemetrySessionState();
  private readonly rateLimits = new TelemetryRateLimitState();
  private readonly queue = new TelemetryQueueStorage(() => this.getUserId());
  private readonly retryScheduler = new TelemetryRetryScheduler();
  private isErrorMicrotaskPending = false;
  private isFlushing = false;
  private inFlightFlushPromise: Promise<void> | null = null;
  private originalOnError?: typeof window.onerror;

  private constructor() {}

  public static getInstance(): TelemetryHub {
    if (!TelemetryHub.instance) {
      TelemetryHub.instance = new TelemetryHub();
    }
    return TelemetryHub.instance;
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;

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

    this.rateLimits.reset();
    this.retryScheduler.clear();
    this.isFlushing = false;
    this.inFlightFlushPromise = null;
    this.queue.reset();
    this.initialized = false;
    this.session.reset();
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
          : new Error(
              typeof reason === 'string'
                ? reason
                : typeof reason === 'number'
                  ? String(reason)
                  : 'Unhandled rejection'
            );
      this.trackError(error, { source: 'unhandled_rejection' });
    } catch {
      // Ignore
    }
  };

  private handleOnlineEvent = (): void => {
    this.flushQueue().catch(() => {});
  };

  public setUserId(userId: string | null | undefined): void {
    this.session.setUserId(userId);
  }

  public getUserId(): string | null {
    return this.session.getUserId();
  }

  public getSessionId(): string {
    return this.session.getSessionId();
  }

  private isOffline(): boolean {
    return isTelemetryOffline();
  }

  public trackError(error: unknown, options: TrackErrorOptions = {}): void {
    try {
      const now = Date.now();

      const fastType =
        (error instanceof Error
          ? error.name
          : typeof error === 'string'
            ? 'Error'
            : 'UnknownError') || 'Error';

      let fastMsg =
        options.customMessage ||
        (typeof error === 'string' ? error : (error as any)?.message);

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
        const fingerprint = this.rateLimits.getFingerprint(fastType, fastMsg);
        fastHash = fingerprint.hash;
        fastScrubbed = fingerprint.scrubbed;

        const activeEntry = this.rateLimits.getActive(fastHash, now);
        if (activeEntry) {
          activeEntry.count += 1;
          activeEntry.lastSeen = now;
          activeEntry.payload.count = activeEntry.count;
          activeEntry.payload.lastSeen = now;

          if (!activeEntry.timerId) {
            const remaining = Math.max(
              0,
              RATE_LIMIT_WINDOW_MS - (now - activeEntry.firstSeen)
            );
            activeEntry.timerId = setTimeout(() => {
              this.onRateLimitWindowExpiry(fastHash!);
            }, remaining);
          }

          if (this.isOffline()) {
            this.queue.updateQueuedErrorCount(
              activeEntry.payload.id,
              activeEntry.count,
              activeEntry.lastSeen
            );
          }
          return;
        }
      }

      if (
        error instanceof Error &&
        !options.customMessage &&
        fastHash &&
        fastScrubbed !== undefined
      ) {
        const errorId = `err_${fastHash}`;
        const uid = this.getUserId();
        const sessId = this.getSessionId();
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

        this.rateLimits.add(fastHash, newEntry);

        if (this.isOffline()) {
          newEntry.isDispatchPending = false;
          newEntry.lastDispatchedCount = newEntry.count;
          this.queue.enqueueItem('error', newEntry.payload);
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

      let activeEntry = fastHash
        ? undefined
        : this.rateLimits.getActive(hash, now);

      if (!activeEntry) {
        const errorId = `err_${hash}`;
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

        this.rateLimits.add(hash, newEntry);

        if (this.isOffline()) {
          newEntry.isDispatchPending = false;
          newEntry.lastDispatchedCount = newEntry.count;
          this.queue.enqueueItem('error', newEntry.payload);
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
          const remaining = Math.max(
            0,
            RATE_LIMIT_WINDOW_MS - (now - activeEntry.firstSeen)
          );
          activeEntry.timerId = setTimeout(() => {
            this.onRateLimitWindowExpiry(hash);
          }, remaining);
        }

        if (this.isOffline()) {
          this.queue.updateQueuedErrorCount(
            activeEntry.payload.id,
            activeEntry.count,
            activeEntry.lastSeen
          );
        }
      }
    } catch (err) {
      console.warn('[TelemetryHub] trackError failed silently:', err);
    }
  }

  private flushPendingDispatches(): void {
    for (const entry of this.rateLimits.values()) {
      if (entry.isDispatchPending) {
        entry.isDispatchPending = false;
        entry.lastDispatchedCount = entry.count;
        this.dispatchErrorToFirestore(entry.payload).catch(() => {});
      }
    }
  }

  private onRateLimitWindowExpiry(hash: string): void {
    const entry = this.rateLimits.get(hash);
    if (!entry) return;

    this.rateLimits.delete(hash);

    if (entry.count > entry.lastDispatchedCount) {
      entry.lastDispatchedCount = entry.count;
      if (this.isOffline()) {
        this.queue.enqueueItem('error', entry.payload);
      } else {
        this.dispatchErrorToFirestore(entry.payload).catch(() => {});
      }
    }
  }

  public clearRateLimiters(): void {
    this.rateLimits.clear();
  }

  public async flushRateLimiters(): Promise<void> {
    const entries = this.rateLimits.takeAll();

    for (const entry of entries) {
      if (entry.count > entry.lastDispatchedCount) {
        entry.lastDispatchedCount = entry.count;
        if (this.isOffline()) {
          this.queue.enqueueItem('error', entry.payload);
        } else {
          await this.dispatchErrorToFirestore(entry.payload);
        }
      }
    }
  }

  public getActiveRateLimiterCount(): number {
    return this.rateLimits.count;
  }

  public trackEvent(
    type: TelemetryEventType | string,
    details?: Record<string, any>
  ): void {
    try {
      const now = Date.now();
      const eventId = createTelemetryId('evt', now);
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
        this.queue.enqueueItem('event', payload);
      } else {
        queueMicrotask(() => {
          this.dispatchEventToFirestore(payload)
            .then((success) => {
              if (!success) {
                this.queue.enqueueItem('event', payload);
              }
            })
            .catch(() => {
              this.queue.enqueueItem('event', payload);
            });
        });
      }
    } catch (err) {
      console.warn('[TelemetryHub] trackEvent failed silently:', err);
    }
  }

  public getQueueStorageKey(): string {
    return this.queue.getQueueStorageKey();
  }

  public getQueuedEvents(): QueuedTelemetryItem[] {
    return this.queue.getQueuedEvents();
  }

  public async flushQueue(): Promise<void> {
    if (this.isFlushing) {
      return this.inFlightFlushPromise || Promise.resolve();
    }

    this.queue.flushPendingDiskSync();

    const items = this.queue.getQueuedEvents();
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
          break;
        }

        if (
          !item.payload.userId ||
          item.payload.userId === 'anonymous' ||
          item.payload.userId !== this.getUserId()
        ) {
          continue;
        }

        let success = false;
        if (item.itemType === 'error') {
          success = await this.dispatchErrorToFirestore(
            item.payload as TelemetryErrorPayload
          );
        } else {
          success = await this.dispatchEventToFirestore(
            item.payload as TelemetryEventPayload
          );
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
            console.warn(
              '[TelemetryHub] Evicting poison pill item after max retries:',
              item.id
            );
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

      this.queue.invalidateCache();
      const currentLiveQueue = this.queue.getQueuedEvents();
      const updatedQueue: QueuedTelemetryItem[] = [];

      for (const liveItem of currentLiveQueue) {
        if (
          !liveItem ||
          !liveItem.id ||
          successfullyDispatchedIds.has(liveItem.id)
        ) {
          continue;
        }

        const retryMatch = itemsToRetainWithRetry.find(
          (candidate) => candidate.id === liveItem.id
        );
        if (retryMatch) {
          updatedQueue.push(retryMatch);
        } else {
          updatedQueue.push(liveItem);
        }
      }

      this.queue.replaceQueue(updatedQueue);

      if (updatedQueue.length === 0) {
        this.retryScheduler.clear();
      } else if (!this.isOffline() && consecutiveFailures > 0) {
        this.scheduleExponentialBackoff();
      }
    } catch (err) {
      console.warn('[TelemetryHub] flushQueue failed silently:', err);
    }
  }

  private scheduleExponentialBackoff(): void {
    this.retryScheduler.schedule(() => {
      this.flushQueue().catch(() => {});
    });
  }

  public async dispatchErrorToFirestore(
    payload: TelemetryErrorPayload
  ): Promise<boolean> {
    return dispatchTelemetryError(payload, () => this.getUserId());
  }

  public async dispatchEventToFirestore(
    payload: TelemetryEventPayload
  ): Promise<boolean> {
    return dispatchTelemetryEvent(payload, () => this.getUserId());
  }

  public trackPWAImpression(details?: Record<string, any>): void {
    this.trackEvent('pwa_install_impression', details);
  }

  public trackPWAInstallClick(details?: Record<string, any>): void {
    this.trackEvent('pwa_install_click', details);
  }

  public trackPWAOutcome(
    outcome: 'accepted' | 'dismissed',
    details?: Record<string, any>
  ): void {
    this.trackEvent('pwa_install_prompt_outcome', { outcome, ...details });
  }

  public trackPWAInstalled(details?: Record<string, any>): void {
    this.trackEvent('pwa_appinstalled', details);
  }

  public trackWorkoutStarted(details: {
    offline?: boolean;
    routineId?: string | null;
    routineName?: string | null;
    [key: string]: any;
  }): void {
    const isOff =
      details.offline !== undefined ? details.offline : this.isOffline();
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
    const isOff =
      details.offline !== undefined ? details.offline : this.isOffline();
    this.trackEvent('workout_saved', {
      ...details,
      offline: isOff,
    });
  }
}
