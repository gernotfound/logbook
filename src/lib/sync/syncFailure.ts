import type { SyncResult } from '../../types';
import { SyncTimeoutError } from '../db/db_core';

export type SyncFailureResult = Exclude<SyncResult, { ok: true }>;

type SyncErrorDetail = { code?: string; retryable: boolean };
const capabilityCodes = new Set(['app-check-unavailable', 'app-check-limited-use-unavailable', 'cloud-key-unavailable']);

function getSyncErrorChain(error: unknown): { chain: SyncErrorDetail[]; incomplete: boolean } {
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
    return { chain, incomplete: !!current && typeof current === 'object' && !seen.has(current) };
}

/**
 * Central transport-error classification for every cloud sync boundary.
 * Only failures that are known to be retryable are allowed to become
 * `local-pending`; unknown bootstrap/import/runtime failures are fail-closed.
 */
export function classifySyncFailure(error: unknown, options?: { retryable?: boolean }): SyncFailureResult {
    const { chain, incomplete } = getSyncErrorChain(error);
    const direct = chain[0];
    // Only a caller with independent proof of a retained journal may force a retry:
    // a confirmed remote commit with a lost local ACK can wrap a provider error.
    const provenPending = options?.retryable === true;
    if (direct?.code === 'permission-denied' || (!provenPending && chain.some(item => item.code === 'permission-denied'))) {
        return { ok: false, status: 'rejected', error };
    }
    // The bounded scan may leave an unseen cause. A transport code cannot prove
    // that this hidden outcome is safe to retry without independent journal evidence.
    if (incomplete && !provenPending) return { ok: false, status: 'failed', error };
    if (direct?.code && capabilityCodes.has(direct.code)) {
        return { ok: false, status: direct.retryable ? 'local-pending' : 'failed', error };
    }
    if (direct?.code === 'auth/network-request-failed') return { ok: false, status: 'local-pending', error };
    // A wrapper may mean the remote result is unsafe even if its cause is transient.
    // Only a direct transport error or an independently proven journal can be pending.
    if (!provenPending && chain.some(item => item.code !== undefined && (capabilityCodes.has(item.code) || item.code === 'auth/network-request-failed'))) {
        return { ok: false, status: 'failed', error };
    }
    if (
        provenPending
        || error instanceof SyncTimeoutError
        || direct?.code === 'unavailable'
        || direct?.code === 'deadline-exceeded'
        || direct?.code === 'resource-exhausted'
        || direct?.code === 'firestore/resource-exhausted'
        || direct?.code === 'quota-exceeded'
    ) {
        return { ok: false, status: 'local-pending', error };
    }
    return { ok: false, status: 'failed', error };
}
