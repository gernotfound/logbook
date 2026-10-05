import type { SyncResult } from '../../types';
import { SyncTimeoutError } from '../db/db_core';

export type SyncFailureResult = Exclude<SyncResult, { ok: true }>;

export function getSyncErrorCode(error: unknown): string | undefined {
    let current = error;
    const seen = new Set<unknown>();
    for (let depth = 0; depth < 4 && current && typeof current === 'object' && !seen.has(current); depth++) {
        seen.add(current);
        const candidate = current as { code?: unknown; cause?: unknown };
        if (typeof candidate.code === 'string') return candidate.code;
        current = candidate.cause;
    }
    return undefined;
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
        || (code === 'app-check-unavailable'
            && (error as { phase?: unknown } | null)?.phase === 'token-error')
    ) {
        return { ok: false, status: 'local-pending', error };
    }
    return { ok: false, status: 'failed', error };
}
