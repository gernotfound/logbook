import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateJson,
} from './kindeCandidateClient';
import { readKindeCandidateIdentity } from './kindeCandidateIdentity';
import { readBrowserValueStrict, writeBrowserValue } from '../sync/browserStorage';
import { userOwner } from '../sync/owner';

type Principal = { uid: string; fenceEpoch: number; healthConsentRevision: 1 };
type WithdrawalProof = { kind: 'withdrawal-recorded'; deletionStatus: 'pending' | 'processing' };

function validReceipt(value: unknown, expected: Principal): value is {
    status: 'withdrawn'; revision: 1; fenceEpoch: number; deletionStatus: 'pending' | 'processing';
} {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const response = value as Record<string, unknown>;
    return Object.keys(response).sort().join(',') === 'deletionStatus,fenceEpoch,revision,status'
        && response.status === 'withdrawn' && response.revision === 1
        && response.fenceEpoch === expected.fenceEpoch
        && (response.deletionStatus === 'pending' || response.deletionStatus === 'processing');
}

const VERSION = /^[A-Za-z0-9._-]{1,32}$/;

function originalConsentingPrincipal(expected: Readonly<Principal>): boolean {
    return expected?.healthConsentRevision === 1
        && typeof expected.uid === 'string' && /^k_[A-Za-z0-9_-]{43}$/.test(expected.uid)
        && Number.isSafeInteger(expected.fenceEpoch) && expected.fenceEpoch >= 1;
}

/**
 * Rights and revocation remain available if email verification was lost AFTER
 * the original acceptance. The fitness reader intentionally rejects that
 * identity, so use a separate, strictly bounded session/consent observation.
 * This never authorizes sync, an ADK or an authenticated fitness owner.
 */
async function readWithdrawalState(
    expected: Principal, send: typeof fetch, current: () => boolean,
    browserCookies: () => string, csrf: string,
): Promise<'active' | 'withdrawn'> {
    const confirmIdentity = async () => {
        const identity = await readKindeCandidateIdentity({
            send, stillCurrent: current, browserCookies,
        });
        if (!current() || identity.kind === 'signed-out'
            || identity.principal.uid !== expected.uid
            || identity.principal.fenceEpoch !== expected.fenceEpoch
            || identity.principal.healthConsentRevision !== 1) {
            throw new KindeCandidateBoundaryError();
        }
    };
    await confirmIdentity();
    let response: Response;
    try {
        response = await send('/v1/consent/status', {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
            signal: AbortSignal.timeout(5000),
        });
    } catch { throw new KindeCandidateBoundaryError(); }
    if (!current() || response.status !== 200 || response.redirected
        || ['error', 'opaque', 'opaqueredirect'].includes(response.type)) {
        throw new KindeCandidateBoundaryError(response.status);
    }
    const data = await readKindeCandidateJson(response);
    if (!current() || !data || typeof data !== 'object' || Array.isArray(data)) {
        throw new KindeCandidateBoundaryError();
    }
    const state = data as Record<string, unknown>;
    const keys = Object.keys(state).sort().join(',');
    if (state.uid !== expected.uid
        || typeof state.revision !== 'number' || !Number.isSafeInteger(state.revision)
        || typeof state.fenceEpoch !== 'number' || !Number.isSafeInteger(state.fenceEpoch)) {
        throw new KindeCandidateBoundaryError();
    }
    let result: 'active' | 'withdrawn';
    if (state.status === 'active') {
        if (keys !== 'acceptedAt,fenceEpoch,privacyVersion,revision,status,termsVersion,uid'
            || state.revision !== 1 || state.fenceEpoch !== expected.fenceEpoch
            || typeof state.acceptedAt !== 'string'
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(state.acceptedAt)
            || !Number.isFinite(Date.parse(state.acceptedAt))
            || new Date(state.acceptedAt).toISOString() !== state.acceptedAt
            || Date.parse(state.acceptedAt) > Date.now()
            || typeof state.privacyVersion !== 'string' || !VERSION.test(state.privacyVersion)
            || typeof state.termsVersion !== 'string' || !VERSION.test(state.termsVersion)) {
            throw new KindeCandidateBoundaryError();
        }
        result = 'active';
    } else if (state.status === 'withdrawn') {
        // A completed erasure may have advanced the subject, but not the
        // Auth principal. The Worker has verified its immutable SQL proof.
        const original = state.revision === 1 && state.fenceEpoch === expected.fenceEpoch;
        const terminal = state.revision === 2 && state.fenceEpoch === expected.fenceEpoch + 1;
        if (keys !== 'fenceEpoch,revision,status,uid' || (!original && !terminal)) {
            throw new KindeCandidateBoundaryError();
        }
        result = 'withdrawn';
    } else {
        throw new KindeCandidateBoundaryError();
    }
    await confirmIdentity();
    if (!current()) throw new KindeCandidateBoundaryError();
    return result;
}

/**
 * Candidate-only revocation. The caller must offer export before invoking it.
 * The local marker fences fitness BEFORE the destructive HTTP request; neither
 * a lost reply nor a changed session can silently reopen an old journal.
 * A verified receipt proves a queued erasure, never its completion or purge.
 */
