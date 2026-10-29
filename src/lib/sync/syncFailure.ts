import type { SyncResult } from '../../types';
import { SyncTimeoutError } from '../db/db_core';

export type SyncFailureResult = Exclude<SyncResult, { ok: true }>;

type SyncErrorDetail = { code?: string; retryable: boolean };

function getSyncErrorChain(error: unknown): SyncErrorDetail[] {
    const chain: SyncErrorDetail[] = [];
    const seen = new Set<object>();
    let current = error;
    for (let depth = 0; depth < 6 && current && typeof current === 'object' && !seen.has(current); depth++) {
        seen.add(current);
        const item = current as { code?: unknown; retryable?: unknown; cause?: unknown };
        const code = Object.hasOwn(item, 'code') ? item.code : undefined;
        chain.push({
            code: typeof code === 'string' ? code : undefined,
            retryable: Object.hasOwn(item, 'retryable') && item.retryable === true,
        });
        current = Object.hasOwn(item, 'cause') ? item.cause : undefined;
    }
    return chain;
}

/**
 * Central transport-error classification for every cloud sync boundary.
 * Only failures that are known to be retryable are allowed to become
 * `local-pending`; unknown bootstrap/import/runtime failures are fail-closed.
 */
export function classifySyncFailure(error: unknown, options?: { retryable?: boolean }): SyncFailureResult {
    const chain = getSyncErrorChain(error);
    const direct = chain[0];
    // Only a caller with independent proof of a retained journal may force a retry:
    // a confirmed remote commit with a lost local ACK can wrap a provider error.
    const provenPending = options?.retryable === true;
    if (direct?.code === 'permission-denied' || (!provenPending && chain.some(item => item.code === 'permission-denied'))) {
        return { ok: false, status: 'rejected', error };
    }
    const appCheck = direct?.code === 'app-check-unavailable'
        ? direct
        : (!provenPending ? chain.find(item => item.code === 'app-check-unavailable') : undefined);
    if (appCheck) return { ok: false, status: appCheck.retryable ? 'local-pending' : 'failed', error };
    if (
        provenPending
        || error instanceof SyncTimeoutError
        || chain.some(item => item.code === 'unavailable' || item.code === 'deadline-exceeded')
    ) {
        return { ok: false, status: 'local-pending', error };
    }
    return { ok: false, status: 'failed', error };
}
