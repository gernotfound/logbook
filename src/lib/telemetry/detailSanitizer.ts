import { scrubPII } from '../telemetrySanitizer';

/**
 * Sanitizes telemetry event metadata before it crosses the Firestore boundary.
 *
 * Event details are expected to be small technical maps. The recursive handling
 * keeps the privacy boundary safe if a caller accidentally nests an object or
 * array, while preserving numbers/booleans/null used by current telemetry.
 */
export function sanitizeTelemetryDetails<T>(value: T): T {
  if (typeof value === 'string') {
    return scrubPII(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTelemetryDetails(item)) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sanitizeTelemetryDetails(item);
    }
    return output as unknown as T;
  }

  return value;
}
