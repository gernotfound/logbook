import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from './kindeCandidateClient';
import { isKindeAccountLocalFitnessClear } from '../sync/kindeOwnerLocalFitnessFence';
import { prepareKindeCandidateOwner } from '../sync/kindeCandidateOwnerBootstrap';
import { readLocal } from '../sync/localArchiveBootstrap';
import { userOwner } from '../sync/owner';
import { unlockVaultForOwner } from '../sync/secureArchiveSession';

type Principal = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>['principal'];
type Options = {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
};

/**
 * Candidate-only local readiness scope for the future Kinde account adapter.
 * A checked D1 checkpoint is not a fitness authorization: each cloud action
 * still needs its own trusted session, owner and consent check on the Worker.
 *
 * Do not install an authenticatedIdentitySource reader here. Only the future
 * account runtime may do so after its independent lifecycle gates are ready.
 * The callback cannot keep this attempt's unlocked device key after return.
 */
export async function withKindeCandidateLocalReadiness<T>(
    { expected, stillCurrent, send = fetch, browserCookies = () => document.cookie }: Options,
    visit: (ready: { owner: string; principal: Readonly<Principal>; isCurrent: () => boolean }) => Promise<T>,
): Promise<T> {
    const principal = { ...expected };
    const owner = userOwner(principal.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            return fence.stillCurrent()
                && isKindeAccountLocalFitnessClear(owner, principal.healthConsentRevision);
        } catch { return false; }
    };
    if (!current()) throw new KindeCandidateBoundaryError();

    const request = { expected: principal, stillCurrent: current, send, browserCookies };
    // Incomplete checkpoint/claim, ambiguous ACK or a later journal edit is
    // not readiness. Never inherit the bootstrap's temporary unlock.
    const result = await prepareKindeCandidateOwner({
        ...request, drainPendingJournal: true, retainDeviceVault: false,
    });
    if (!current() || result.kind !== 'candidate-observed'
        || result.journalDrained !== true || result.checkpointRevision === null
        || (result.replicaOutcome !== 'adopted' && result.replicaOutcome !== 'already-active')) {
        throw new KindeCandidateBoundaryError();
    }

    const grant = await unlockVaultForOwner(owner, current);
    const scoped = () => current() && grant.isCurrent();
    try {
        if (!scoped()) throw new KindeCandidateBoundaryError();
        const local = await readLocal(owner);
        if (!scoped() || !local || local.owner !== owner
            || local.consentRevision !== principal.healthConsentRevision
            || !local.replica || local.replica.slot !== local.actorId
            || local.replica.leaseUntilMs <= Date.now()
            || local.pending.length > 0 || local.cloudflareDelivery
            || local.cloudflareReplicaClaim || local.cloudflareReplicaRetirement
            || local.cloudIntegrityFence || (local.archivedConsentJournals?.length ?? 0) > 0) {
            throw new KindeCandidateBoundaryError();
        }

        // The local consent is a sealed copy, not authority: read the D1
        // consent again under the pinned session after every bootstrap await.
        const access = await readKindeCandidateAccess({ send, stillCurrent: scoped, browserCookies });
        if (!scoped() || access.kind !== 'consent-confirmed'
            || access.principal.uid !== principal.uid
            || access.principal.fenceEpoch !== principal.fenceEpoch
            || access.principal.healthConsentRevision !== principal.healthConsentRevision
            || !equal(access.legalConsent, local.data.legalConsent)) {
            throw new KindeCandidateBoundaryError();
        }
        const value = await visit({ owner, principal, isCurrent: scoped });
        if (!scoped()) throw new KindeCandidateBoundaryError();
        return value;
    } finally {
        // Even a successful candidate observation must not leave an account
        // DEK unlocked when no authenticated fitness provider owns the realm.
        grant.release();
    }
}
