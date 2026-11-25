import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { cancelCloudflareReplicaMutation } from './cloudReplicaMutationCancellation';
import { createCloudflareReplicaTransport } from './cloudReplicaTransport';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { readLocal } from './localArchiveBootstrap';
import { userOwner } from './owner';
import { unlockVaultForOwner } from './secureArchiveSession';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];
type Options = {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
};

export type CandidatePendingReplicaMutation = {
    kind: 'claim' | 'retirement';
    mutationId: string;
    slot: string | null;
    generation: number | null;
    cancellationRequested: boolean;
};

type Scoped = {
    pending: CandidatePendingReplicaMutation | null;
    owner: string;
    csrfToken: string;
    current: () => boolean;
};

function assertAccess(access: KindeCandidateAccess, principal: Principal, legal?: Confirmed['legalConsent']): asserts access is Confirmed {
    if (access.kind !== 'consent-confirmed' || access.principal.uid !== principal.uid
        || access.principal.fenceEpoch !== principal.fenceEpoch
        || access.principal.healthConsentRevision !== principal.healthConsentRevision
        || (legal && !equal(access.legalConsent, legal))) throw new KindeCandidateBoundaryError();
}

/** Local-only inspection and cancellation share the exact session, vault and consent boundary. */
async function withPendingMutation<T>(options: Options, perform: (scoped: Scoped) => Promise<T>): Promise<T> {
    const { expected, stillCurrent, send = fetch, browserCookies = () => document.cookie } = options;
    const principal = { ...expected };
    const owner = userOwner(principal.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            if (!fence.stillCurrent() || !isKindeAccountLocalFitnessClear(owner, principal.healthConsentRevision)) return false;
            const guest = readBrowserValueStrict('logbook_is_guest');
            return guest === null || guest === 'false';
        } catch { return false; }
    };
    const requireCurrent = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    requireCurrent();
    const request = { send, stillCurrent: current, browserCookies };
    const before = await readKindeCandidateAccess(request);
    requireCurrent();
    assertAccess(before, principal);

    // No provisioning or hydration: an absent vault cannot have a trusted
    // sealed mutation to cancel. The grant is released on all failure paths.
    const grant = await unlockVaultForOwner(owner, current);
    const scopedCurrent = () => current() && grant.isCurrent();
    const assertScoped = () => { if (!scopedCurrent()) throw new KindeCandidateBoundaryError(); };
    try {
        assertScoped();
        const afterUnlock = await readKindeCandidateAccess({ ...request, stillCurrent: scopedCurrent });
        assertScoped();
        assertAccess(afterUnlock, principal, before.legalConsent);
        const local = await readLocal(owner);
        assertScoped();
        if (!local || local.consentRevision !== principal.healthConsentRevision
            || !equal(local.data.legalConsent, before.legalConsent)
            || local.cloudIntegrityFence || local.cloudflareDelivery
            || (local.cloudflareReplicaClaim && local.cloudflareReplicaRetirement)) {
            throw new KindeCandidateBoundaryError();
        }
        const claim = local.cloudflareReplicaClaim;
        const retirement = local.cloudflareReplicaRetirement;
        const intent = claim ?? retirement;
        if (intent && intent.expectedFenceEpoch !== principal.fenceEpoch) throw new KindeCandidateBoundaryError();
        const pending: CandidatePendingReplicaMutation | null = claim ? {
            kind: 'claim', mutationId: claim.mutationId,
            slot: claim.currentReplica?.slot ?? null, generation: claim.currentReplica?.generation ?? null,
            cancellationRequested: local.cloudflareReplicaCancellation === claim.mutationId,
        } : retirement ? {
            kind: 'retirement', mutationId: retirement.mutationId,
            slot: retirement.replica.slot, generation: retirement.replica.generation,
            cancellationRequested: local.cloudflareReplicaCancellation === retirement.mutationId,
        } : null;
        const result = await perform({ pending, owner, csrfToken: fence.csrfToken, current: scopedCurrent });
        assertScoped();
        const after = await readKindeCandidateAccess({ ...request, stillCurrent: scopedCurrent });
        assertScoped();
        assertAccess(after, principal, before.legalConsent);
        return result;
    } finally {
        grant.release();
    }
}

/** The user first reads the exact sealed mutation, including after reload. */
export async function inspectKindeCandidatePendingReplicaMutation(options: Options): Promise<CandidatePendingReplicaMutation | null> {
    return withPendingMutation(options, async ({ pending }) => pending);
}

/** The confirmed mutation ID prevents a changed/rebased intent from being cancelled by a stale UI. */
export async function cancelKindeCandidatePendingReplicaMutation(
    options: Options & { mutationId: string },
): Promise<'cancelled' | 'committed' | 'reconciliation-required'> {
    return withPendingMutation(options, async ({ pending, owner, csrfToken, current }) => {
        if (!pending || pending.mutationId !== options.mutationId) throw new KindeCandidateBoundaryError();
        return cancelCloudflareReplicaMutation(owner, pending.mutationId,
            createCloudflareReplicaTransport(options.send ?? fetch), csrfToken, current);
    });
}
