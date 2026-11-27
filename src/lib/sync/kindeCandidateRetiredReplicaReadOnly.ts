import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { acquireCloudflareAccountKeyCandidate } from './cloudflareAccountKeyCandidate';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { inspectKindeCandidateRetiredReplicaPreflight } from './kindeCandidateRetiredReplicaPreflight';
import { userOwner } from './owner';
import type { RetiredReplicaRecoveryPreflight } from './retiredReplicaRecoveryPreflight';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];

/**
 * Acquires only a previously issued ADK for one retired-replica observation.
 * The server rejects missing keys without provisioning; both the transport
 * and preflight independently fence session, consent and device ownership.
 * This never authorizes a new actor, journal replay, cloud write or ACK.
 */
export async function inspectKindeCandidateRetiredReplicaWithExistingKey({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<RetiredReplicaRecoveryPreflight> {
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const owner = userOwner(expected.uid);
    const current = () => {
        try {
            return fence.stillCurrent()
                && isKindeAccountLocalFitnessClear(owner, expected.healthConsentRevision)
                && (readBrowserValueStrict('logbook_is_guest') ?? 'false') === 'false';
        } catch { return false; }
    };
    const requireCurrent = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    requireCurrent();
    const request = { stillCurrent: current, browserCookies, send };
    const before = await readKindeCandidateAccess(request);
    requireCurrent();
    if (before.kind !== 'consent-confirmed' || !equal(before.principal, expected)) {
        throw new KindeCandidateBoundaryError();
    }
    let accountKey: Uint8Array | undefined;
    try {
        accountKey = await acquireCloudflareAccountKeyCandidate({
            expected: { uid: expected.uid, fenceEpoch: expected.fenceEpoch,
                consentRevision: expected.healthConsentRevision },
            purpose: 'recovery-inspect', stillCurrent: current,
            csrfToken: () => fence.csrfToken, send,
        });
        requireCurrent();
        const result = await inspectKindeCandidateRetiredReplicaPreflight({
            expected, accountKey, stillCurrent: current, send, browserCookies,
        });
        requireCurrent();
        const after = await readKindeCandidateAccess(request);
        requireCurrent();
        if (after.kind !== 'consent-confirmed' || !equal(after.principal, before.principal)
            || !equal(after.legalConsent, before.legalConsent)) throw new KindeCandidateBoundaryError();
        return result;
    } finally {
        accountKey?.fill(0);
    }
}
