import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, readKindeCandidateJson,
} from './kindeCandidateClient';
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
    if (confirmsErasure !== true || expected?.healthConsentRevision !== 1
        || typeof expected.uid !== 'string' || !/^k_[A-Za-z0-9_-]{43}$/.test(expected.uid)
        || !Number.isSafeInteger(expected.fenceEpoch) || expected.fenceEpoch < 1) {
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
    const access = await readKindeCandidateAccess({
        send, stillCurrent: current, browserCookies,
    });
    check();
    if (access.kind !== 'consent-confirmed'
        || access.principal.uid !== expected.uid
        || access.principal.fenceEpoch !== expected.fenceEpoch
        || access.principal.healthConsentRevision !== expected.healthConsentRevision
        || readBrowserValueStrict(marker) !== null) {
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

    const observed = await readKindeCandidateAccess({
        send, stillCurrent: current, browserCookies,
    });
    check();
    if (observed.kind !== 'consent-suspended' || observed.status !== 'withdrawn'
        || observed.principal.uid !== expected.uid
        || observed.principal.fenceEpoch !== expected.fenceEpoch
        || observed.principal.healthConsentRevision !== 1
        || readBrowserValueStrict(marker) !== 'pending:1') {
        throw new KindeCandidateBoundaryError();
    }
    writeBrowserValue(marker, 'withdrawn');
    check();
    if (readBrowserValueStrict(marker) !== 'withdrawn') throw new KindeCandidateBoundaryError();
    return { kind: 'withdrawal-recorded', deletionStatus: receipt.deletionStatus };
}
