import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { hydrateKindeCandidateArchive } from './kindeCandidateArchiveHydration';
import { claimKindeCandidateReplica } from './kindeCandidateReplicaClaimBridge';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { readLocal } from './localArchiveBootstrap';
import { userOwner } from './owner';
import { createAndMigrateVault } from './secureArchiveMigration';
import { requireUnlockedLocalKey } from './secureArchiveSession';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];

function verifyAccess(access: KindeCandidateAccess, expected: Principal, legal?: Confirmed['legalConsent']): asserts access is Confirmed {
    if (access.kind !== 'consent-confirmed'
        || access.principal.uid !== expected.uid
        || access.principal.fenceEpoch !== expected.fenceEpoch
        || access.principal.healthConsentRevision !== expected.healthConsentRevision
        || (legal && !equal(access.legalConsent, legal))) throw new KindeCandidateBoundaryError();
}

/**
 * Candidate-only owner bootstrap: trusted consent -> recoverable device vault
 * -> authenticated AEAD hydration and durable D1 replica claim. A later
 * account runtime must independently gate fitness and owner installation;
 * no result here authorizes business writes, journal ACKs or rights erasure.
 * No guest archive is adopted, modified or cleared.
 */
export async function prepareKindeCandidateOwner({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<{ kind: 'candidate-observed'; checkpointRevision: number | null; replicaOutcome: Awaited<ReturnType<typeof claimKindeCandidateReplica>> }> {
    const principal = { ...expected };
    const owner = userOwner(principal.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => fence.stillCurrent()
        && isKindeAccountLocalFitnessClear(owner, principal.healthConsentRevision);
    const requireCurrent = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    requireCurrent();
    const request = { send, stillCurrent: current, browserCookies };
    const first = await readKindeCandidateAccess(request);
    verifyAccess(first, principal);
    requireCurrent();

    // Provision only after a trusted first consent. A crash may leave a
    // migrating control; the owner-scoped Web Lock and mirror recover the
    // same non-extractable device key instead of replacing its ciphertext.
    await createAndMigrateVault(owner, current);
    requireCurrent();
    const deviceKey = requireUnlockedLocalKey(owner);
    const scoped = () => {
        try { return current() && requireUnlockedLocalKey(owner) === deviceKey; }
        catch { return false; }
    };
    if (!scoped()) throw new KindeCandidateBoundaryError();
    const pinnedRequest = { send, stillCurrent: scoped, browserCookies };
    const afterProvision = await readKindeCandidateAccess(pinnedRequest);
    verifyAccess(afterProvision, principal, first.legalConsent);

    const hydrate = () => hydrateKindeCandidateArchive({
        expected: principal, stillCurrent: scoped, send, browserCookies,
    });
    const previous = await readLocal(owner);
    if (!scoped()) throw new KindeCandidateBoundaryError();
    // Hydration correctly refuses to overwrite a baseline while a claim is
    // staged. Recover that exact request before attempting another scan.
    const recovering = Boolean(previous?.cloudflareReplicaClaim);
    let hydrated = recovering ? null : await hydrate();
    const local = hydrated?.envelope ?? previous;
    if (!scoped() || !local || local.consentRevision !== principal.healthConsentRevision
        || !equal(local.data.legalConsent, first.legalConsent)) throw new KindeCandidateBoundaryError();

    const replicaOutcome = await claimKindeCandidateReplica({
        expected: principal, stillCurrent: scoped, send, browserCookies,
    });
    if (!scoped()) throw new KindeCandidateBoundaryError();
    if (recovering && (replicaOutcome === 'adopted' || replicaOutcome === 'already-active')) {
        hydrated = await hydrate();
    }
    const final = await readKindeCandidateAccess(pinnedRequest);
    verifyAccess(final, principal, first.legalConsent);
    if (!scoped()) throw new KindeCandidateBoundaryError();
    return { kind: 'candidate-observed', checkpointRevision: hydrated?.checkpointRevision ?? null, replicaOutcome };
}
