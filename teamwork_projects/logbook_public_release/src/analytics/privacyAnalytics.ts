/**
 * LogBook - Privacy-Safe Analytics Engine
 * Strictly enforces Opt-In Consent, Parameter Whitelisting, and Zero-PII/Health telemetry.
 */

import {
  AllowedEventName,
  AnalyticsConsentStatus,
  CycleDurationBucket,
  DurationBucket,
  EventParamsMap,
  EVENT_PARAM_WHITELIST,
  ExerciseCountBucket,
  MealsCountBucket,
  RoutineExerciseCountBucket,
  SENSITIVE_FIELD_BLACKLIST,
  STORAGE_KEY_ANALYTICS_CONSENT,
  STORAGE_KEY_ANALYTICS_CONSENT_DATE,
} from './analyticsTypes.js';

export type AnalyticsTransport = (
  eventName: string,
  params: Record<string, any>
) => void | Promise<void>;

let customTransport: AnalyticsTransport | null = null;
let eventBuffer: Array<{ event: string; params: Record<string, any>; timestamp: number }> = [];

/**
 * Configure a custom analytics transport (e.g. Firebase Analytics or Test Mock)
 */
export function setAnalyticsTransport(transport: AnalyticsTransport | null): void {
  customTransport = transport;
}

/**
 * Retrieve the current analytics consent status from localStorage.
 */
export function getAnalyticsConsent(): AnalyticsConsentStatus {
  try {
    if (typeof localStorage === 'undefined') return 'prompt';
    const val = localStorage.getItem(STORAGE_KEY_ANALYTICS_CONSENT);
    if (val === 'granted' || val === 'denied') return val;
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

/**
 * Set user consent for anonymous privacy-safe analytics.
 */
export function setAnalyticsConsent(status: 'granted' | 'denied'): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_ANALYTICS_CONSENT, status);
      localStorage.setItem(STORAGE_KEY_ANALYTICS_CONSENT_DATE, new Date().toISOString());
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to persist analytics consent:', err);
  }

  if (status === 'denied') {
    // Immediately wipe in-memory buffers on revocation
    eventBuffer = [];
  }
}

/**
 * Revoke analytics consent and clear any buffered data.
 */
export function revokeConsent(): void {
  setAnalyticsConsent('denied');
}

/**
 * Check if privacy analytics tracking is currently permitted.
 */
export function isAnalyticsEnabled(): boolean {
  return getAnalyticsConsent() === 'granted';
}

/**
 * Get internal event buffer (useful for inspection/testing).
 */
export function getEventBuffer(): ReadonlyArray<{ event: string; params: Record<string, any>; timestamp: number }> {
  return eventBuffer;
}

/**
 * Clear in-memory event buffer.
 */
export function clearEventBuffer(): void {
  eventBuffer = [];
}

/**
 * Sanitizes an event payload by:
 * 1. Whitelisting only declared parameters for the given event name.
 * 2. Strictly stripping any parameter matching blacklisted sensitive/health/PII fields.
 */
export function sanitizePayload<E extends AllowedEventName>(
  eventName: E,
  rawParams: Record<string, any>
): EventParamsMap[E] {
  const whitelist = EVENT_PARAM_WHITELIST[eventName];
  if (!whitelist) {
    throw new Error(`Unrecognized analytics event: ${String(eventName)}`);
  }

  const sanitized: Record<string, any> = {};

  for (const key of Object.keys(rawParams)) {
    // 1. Blacklist check
    const isBlacklisted = SENSITIVE_FIELD_BLACKLIST.some(
      (b) => b.toLowerCase() === key.toLowerCase()
    );
    if (isBlacklisted) {
      continue; // Drop sensitive field immediately
    }

    // 2. Whitelist check
    if (whitelist.includes(key)) {
      sanitized[key] = rawParams[key];
    }
  }

  return sanitized as EventParamsMap[E];
}

/**
 * Log a privacy-safe event.
 * Will silently discard the event if user consent has not been granted.
 */
export function logPrivacyEvent<E extends AllowedEventName>(
  eventName: E,
  params: EventParamsMap[E]
): boolean {
  if (!isAnalyticsEnabled()) {
    return false;
  }

  try {
    const sanitizedParams = sanitizePayload(eventName, params as Record<string, any>);

    // Store in buffer
    eventBuffer.push({
      event: eventName,
      params: sanitizedParams,
      timestamp: Date.now(),
    });

    // Send through transport if configured
    if (customTransport) {
      customTransport(eventName, sanitizedParams);
    }

    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`PrivacyAnalytics failed to log event ${eventName}:`, err);
    return false;
  }
}

// -------------------------------------------------------------
// Bucketing Helper Functions
// Ensures raw health/numerical quantities are transformed into generic intervals
// -------------------------------------------------------------

export function bucketWorkoutDuration(minutes: number): DurationBucket {
  if (minutes < 30) return '<30m';
  if (minutes <= 60) return '30-60m';
  if (minutes <= 90) return '60-90m';
  return '>90m';
}

export function bucketExerciseCount(count: number): ExerciseCountBucket {
  if (count <= 3) return '1-3';
  if (count <= 6) return '4-6';
  if (count <= 10) return '7-10';
  return '>10';
}

export function bucketRoutineExerciseCount(count: number): RoutineExerciseCountBucket {
  if (count <= 5) return '1-5';
  if (count <= 10) return '6-10';
  return '>10';
}

export function bucketMealsCount(count: number): MealsCountBucket {
  if (count <= 3) return '1-3';
  if (count <= 6) return '4-6';
  return '>6';
}

export function bucketCycleDuration(weeks: number): CycleDurationBucket {
  if (weeks <= 4) return '1-4';
  if (weeks <= 8) return '5-8';
  if (weeks <= 12) return '9-12';
  return '>12';
}
