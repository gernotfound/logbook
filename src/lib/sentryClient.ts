import * as Sentry from '@sentry/react';
import type { TelemetryErrorPayload } from './telemetry/contracts';

type StorageAnomalyPayload = {
  type: 'storage_recovery_anomaly';
  reason: string;
  timestamp: number;
  elapsedMs: number;
  platform: 'ios' | 'ipados' | 'other';
  standalone: boolean;
  persisted: boolean | null;
};

type SentryTelemetryKind = 'error' | 'storage-anomaly';
type SentryTelemetryPayload = TelemetryErrorPayload | StorageAnomalyPayload;

let sentryInitialized = false;

function safeBuildSha(): string {
  return typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__.length > 0 ? __BUILD_SHA__ : 'dev';
}

// Only fixed diagnostic classifications cross the provider boundary. A redaction
// regex cannot recognize arbitrary health notes embedded in an Error message.
const ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'URIError', 'EvalError', 'AggregateError', 'DOMException',
  'FirebaseError', 'ZodError', 'ZodSchemaFallbackError',
]);
const ERROR_SOURCES = new Set([
  'react_boundary', 'react_root', 'react_caught', 'react_uncaught',
  'react_recoverable', 'window_error', 'unhandled_rejection',
  'zod_validation', 'zod_schema_fallback', 'app_error', 'custom',
]);

function technicalType(value: unknown): string {
  return typeof value === 'string' && ERROR_TYPES.has(value) ? value : 'Error';
}

function technicalSource(value: unknown): string {
  return typeof value === 'string' && ERROR_SOURCES.has(value) ? value : 'custom';
}

function safeAppVersion(value: unknown): string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(value)
    ? value.slice(0, 80) : 'unknown';
}

function safeSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && /^sess_\d+_[a-z0-9]+$/.test(value)
    ? value.slice(0, 120) : undefined;
}

export function initSentry(): boolean {
  if (sentryInitialized) return true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !import.meta.env.PROD) return false;

  Sentry.init({
    dsn,
    environment: 'production',
    release: safeBuildSha(),
    maxBreadcrumbs: 0,
    defaultIntegrations: false,
    beforeSend(event) {
      // LogBook sends only its deliberately minimized technical context.
      delete event.user;
      delete event.request;
      delete event.breadcrumbs;
      delete event.transaction;
      delete event.extra;

      // SDK integrations can inject arbitrary tags and fingerprints even when
      // LogBook captures only minimized diagnostics. Rebuild the known fields.
      if (event.tags) {
        const tags = event.tags;
        event.tags = {
          source: tags.source === 'storage_recovery' ? 'storage_recovery' : technicalSource(tags.source),
          app_version: safeAppVersion(tags.app_version),
          build_sha: typeof tags.build_sha === 'string' && /^(?:[a-f0-9]{7,40}|dev)$/.test(tags.build_sha)
            ? tags.build_sha : 'dev',
          platform: tags.platform === 'ios' || tags.platform === 'ipados' ? tags.platform : 'other',
          display_mode: tags.display_mode === 'standalone' ? 'standalone' : 'browser',
          online: tags.online === 'true' || tags.online === 'false' ? tags.online : 'unknown',
        };
      }
      if (event.fingerprint) {
        const fingerprint = event.fingerprint;
        event.fingerprint = fingerprint.length === 3 && fingerprint[0] === 'technical-diagnostic'
          ? ['technical-diagnostic', technicalType(fingerprint[1]), technicalSource(fingerprint[2])]
          : fingerprint.length === 2 && fingerprint[0] === 'storage-recovery-anomaly'
            ? ['storage-recovery-anomaly', fingerprint[1] === 'indexeddb_cache_missing_with_valid_marker'
              ? fingerprint[1] : 'other_storage_recovery_anomaly']
            : undefined;
      }

      const logbookContext = event.contexts?.logbook;
      event.contexts = logbookContext ? { logbook: logbookContext } : undefined;

      // Never let SDK serialization resurrect free-form exception text or
      // stack frames (including strings that no PII regex can recognize).
      if (event.message) event.message = 'Technical diagnostic';
      for (const value of event.exception?.values ?? []) {
        value.type = technicalType(value.type);
        value.value = 'Technical diagnostic';
        delete value.stacktrace;
      }

      return event;
    },
  });

  sentryInitialized = true;
  return true;
}

function captureError(payload: TelemetryErrorPayload): boolean {
  if (!sentryInitialized) return false;

  const type = technicalType(payload.type);
  const source = technicalSource(payload.source);
  // Sentry receives structured technical classifications only. Original
  // messages, stack traces, custom names and arbitrary fingerprints may
  // contain health information that pattern-based redaction cannot detect.
  const error = new Error('Technical diagnostic');
  error.name = type;
  error.stack = `${type}: Technical diagnostic`;

  Sentry.withScope((scope) => {
    scope.setFingerprint(['technical-diagnostic', type, source]);
    scope.setTag('source', source);
    scope.setTag('app_version', safeAppVersion(payload.context.appVersion));
    scope.setTag('build_sha', safeBuildSha());
    scope.setTag('platform', payload.context.platform);
    scope.setTag('display_mode', payload.context.displayMode);
    scope.setTag('online', String(payload.context.online));
    scope.setContext('logbook', {
      sessionId: safeSessionId(payload.sessionId),
      occurrenceCount: payload.count,
      firstSeen: payload.firstSeen,
      lastSeen: payload.lastSeen,
    });
    Sentry.captureException(error);
  });

  return true;
}

function captureStorageAnomaly(payload: StorageAnomalyPayload): boolean {
  if (!sentryInitialized) return false;

  const reason = payload.reason === 'indexeddb_cache_missing_with_valid_marker'
    ? payload.reason : 'other_storage_recovery_anomaly';
  const error = new Error('Storage recovery anomaly');
  error.name = 'StorageRecoveryAnomaly';
  error.stack = 'StorageRecoveryAnomaly: Technical diagnostic';

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
 * A true return means the SDK capture method accepted the diagnostic, NOT
 * that the Sentry server acknowledged delivery. SDK network retries are best-effort.
 * There is no standalone usage-event API, only technical errors and storage anomalies.
 */
export async function sendTelemetryToSentry(
  kind: SentryTelemetryKind,
  payload: SentryTelemetryPayload,
): Promise<boolean> {
  try {
    if (kind === 'storage-anomaly') return captureStorageAnomaly(payload as StorageAnomalyPayload);
    return captureError(payload as TelemetryErrorPayload);
  } catch (error) {
    console.warn('[Sentry] Invio telemetria fallito (non bloccante):', error);
    return false;
  }
}
