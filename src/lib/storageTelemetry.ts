import { auth, onAuthStateChanged } from './firebase';
import { UserDataSchema } from './schema';
import { getStorageDiagnosticData } from './storageStatus';
import { sendTelemetryToSentry } from './sentryClient';
import { deviceKey } from './sync/deviceStorage';
import { storageOwner } from './sync/session';

export type DerivedPlatform = 'ios' | 'ipados' | 'other';

export type StorageReadStatus =
  | 'valid'
  | 'missing'
  | 'empty_guest'
  | 'invalid'
  | 'read_error';

export interface StorageMarker {
  version: number;
  timestamp: number;
  schemaVersion?: number;
}

export interface StorageDiagnosticContext {
  cachedData: unknown;
  readError?: Error | unknown | null;
  marker: StorageMarker | null;
  isGuest?: boolean;
}

export interface StorageRecoveryAnomalyPayload {
  type: 'storage_recovery_anomaly';
  reason: string;
  timestamp: number;
  elapsedMs: number;
  platform: DerivedPlatform;
  standalone: boolean;
  persisted: boolean | null;
}

export interface CreateAnomalyPayloadOptions {
  marker: StorageMarker;
  timestamp?: number;
  reason?: string;
  persisted?: boolean | null;
  nav?: Navigator;
  win?: Window;
}

// Pre-v2 global keys are retained only for one-way cleanup. New diagnostic
// state is owner-scoped so account switches cannot inherit another owner's
// storage marker or anomaly deduplication flag.
export const STORAGE_MARKER_KEY = 'logbook_storage_marker';
export const STORAGE_ANOMALY_REPORTED_KEY = 'logbook_storage_anomaly_reported';
export const STORAGE_MARKER_VERSION = 1;

export function getStorageMarkerKey(owner?: string): string {
  return deviceKey('storage_marker', owner ?? storageOwner());
}

export function getStorageAnomalyReportedKey(owner?: string): string {
  return deviceKey('storage_anomaly_reported', owner ?? storageOwner());
}

/**
 * Retrieves the versioned storage marker from localStorage if valid.
 */
