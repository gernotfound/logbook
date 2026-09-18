import type { SyncResult } from '../../types';
import { SyncTimeoutError } from '../db/db_core';

export type SyncFailureResult = Exclude<SyncResult, { ok: true }>;

export function getSyncErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

/**
 * Central transport-error classification for every cloud sync boundary.
 * Only failures that are known to be retryable are allowed to become
 * `local-pending`; unknown bootstrap/import/runtime failures are fail-closed.
 */
export function classifySyncFailure(error: unknown, options?: { retryable?: boolean }): SyncFailureResult {
    const code = getSyncErrorCode(error);
    if (code === 'permission-denied') return { ok: false, status: 'rejected', error };
    if (
        options?.retryable
        || error instanceof SyncTimeoutError
        || code === 'unavailable'
        || code === 'deadline-exceeded'
    ) {
        return { ok: false, status: 'local-pending', error };
    }
    return { ok: false, status: 'failed', error };
}
