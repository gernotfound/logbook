import * as Sentry from '@sentry/react';
import type { TelemetryErrorPayload, TelemetryEventPayload } from './telemetry/contracts';
import { scrubPII } from './telemetrySanitizer';

type StorageAnomalyPayload = {
  type: 'storage_recovery_anomaly';
  reason: string;
  timestamp: number;
  elapsedMs: number;
  platform: 'ios' | 'ipados' | 'other';
  standalone: boolean;
  persisted: boolean | null;
};

type SentryTelemetryKind = 'error' | 'event' | 'storage-anomaly';
type SentryTelemetryPayload = TelemetryErrorPayload | TelemetryEventPayload | StorageAnomalyPayload;

let sentryInitialized = false;

function safeBuildSha(): string {
  return typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__.length > 0 ? __BUILD_SHA__ : 'dev';
}

function sanitizeTag(value: unknown, maxLength = 80): string {
  return scrubPII(typeof value === 'string' ? value : String(value ?? '')).slice(0, maxLength);
}

export function initSentry(): boolean {
  if (sentryInitialized) return true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !import.meta.env.PROD) return false;

  Sentry.init({
    dsn,
    environment: 'production',
    release: safeBuildSha(),
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    defaultIntegrations: false,
    beforeSend(event) {
      // LogBook sends only its deliberately minimized technical context.
      delete event.user;
      delete event.request;
      delete event.breadcrumbs;
      delete event.transaction;
      delete event.extra;

      const logbookContext = event.contexts?.logbook;
      event.contexts = logbookContext ? { logbook: logbookContext } : undefined;

      if (event.message) event.message = scrubPII(event.message).slice(0, 500);
      for (const value of event.exception?.values ?? []) {
        if (value.type) value.type = sanitizeTag(value.type);
        if (value.value) value.value = scrubPII(value.value).slice(0, 500);
      }

      return event;
    },
  });

  sentryInitialized = true;
  return true;
}

export function isSentryInitialized(): boolean {
  return sentryInitialized;
}

function captureError(payload: TelemetryErrorPayload): boolean {
  if (!sentryInitialized) return false;

  const error = new Error(payload.message);
  error.name = sanitizeTag(payload.type) || 'Error';
  if (payload.stack) error.stack = payload.stack;

  Sentry.withScope((scope) => {
    scope.setFingerprint([payload.hash || `${error.name}:${payload.message}`]);
    scope.setTag('source', sanitizeTag(payload.source));
    scope.setTag('app_version', sanitizeTag(payload.context.appVersion));
    scope.setTag('build_sha', safeBuildSha());
    scope.setTag('platform', payload.context.platform);
    scope.setTag('display_mode', payload.context.displayMode);
    scope.setTag('online', String(payload.context.online));
    scope.setContext('logbook', {
      sessionId: sanitizeTag(payload.sessionId, 120),
      occurrenceCount: payload.count,
      firstSeen: payload.firstSeen,
      lastSeen: payload.lastSeen,
      componentStack: payload.componentStack ? scrubPII(payload.componentStack).slice(0, 1000) : undefined,
    });
    Sentry.captureException(error);
  });

  return true;
}

function captureStorageAnomaly(payload: StorageAnomalyPayload): boolean {
  if (!sentryInitialized) return false;

  const reason = scrubPII(payload.reason).slice(0, 160);
  const error = new Error(`Storage recovery anomaly: ${reason}`);
  error.name = 'StorageRecoveryAnomaly';

  Sentry.withScope((scope) => {
    scope.setFingerprint(['storage-recovery-anomaly', reason]);
    scope.setTag('source', 'storage_recovery');
    scope.setTag('build_sha', safeBuildSha());
    scope.setTag('platform', payload.platform);
    scope.setTag('display_mode', payload.standalone ? 'standalone' : 'browser');
    scope.setContext('logbook', {
      reason,
      elapsedMs: payload.elapsedMs,
      persisted: payload.persisted,
      timestamp: payload.timestamp,
    });
    Sentry.captureException(error);
  });

  return true;
}

/**
 * Single external telemetry boundary.
 *
 * "event" is intentionally accepted-and-dropped: LogBook uses Sentry only for
 * error/anomaly monitoring, not behavioral events, logs, tracing or metrics.
 */
export async function sendTelemetryToSentry(
  kind: SentryTelemetryKind,
  payload: SentryTelemetryPayload,
): Promise<boolean> {
  try {
    if (kind === 'event') return true;
    if (kind === 'storage-anomaly') return captureStorageAnomaly(payload as StorageAnomalyPayload);
    return captureError(payload as TelemetryErrorPayload);
  } catch (error) {
    console.warn('[Sentry] Invio telemetria fallito (non bloccante):', error);
    return false;
  }
}
