/**
 * Stable public facade for LogBook telemetry.
 */

export {
  RATE_LIMIT_WINDOW_MS,
  DEDUP_WINDOW_MS,
  FIRESTORE_DISPATCH_TIMEOUT_MS,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_CAPACITY,
  SESSION_ID_KEY,
  MAX_ACTIVE_RATE_LIMITERS,
  MAX_ITEM_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
} from './telemetry/contracts';

export type {
  ErrorSource,
  TelemetryEventType,
  TelemetryErrorPayload,
  TelemetryEventPayload,
  TrackErrorOptions,
  QueuedTelemetryItem,
} from './telemetry/contracts';

export { TelemetryHub } from './telemetry/TelemetryHubCore';

import { TelemetryHub } from './telemetry/TelemetryHubCore';

export const telemetryHub = TelemetryHub.getInstance();
