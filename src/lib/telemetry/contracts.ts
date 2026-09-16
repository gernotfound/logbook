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