export function getStorageMarker(customStorage?: Storage, owner?: string): StorageMarker | null {
  try {
    const storage = customStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return null;
    const key = getStorageMarkerKey(owner);
    const raw = storage.getItem(key);
    if (!raw) {
      storage.removeItem(STORAGE_MARKER_KEY);
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.version === 'number' &&
      Number.isFinite(parsed.version) &&
      typeof parsed.timestamp === 'number' &&
      Number.isFinite(parsed.timestamp)
    ) {
      return {
        version: parsed.version,
        timestamp: parsed.timestamp,
        schemaVersion: typeof parsed.schemaVersion === 'number' && Number.isFinite(parsed.schemaVersion) ? parsed.schemaVersion : 1,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Updates or creates the versioned storage marker in localStorage.
 */
export function updateStorageMarker(timestamp: number = Date.now(), customStorage?: Storage, owner?: string): StorageMarker | null {
  try {
    const storage = customStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return null;
    const validTimestamp = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : Date.now();
    const marker: StorageMarker = {
      version: STORAGE_MARKER_VERSION,
      timestamp: validTimestamp,
      schemaVersion: 1,
    };
    storage.setItem(getStorageMarkerKey(owner), JSON.stringify(marker));
    storage.removeItem(STORAGE_MARKER_KEY);
    return marker;
  } catch (e) {
    console.warn("Impossibile aggiornare lo storage marker:", e);
    return null;
  }
}

/**
 * Clears the storage marker and reporting deduplication flags (e.g. on logout or cache deletion).
 */
export function clearStorageMarker(customStorage?: Storage, owner?: string): void {
  try {
    const storage = customStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return;
    storage.removeItem(getStorageMarkerKey(owner));
    storage.removeItem(getStorageAnomalyReportedKey(owner));
    storage.removeItem(STORAGE_MARKER_KEY);
    storage.removeItem(STORAGE_ANOMALY_REPORTED_KEY);
  } catch {
    // Ignore removal errors
  }
}

/**
 * Checks whether an anomaly for the given marker has already been reported.
 */
export function isAnomalyAlreadyReported(marker: StorageMarker, customStorage?: Storage, owner?: string): boolean {
  try {
    if (!marker || typeof marker.timestamp !== 'number' || !Number.isFinite(marker.timestamp)) {
      return false;
    }
    const storage = customStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return false;
    const reportedVal = storage.getItem(getStorageAnomalyReportedKey(owner));
    return reportedVal === String(marker.timestamp);
  } catch {
    return false;
  }
}

/**
 * Marks the anomaly for the given marker as reported to prevent duplicate telemetry sends.
 */
export function markAnomalyReported(marker: StorageMarker, customStorage?: Storage, owner?: string): void {
  try {
    if (!marker || typeof marker.timestamp !== 'number' || !Number.isFinite(marker.timestamp)) {
      return;
    }
    const storage = customStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return;
    storage.setItem(getStorageAnomalyReportedKey(owner), String(marker.timestamp));
    storage.removeItem(STORAGE_ANOMALY_REPORTED_KEY);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Derives a privacy-minimized platform descriptor ('ios' | 'ipados' | 'other').
 * Never extracts or leaks user agent strings.
 */
export function detectDerivedPlatform(nav?: Navigator): DerivedPlatform {
  try {
    const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (!n) return 'other';
    const ua = typeof n.userAgent === 'string' ? n.userAgent : '';
    const platform = typeof n.platform === 'string' ? n.platform : '';
    const maxTouchPoints = typeof n.maxTouchPoints === 'number' ? n.maxTouchPoints : 0;

    // iPadOS check (iPad in UA or MacIntel with touch points / Macintosh with maxTouchPoints > 1)
    if (/iPad/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) {
      return 'ipados';
    }
    // iPhone / iPod check
    if (/iPhone|iPod/i.test(ua)) {
      return 'ios';
    }
    return 'other';
  } catch {
    return 'other';
  }
}

/**
 * Detects whether the app is running in standalone mode (PWA / home screen installed).
 */
export function isStandaloneMode(win?: Window): boolean {
  try {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return false;
    const isIosStandalone = (w.navigator as any)?.standalone === true;
    let isMediaStandalone = false;
    if (typeof w.matchMedia === 'function') {
      isMediaStandalone = w.matchMedia('(display-mode: standalone)')?.matches ?? false;
    }
    return Boolean(isIosStandalone || isMediaStandalone);
  } catch {
    return false;
  }
}

/**
 * Deterministically calculates the elapsed duration in milliseconds between current time and marker timestamp.
 */
export function calculateElapsedMs(currentTimestamp: number, markerTimestamp: number): number {
  if (
    typeof currentTimestamp !== 'number' ||
    typeof markerTimestamp !== 'number' ||
    !Number.isFinite(currentTimestamp) ||
    !Number.isFinite(markerTimestamp)
  ) {
    return 0;
  }
  return Math.max(0, Math.floor(currentTimestamp - markerTimestamp));
}

/**
 * Explicitly evaluates the IndexedDB storage read outcome against 5 states:
 * - 'read_error': IndexedDB throw/rejection
 * - 'missing': Cache is null/undefined
 * - 'empty_guest': Cache is null/undefined in uninitialized guest session with no prior marker
 * - 'invalid': Cache is present but cannot be parsed or fails UserDataSchema
 * - 'valid': Cache is present, parseable and valid according to UserDataSchema
 */
export function diagnoseStorageState(ctx: StorageDiagnosticContext): StorageReadStatus {
  if (ctx.readError) {
    return 'read_error';
  }

  const { cachedData, marker, isGuest = false } = ctx;

  if (cachedData === null || cachedData === undefined) {
    if (marker !== null) {
      return 'missing';
    }
    if (isGuest) {
      return 'empty_guest';
    }
    return 'missing';
  }

  let parsed: unknown = cachedData;
  if (typeof cachedData === 'string') {
    try {
      parsed = JSON.parse(cachedData);
    } catch {
      return 'invalid';
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'invalid';
  }

  try {
    const validated = UserDataSchema.safeParse(parsed);
    if (!validated.success || !validated.data || typeof validated.data !== 'object') {
      return 'invalid';
    }
    return 'valid';
  } catch {
    return 'invalid';
  }
}

/**
 * Determines if a storage recovery anomaly should be generated and reported.
 * Only generates an event when a previously valid marker exists in localStorage,
 * but the cache in IndexedDB is actually missing ('missing').
 */
export function shouldReportAnomaly(status: StorageReadStatus, marker: StorageMarker | null): boolean {
  return status === 'missing' && marker !== null && typeof marker.timestamp === 'number' && Number.isFinite(marker.timestamp);
}

/**
 * Constructs the privacy-minimized telemetry payload for storage recovery anomalies.
 */
export function createStorageRecoveryAnomalyPayload({
  marker,
  timestamp = Date.now(),
  reason = 'indexeddb_cache_missing_with_valid_marker',
  persisted = null,
  nav,
  win,
}: CreateAnomalyPayloadOptions): StorageRecoveryAnomalyPayload {
  const safeTimestamp = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : Date.now();
  const safeMarkerTimestamp = marker && typeof marker.timestamp === 'number' && Number.isFinite(marker.timestamp) ? marker.timestamp : safeTimestamp;
  const elapsedMs = calculateElapsedMs(safeTimestamp, safeMarkerTimestamp);
  const platform = detectDerivedPlatform(nav);
  const standalone = isStandaloneMode(win);

  return {
    type: 'storage_recovery_anomaly',
    reason,
    timestamp: safeTimestamp,
    elapsedMs,
    platform,
    standalone,
    persisted: persisted !== undefined ? persisted : null,
  };
}

/**
 * Dispatches the anomaly to Sentry in a fire-and-forget, non-blocking manner.
 * The authenticated UID is used only as a local eligibility gate and is never sent to Sentry.
 */
export async function dispatchStorageRecoveryAnomaly(
  payload: StorageRecoveryAnomalyPayload,
  providedUid?: string | null
): Promise<void> {
  try {
    // Dynamically resolve persisted status if not yet determined at sync creation time
    if (payload.persisted === null) {
      if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
        try {
          payload.persisted = await navigator.storage.persisted();
        } catch {
          // Ignore
        }
      }
      if (payload.persisted === null) {
        const diag = getStorageDiagnosticData();
        if (diag && typeof diag.persistent === 'boolean') {
          payload.persisted = diag.persistent;
        }
      }
    }

    let uid = providedUid !== undefined ? providedUid : null;
    if (uid === null && typeof auth !== 'undefined' && auth) {
      if (auth.currentUser) {
        uid = auth.currentUser.uid;
      } else {
        uid = await new Promise<string | null>((resolve) => {
          let timer: any = null;
          let unsub: (() => void) | null = null;
          let resolved = false;

          const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (unsub) {
              try {
                unsub();
              } catch {
                // Ignore
              }
              unsub = null;
            }
          };

          try {
            unsub = onAuthStateChanged(auth, (user) => {
              if (resolved) return;
              resolved = true;
              cleanup();
              resolve(user ? user.uid : null);
            });
          } catch {
            resolve(null);
            return;
          }

          if (resolved) {
            cleanup();
          } else {
            timer = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                cleanup();
                resolve(null);
              }
            }, 2500);
          }
        });
      }
    }

    if (!uid) {
      // Unauthenticated / guest session without cloud account
      return;
    }

    // Preserve the historical authenticated-only boundary without transmitting
    // the Firebase UID to the external monitoring provider.
    await sendTelemetryToSentry('storage-anomaly', payload);
  } catch (err) {
    console.warn("Invio anomalia storage a Sentry non riuscito (non bloccante):", err);
  }
}
