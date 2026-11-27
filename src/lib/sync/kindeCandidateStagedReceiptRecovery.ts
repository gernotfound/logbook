import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { reconcileCloudflareDeliveryReceiptOnly } from './cloudReplicaDurableDelivery';
import { createCloudflareReplicaTransport } from './cloudReplicaTransport';
import { acquireCloudflareAccountKeyCandidate } from './cloudflareAccountKeyCandidate';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { readLocal } from './localArchiveBootstrap';
import { userOwner } from './owner';
import { unlockVaultForOwner } from './secureArchiveSession';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];

/**
 * Reconciles only an already sealed delivery by its immutable D1 receipt.
 * A retired incarnation must never replay its old writer; an absent receipt
 * preserves the ciphertext and pending operations for explicit reconciliation.
 */
export async function recoverKindeCandidateStagedReceipt({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<'idle' | 'unconfirmed' | 'acknowledged'> {
    const owner = userOwner(expected.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            return fence.stillCurrent()
                && isKindeAccountLocalFitnessClear(owner, expected.healthConsentRevision)
                && (readBrowserValueStrict('logbook_is_guest') ?? 'false') === 'false';
        } catch { return false; }
    };
    const requireCurrent = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    function checkAccess(access: KindeCandidateAccess, first?: Confirmed): asserts access is Confirmed {
        if (access.kind !== 'consent-confirmed' || access.principal.uid !== expected.uid
            || access.principal.fenceEpoch !== expected.fenceEpoch
            || access.principal.healthConsentRevision !== expected.healthConsentRevision
            || (first && !equal(access.legalConsent, first.legalConsent))) throw new KindeCandidateBoundaryError();
    }
    requireCurrent();
    const request = { send, stillCurrent: current, browserCookies };
    const first = await readKindeCandidateAccess(request);
    requireCurrent();
    checkAccess(first);
    const grant = await unlockVaultForOwner(owner, current);
    const scoped = () => current() && grant.isCurrent();
    const requireScoped = () => { if (!scoped()) throw new KindeCandidateBoundaryError(); };
    let accountKey: Uint8Array | undefined;
    try {
        requireScoped();
        const local = await readLocal(owner);
        requireScoped();
        if (!local || local.consentRevision !== expected.healthConsentRevision
            || !equal(local.data.legalConsent, first.legalConsent) || local.cloudIntegrityFence
            || local.cloudflareReplicaClaim || local.cloudflareReplicaRetirement
            || local.cloudflareReplicaCancellation) throw new KindeCandidateBoundaryError();
        if (!local.cloudflareDelivery) return 'idle';

        // The already-issued ADK is only needed to authenticate original
        // ciphertext; no new cloud key or replica may be provisioned here.
        accountKey = await acquireCloudflareAccountKeyCandidate({
            expected: { uid: expected.uid, fenceEpoch: expected.fenceEpoch,
                consentRevision: expected.healthConsentRevision },
            purpose: 'recovery-inspect', stillCurrent: scoped,
            csrfToken: () => fence.csrfToken, send,
        });
        requireScoped();
        const beforeAck = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
        requireScoped();
        checkAccess(beforeAck, first);
        const transport = createCloudflareReplicaTransport(send);
        const outcome = await reconcileCloudflareDeliveryReceiptOnly(
            owner, accountKey, { receipt: batch => transport.receipt(batch) }, scoped, first.legalConsent,
        );
        requireScoped();
        const afterAck = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
        requireScoped();
        checkAccess(afterAck, first);
        return outcome;
    } finally {
        accountKey?.fill(0);
        grant.release();
    }
}
