import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { createCloudflareReplicaTransport } from './cloudReplicaTransport';
import { resumeCloudflareReplicaRetirement, stageCloudflareReplicaRetirement } from './cloudReplicaRetirementRecovery';
import { hydrateKindeCandidateArchive } from './kindeCandidateArchiveHydration';
import { inspectKindeCandidateReplicaRegistry } from './kindeCandidateReplicaRegistry';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { readLocal } from './localArchiveBootstrap';
import { userOwner } from './owner';
import { createAndMigrateVault } from './secureArchiveMigration';
import { unlockVaultForOwner } from './secureArchiveSession';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];
type Outcome = Awaited<ReturnType<typeof resumeCloudflareReplicaRetirement>>;

export type CandidateReplicaRetirementWitness = {
    slot: string; replicaId: string; generation: number;
    lastSeq: number; checkpointAtMs: number; leaseUntilMs: number;
};

function verify(access: KindeCandidateAccess, expected: Principal, legal?: Confirmed['legalConsent']): asserts access is Confirmed {
    if (access.kind !== 'consent-confirmed' || access.principal.uid !== expected.uid
        || access.principal.fenceEpoch !== expected.fenceEpoch
        || access.principal.healthConsentRevision !== expected.healthConsentRevision
        || (legal && !equal(access.legalConsent, legal))) throw new KindeCandidateBoundaryError();
}

/**
 * Candidate-only explicit retirement. A confirmed UI witness must still match
 * two stable owner-bound controls AFTER vault provisioning/hydration. The
 * vault is released on every path; any staged intent and pending journal stay
 * encrypted and durable on timeout, lost reply or session change.
 */
export async function retireKindeCandidateReplica({
    expected, witness, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    witness: Readonly<CandidateReplicaRetirementWitness>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<Outcome> {
    return manageRetirement({ expected, stillCurrent, send, browserCookies, witness });
}

/** Only a separate user action may replay an existing sealed retirement. */
export async function recoverKindeCandidateReplicaRetirement({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<Outcome> {
    return manageRetirement({ expected, stillCurrent, send, browserCookies });
}

async function manageRetirement({ expected, stillCurrent, send, browserCookies, witness }: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send: typeof fetch;
    browserCookies: () => string;
    witness?: Readonly<CandidateReplicaRetirementWitness>;
}): Promise<Outcome> {
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
    const assertCurrent = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    assertCurrent();
    const request = { send, stillCurrent: current, browserCookies };
    const before = await readKindeCandidateAccess(request);
    assertCurrent();
    verify(before, principal);

    // A cap-full sixth device needs a local encrypted baseline but cannot
    // claim a slot yet. Recovery never provisions or hydrates a new vault.
    const grant = witness ? await createAndMigrateVault(owner, current)
        : await unlockVaultForOwner(owner, current);
    const scoped = () => current() && grant.isCurrent();
    const requireScoped = () => { if (!scoped()) throw new KindeCandidateBoundaryError(); };
    try {
        requireScoped();
        const afterUnlock = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
        requireScoped();
        verify(afterUnlock, principal, before.legalConsent);

        if (witness) {
            let local = await readLocal(owner);
            requireScoped();
            if (local === null) {
                await hydrateKindeCandidateArchive({ expected: principal, stillCurrent: scoped, send, browserCookies });
                requireScoped();
                local = await readLocal(owner);
            }
            if (!local || local.consentRevision !== principal.healthConsentRevision
                || !equal(local.data.legalConsent, before.legalConsent)
                || local.cloudflareReplicaRetirement || local.cloudflareReplicaCancellation) {
                throw new KindeCandidateBoundaryError();
            }

            const observation = await inspectKindeCandidateReplicaRegistry({
                expected: principal, stillCurrent: scoped, send, browserCookies,
            });
            requireScoped();
            if (observation.control.uid !== principal.uid
                || observation.control.fenceEpoch !== principal.fenceEpoch
                || observation.control.consentRevision !== principal.healthConsentRevision) {
                throw new KindeCandidateBoundaryError();
            }
            const entry = observation.control.replicas[witness.slot];
            if (!entry || entry.status !== 'active' || entry.replicaId !== witness.replicaId
                || entry.generation !== witness.generation || entry.lastSeq !== witness.lastSeq
                || entry.checkpointAtMs !== witness.checkpointAtMs || entry.leaseUntilMs !== witness.leaseUntilMs) {
                throw new KindeCandidateBoundaryError();
            }
            const priorToStage = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
            requireScoped();
            verify(priorToStage, principal, before.legalConsent);
            await stageCloudflareReplicaRetirement(owner, observation.control, witness, scoped, {
                lastSeq: witness.lastSeq, checkpointAtMs: witness.checkpointAtMs,
                leaseUntilMs: witness.leaseUntilMs,
            });
        } else {
            const local = await readLocal(owner);
            requireScoped();
            if (!local || local.consentRevision !== principal.healthConsentRevision
                || !equal(local.data.legalConsent, before.legalConsent)
                || (local.cloudflareReplicaRetirement
                    && local.cloudflareReplicaRetirement.expectedFenceEpoch !== principal.fenceEpoch)) {
                throw new KindeCandidateBoundaryError();
            }
        }

        requireScoped();
        const transport = createCloudflareReplicaTransport(send);
        const outcome = await resumeCloudflareReplicaRetirement(owner, transport, fence.csrfToken, scoped);
        requireScoped();
        const after = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
        requireScoped();
        verify(after, principal, before.legalConsent);
        return witness && outcome === 'idle' ? 'reconciliation-required' : outcome;
    } finally {
        grant.release();
    }
}