export async function withdrawKindeCandidateHealthConsent({
    confirmsErasure, expected, stillCurrent, send = fetch,
    browserCookies = () => document.cookie,
}: {
    confirmsErasure: boolean;
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<WithdrawalProof> {
    if (confirmsErasure !== true || !originalConsentingPrincipal(expected)) {
        throw new KindeCandidateBoundaryError();
    }
    const owner = userOwner(expected.uid);
    const marker = `logbook:v2:${owner}:health-consent-withdrawal`;
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            return fence.stillCurrent()
                && (readBrowserValueStrict('logbook_is_guest') ?? 'false') === 'false';
        } catch { return false; }
    };
    const check = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    check();
    // An existing pending marker is not permission to repeat a destructive
    // POST, even if its earlier reply was lost. Recovery is read-only.
    if (readBrowserValueStrict(marker) !== null) throw new KindeCandidateBoundaryError();
    const status = await readWithdrawalState(
        expected, send, current, browserCookies, fence.csrfToken,
    );
    check();
    if (status !== 'active' || readBrowserValueStrict(marker) !== null) {
        throw new KindeCandidateBoundaryError();
    }

    // Storage failure is fatal before network I/O. Session snapshots and
    // other tabs observe the same owner-scoped negative evidence.
    writeBrowserValue(marker, 'pending:1');
    check();
    if (readBrowserValueStrict(marker) !== 'pending:1') throw new KindeCandidateBoundaryError();

    let response: Response;
    try {
        response = await send('/v1/consent/withdraw', {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin',
            cache: 'no-store', redirect: 'error',
            headers: {
                Accept: 'application/json', 'Content-Type': 'application/json',
                'X-CSRF-Token': fence.csrfToken,
            },
            body: JSON.stringify({
                action: 'withdraw', expectedRevision: 1, confirmsErasure: true,
            }),
            signal: AbortSignal.timeout(5000),
        });
    } catch {
        // The job could be committed despite the transport error. Do not
        // fabricate a success, clear the marker or automatically replay.
        throw new KindeCandidateBoundaryError();
    }
    check();
    if (response.redirected || ['error', 'opaque', 'opaqueredirect'].includes(response.type)
        || response.status !== 200) {
        throw new KindeCandidateBoundaryError(response.status);
    }
    const receipt = await readKindeCandidateJson(response);
    check();
    if (!validReceipt(receipt, expected)) throw new KindeCandidateBoundaryError();

    const observed = await readWithdrawalState(
        expected, send, current, browserCookies, fence.csrfToken,
    );
    check();
    if (observed !== 'withdrawn' || readBrowserValueStrict(marker) !== 'pending:1') {
        throw new KindeCandidateBoundaryError();
    }
    writeBrowserValue(marker, 'withdrawn');
    check();
    if (readBrowserValueStrict(marker) !== 'withdrawn') throw new KindeCandidateBoundaryError();
    return { kind: 'withdrawal-recorded', deletionStatus: receipt.deletionStatus };
}


/**
 * Read-only recovery for a lost withdrawal response. A pending local marker
 * cannot prove whether the destructive POST committed, and even a trusted
 * ACTIVE status must never silently undo the user's withdrawal decision.
 * Only a revalidated SQL withdrawn state may advance the durable local fence.
 */
export async function reconcileKindeCandidateWithdrawal({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<{ kind: 'withdrawal-proven' } | { kind: 'still-unconfirmed' }> {
    if (!originalConsentingPrincipal(expected)) throw new KindeCandidateBoundaryError();
    const owner = userOwner(expected.uid);
    const marker = `logbook:v2:${owner}:health-consent-withdrawal`;
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            return fence.stillCurrent()
                && (readBrowserValueStrict('logbook_is_guest') ?? 'false') === 'false';
        } catch { return false; }
    };
    const check = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    check();
    const before = readBrowserValueStrict(marker);
    if (before !== 'pending:1' && before !== 'withdrawn') {
        throw new KindeCandidateBoundaryError();
    }

    // The server's status endpoint authenticates UID, session, consent epoch
    // and primary D1 evidence. Recovery never sends a second withdrawal POST.
    const status = await readWithdrawalState(
        expected, send, current, browserCookies, fence.csrfToken,
    );
    check();
    const after = readBrowserValueStrict(marker);
    if (after !== before && !(before === 'pending:1' && after === 'withdrawn')) {
        throw new KindeCandidateBoundaryError();
    }
    if (status === 'active') {
        // A request may still be in flight; preserving the local denial is
        // safer than turning a stale ACTIVE read into permission to sync.
        if (after !== 'pending:1') throw new KindeCandidateBoundaryError();
        return { kind: 'still-unconfirmed' };
    }
    if (after === 'pending:1') {
        writeBrowserValue(marker, 'withdrawn');
        check();
        if (readBrowserValueStrict(marker) !== 'withdrawn') {
            throw new KindeCandidateBoundaryError();
        }
    }
    return { kind: 'withdrawal-proven' };
}
