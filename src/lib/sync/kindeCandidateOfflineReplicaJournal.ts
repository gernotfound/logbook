import equal from 'fast-deep-equal';
import {
    captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess, type KindeCandidateAccess,
} from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { createCloudflareReplicaTransport, type CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { readLocal } from './localArchiveBootstrap';
import { userOwner } from './owner';
import { unlockVaultForOwner } from './secureArchiveSession';

type Confirmed = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;
type Principal = Confirmed['principal'];

export type CandidateOfflineReplicaJournalObservation =
    | { kind: 'no-pending' }
    | { kind: 'transition-pending'; pendingOperations: number }
    | { kind: 'first-claim-pending'; pendingOperations: number }
    | { kind: 'active-pending'; pendingOperations: number; slot: string; generation: number }
    | { kind: 'retired-pending'; pendingOperations: number; slot: string; generation: number;
        reason: 'retired' | 'replaced' | 'expired' | 'missing' };

/**
 * A read-only diagnosis, not permission to reissue an old causal journal.
 * An old slot may have been reused; only a new, explicitly reconciled claim
 * can eventually move those intents to another incarnation. Never read ADK,
 * change the local envelope or mutate membership during this inspection.
 */
export async function inspectKindeCandidateOfflineReplicaJournal({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<CandidateOfflineReplicaJournalObservation> {
    const owner = userOwner(expected.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            if (!fence.stillCurrent() || !isKindeAccountLocalFitnessClear(owner, expected.healthConsentRevision)) return false;
            const guest = readBrowserValueStrict('logbook_is_guest');
            return guest === null || guest === 'false';
        } catch { return false; }
    };
    const requireCurrent = () => { if (!current()) throw new KindeCandidateBoundaryError(); };
    const checkAccess: (access: KindeCandidateAccess, legal?: Confirmed['legalConsent']) => asserts access is Confirmed = (access, legal) => {
        if (access.kind !== 'consent-confirmed' || access.principal.uid !== expected.uid
            || access.principal.fenceEpoch !== expected.fenceEpoch
            || access.principal.healthConsentRevision !== expected.healthConsentRevision
            || (legal && !equal(access.legalConsent, legal))) throw new KindeCandidateBoundaryError();
    };
    const checkControl = (control: CloudReplicaControlSnapshot) => {
        if (control.uid !== expected.uid || control.fenceEpoch !== expected.fenceEpoch
            || control.consentRevision !== expected.healthConsentRevision) throw new KindeCandidateBoundaryError();
    };

    requireCurrent();
    const request = { send, stillCurrent: current, browserCookies };
    const first = await readKindeCandidateAccess(request);
    requireCurrent();
    checkAccess(first);
    // A missing/corrupt vault is not an empty journal. No provisioning is
    // performed, and this short-lived grant is released even on failure.
    const grant = await unlockVaultForOwner(owner, current);
    const scoped = () => current() && grant.isCurrent();
    try {
        if (!scoped()) throw new KindeCandidateBoundaryError();
        const local = await readLocal(owner);
        if (!scoped() || !local || local.consentRevision !== expected.healthConsentRevision
            || !equal(local.data.legalConsent, first.legalConsent) || local.cloudIntegrityFence) {
            throw new KindeCandidateBoundaryError();
        }
        const count = local.pending.length;
        let result: CandidateOfflineReplicaJournalObservation;
        let activeLeaseUntilMs: number | null = null;
        if (local.cloudflareDelivery || local.cloudflareReplicaClaim || local.cloudflareReplicaRetirement
            || local.cloudflareReplicaCancellation) {
            result = { kind: 'transition-pending', pendingOperations: count };
        } else if (!count) {
            result = { kind: 'no-pending' };
        } else if (!local.replica) {
            result = { kind: 'first-claim-pending', pendingOperations: count };
        } else {
            if (local.actorId !== local.replica.slot) throw new KindeCandidateBoundaryError();
            const transport = createCloudflareReplicaTransport(send);
            const control = await transport.control();
            if (!scoped()) throw new KindeCandidateBoundaryError();
            checkControl(control);
            const after = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
            if (!scoped()) throw new KindeCandidateBoundaryError();
            checkAccess(after, first.legalConsent);
            const again = await transport.control();
            if (!scoped()) throw new KindeCandidateBoundaryError();
            checkControl(again);
            if (!equal(control, again)) throw new KindeCandidateBoundaryError();
            const replica = local.replica;
            const slot = replica.slot;
            const generation = replica.generation;
            const entry = again.replicas[slot];
            const reason = !entry ? 'missing' as const
                : entry.replicaId !== replica.replicaId || entry.generation !== generation ? 'replaced' as const
                    : entry.status === 'retired' ? 'retired' as const
                        : entry.leaseUntilMs <= Date.now() ? 'expired' as const : null;
            if (!reason && entry) activeLeaseUntilMs = entry.leaseUntilMs;
            result = reason ? { kind: 'retired-pending', pendingOperations: count, slot, generation, reason }
                : { kind: 'active-pending', pendingOperations: count, slot, generation };
        }

        const latest = await readLocal(owner);
        if (!scoped() || !latest || !equal(local, latest)) throw new KindeCandidateBoundaryError();
        const last = await readKindeCandidateAccess({ ...request, stillCurrent: scoped });
        if (!scoped()) throw new KindeCandidateBoundaryError();
        checkAccess(last, first.legalConsent);
        if (result.kind === 'active-pending' && activeLeaseUntilMs !== null
            && activeLeaseUntilMs <= Date.now()) {
            return { ...result, kind: 'retired-pending', reason: 'expired' };
        }
        return result;
    } finally {
        grant.release();
    }
}
