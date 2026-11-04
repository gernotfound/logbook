import { UserDataSchema } from './schema';
import { deviceKey } from './sync/deviceStorage';
import { storageOwner } from './sync/session';

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

// Owner-scoped integrity markers are independent of external error reporting.
export const STORAGE_MARKER_VERSION = 1;

export function getStorageMarkerKey(owner?: string): string {
  return deviceKey('storage_marker', owner ?? storageOwner());
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
    if (!raw) return null;
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
    return marker;
  } catch (e) {
    console.warn("Impossibile aggiornare lo storage marker:", e);
    return null;
  }
}

/**
 * Clears the owner-scoped storage marker (e.g. on logout or cache deletion).
 */
export function clearStorageMarker(customStorage?: Storage, owner?: string): void {
  try {
    const storage = customStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return;
    storage.removeItem(getStorageMarkerKey(owner));
  } catch {
    // Ignore removal errors
  }
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
