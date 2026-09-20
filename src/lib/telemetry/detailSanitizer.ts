import { scrubPII } from '../telemetrySanitizer';

type TelemetryDetailValue = string | number | boolean | null;

const STRING_LIMITS = {
  routineId: 128,
  duration: 32,
  schema: 128,
  field: 256,
  issueCode: 128,
  expectedType: 64,
  receivedType: 64,
  fallbackUsed: 128,
  platform: 32,
  source: 64,
} as const;

const BOOLEAN_KEYS = new Set(['offline', 'promptAvailable', 'promptUsed']);
const NON_NEGATIVE_INTEGER_KEYS = new Set(['durationMinutes', 'exerciseCount', 'exercisesCount']);

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return scrubPII(value).slice(0, maxLength);
}

function sanitizeDetailValue(key: string, value: unknown): TelemetryDetailValue | undefined {
  if (key === 'routineId') {
    if (value === null) return null;
    return sanitizeString(value, STRING_LIMITS.routineId);
  }

  if (key === 'outcome') {
    return value === 'accepted' || value === 'dismissed' ? value : undefined;
  }

  if (BOOLEAN_KEYS.has(key)) {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (NON_NEGATIVE_INTEGER_KEYS.has(key)) {
    return Number.isInteger(value) && (value as number) >= 0 ? value as number : undefined;
  }

  if (key === 'durationSec') {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  if (key === 'duration') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    return sanitizeString(value, STRING_LIMITS.duration);
  }

  if (key in STRING_LIMITS) {
    return sanitizeString(value, STRING_LIMITS[key as keyof typeof STRING_LIMITS]);
  }

  return undefined;
}

/**
 * Minimizes telemetry event metadata before it is persisted locally or sent to
 * Firestore. Only the explicit technical allowlist crosses this boundary.
 * Unknown keys, nested structures and user-authored business labels are dropped.
 */
export function sanitizeTelemetryDetails(value: unknown): Record<string, TelemetryDetailValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const output: Record<string, TelemetryDetailValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizeDetailValue(key, item);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}
