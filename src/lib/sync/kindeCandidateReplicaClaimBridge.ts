import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { acquireCloudflareAccountKeyCandidate } from './cloudflareAccountKeyCandidate';
import { readAuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import { stageCloudflareReplicaClaim, resumeCloudflareReplicaClaim } from './cloudReplicaClaimRecovery';
import { createCloudflareReplicaTransport, type CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { readLocal } from './localArchiveBootstrap';
import { userOwner } from './owner';
import { requireUnlockedLocalKey } from './secureArchiveSession';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];
type Outcome = 'already-active' | 'adopted' | 'retry-staged' | 'reconciliation-required';

function assertAccess(access: KindeCandidateAccess, expected: Principal, legal?: Confirmed['legalConsent']): asserts access is Confirmed {
    if (access.kind !== 'consent-confirmed'
        || access.principal.uid !== expected.uid
        || access.principal.fenceEpoch !== expected.fenceEpoch
        || access.principal.healthConsentRevision !== expected.healthConsentRevision
        || (legal && !equal(access.legalConsent, legal))) {
        throw new KindeCandidateBoundaryError();
    }
}

function assertControl(control: CloudReplicaControlSnapshot, expected: Principal): void {
    // The real Worker includes the trusted owner. An ownerless mock or a
    // control from another account is not evidence for a membership mutation.
    if (control.uid !== expected.uid || control.fenceEpoch !== expected.fenceEpoch
        || control.consentRevision !== expected.healthConsentRevision) {
        throw new KindeCandidateBoundaryError();
    }
}

/**
 * Candidate-only membership bridge. An already staged request is recovered
 * before any new mutation ID is generated. A fresh request is sealed in the
 * owner vault before the first claim HTTP call; neither result grants fitness
 * access, proves an ACK, or changes the active AuthContext.
 *
 * The caller must have already provisioned and unlocked the correct device
 * vault and pinned an authenticated session generation. This function never
 * creates a vault, imports guest data or installs an account owner.
 */
export async function claimKindeCandidateReplica({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<Outcome> {
    const principal = { ...expected };
    const owner = userOwner(principal.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    if (!fence.stillCurrent()) throw new KindeCandidateBoundaryError();
    const deviceKey = requireUnlockedLocalKey(owner);
    const current = () => {
        try {
            if (!fence.stillCurrent() || requireUnlockedLocalKey(owner) !== deviceKey) return false;
            return isKindeAccountLocalFitnessClear(owner, principal.healthConsentRevision);
        } catch { return false; }
    };
    const requireCurrent = () => {
        if (!current()) throw new KindeCandidateBoundaryError();
    };
    requireCurrent();

    const request = { send, stillCurrent: current, browserCookies };
    const first = await readKindeCandidateAccess(request);
    assertAccess(first, principal);
    requireCurrent();

    const local = await readLocal(owner);
    requireCurrent();
    if (!local || local.consentRevision !== principal.healthConsentRevision
        || !equal(local.data.legalConsent, first.legalConsent)
        || local.cloudIntegrityFence || local.cloudflareDelivery || local.cloudflareReplicaRetirement) {
        throw new KindeCandidateBoundaryError();
    }

    const transport = createCloudflareReplicaTransport(send);
    const control = await transport.control();
    requireCurrent();
    assertControl(control, principal);

    // A live membership is not a request to register again. If the device and
    // primary ledger differ, recovery must reconcile them instead of minting
    // another replica or treating an expired lease as active.
    if (!local.cloudflareReplicaClaim && local.replica) {
        const remote = control.replicas[local.replica.slot];
        const same = remote?.status === 'active'
            && remote.replicaId === local.replica.replicaId
            && remote.generation === local.replica.generation
            && remote.leaseUntilMs === local.replica.leaseUntilMs
            && remote.checkpointAtMs === local.replica.checkpointAtMs
            && remote.leaseUntilMs > Date.now();
        const after = await readKindeCandidateAccess(request);
        assertAccess(after, principal, first.legalConsent);
        requireCurrent();
        return same ? 'already-active' : 'reconciliation-required';
    }

    const key = await acquireCloudflareAccountKeyCandidate({
        expected: {
            uid: principal.uid, fenceEpoch: principal.fenceEpoch,
            consentRevision: principal.healthConsentRevision,
        },
        purpose: 'sync', stillCurrent: current,
        csrfToken: () => fence.csrfToken, send,
    });
    try {
        requireCurrent();
        if (!local.cloudflareReplicaClaim) {
            const checkpoint = await readAuthenticatedCloudflareCheckpoint(
                () => transport.scanAll(), principal.uid, key,
                principal.healthConsentRevision, current,
            );
            requireCurrent();
            if (checkpoint.revision !== control.revision
                || checkpoint.fenceEpoch !== control.fenceEpoch
                || checkpoint.consentRevision !== control.consentRevision) {
                return 'reconciliation-required';
            }
            const afterControl = await transport.control();
            requireCurrent();
            assertControl(afterControl, principal);
            if (!equal(control, afterControl)) return 'reconciliation-required';

            const afterScan = await readKindeCandidateAccess(request);
            assertAccess(afterScan, principal, first.legalConsent);
            requireCurrent();
            await stageCloudflareReplicaClaim(
                owner, checkpoint, control, crypto.randomUUID(), current, local.revision,
            );
        }

        // Both the first claim and a crash/lost-reply replay use the exact
        // durable mutation saved by stageCloudflareReplicaClaim.
        const outcome = await resumeCloudflareReplicaClaim(
            owner, key, transport, fence.csrfToken, current,
        );
        requireCurrent();
        const last = await readKindeCandidateAccess(request);
        assertAccess(last, principal, first.legalConsent);
        requireCurrent();
        return outcome === 'idle' ? 'reconciliation-required' : outcome;
    } finally {
        key.fill(0);
    }
}
