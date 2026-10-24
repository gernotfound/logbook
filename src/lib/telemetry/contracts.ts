import type { TelemetryContext } from '../telemetrySanitizer';

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

export interface TrackErrorOptions {
  source?: ErrorSource;
  componentStack?: string;
  customMessage?: string;
}

export interface QueuedTelemetryItem {
  id: string;
  timestamp: number;
  itemType: 'error';
  payload: TelemetryErrorPayload;
  queuedAt?: number;
  retryCount?: number;
}

export interface RateLimitEntry {
  hash: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  payload: TelemetryErrorPayload;
  timerId: ReturnType<typeof setTimeout> | null;
  lastDispatchedCount: number;
  isDispatchPending: boolean;
}

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const DEDUP_WINDOW_MS = RATE_LIMIT_WINDOW_MS;
export const TELEMETRY_DISPATCH_TIMEOUT_MS = 5000;
export const TELEMETRY_QUEUE_CAPACITY = 50;
// Best-effort technical reports must not remain indefinitely on an offline device.
export const TELEMETRY_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ID_KEY = 'logbook_telemetry_session_id';
export const MAX_ACTIVE_RATE_LIMITERS = 1000;
export const MAX_ITEM_RETRIES = 3;
export const INITIAL_RETRY_DELAY_MS = 1000;
export const MAX_RETRY_DELAY_MS = 30000;
