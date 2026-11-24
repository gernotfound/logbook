import equal from 'fast-deep-equal';
import { KindeCandidateBoundaryError, type KindeCandidateAccess } from './kindeCandidateClient';
import { normalizeKindeFitnessIntents } from './kindeCandidateDomainIntent';
import { isKindeSessionDeadlineCurrent } from './kindeCandidateSessionDeadline';
import type { DomainOperationBatch } from '../sync/domainOperations';
import { readLocal } from '../sync/localArchiveBootstrap';
import { commitDomainOperations, type LocalWriteGuard } from '../sync/localDomainCommit';
import type { LocalEnvelope } from '../sync/localEnvelopeValidation';
import { assertNoLocalPurge } from '../sync/localPurgeFence';
import { readVaultControl, unlockVaultForOwner } from '../sync/secureArchiveSession';

type ActiveAccess = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>;

// The document that verified readiness owns this permit. A reload must
// establish a new trusted session before it can open the account vault.
export function createKindeCandidateOfflineJournal(
    access: ActiveAccess, local: LocalEnvelope, realmIsCurrent: () => boolean,
) {
    const owner = local.owner;
    const vault = readVaultControl(owner);
    const replica = local.replica;
    const proof = access.sessionDeadline;
    if (!vault || vault.phase !== 'active' || !replica || !proof) return null;

    const hasTime = () => isKindeSessionDeadlineCurrent(proof, replica.leaseUntilMs);
    if (!hasTime()) return null;
    let invalidated = false;
    const isCurrent = () => {
        try {
            if (invalidated || navigator.onLine !== false) return false;
            if (!realmIsCurrent() || !hasTime()) {
                invalidated = true;
                return false;
            }
            assertNoLocalPurge(owner);
            invalidated = !equal(readVaultControl(owner), vault);
            return !invalidated;
        } catch {
            invalidated = true;
            return false;
        }
    };
    const valid = (record: LocalEnvelope | undefined): record is LocalEnvelope => Boolean(record
        && record.owner === owner && record.actorId === replica.slot
        && record.consentRevision === access.principal.healthConsentRevision
        && equal(record.data.legalConsent, access.legalConsent)
        && equal(record.replica, replica)
        && !record.cloudflareDelivery && !record.cloudflareReplicaClaim && !record.cloudflareReplicaRetirement
        && !record.cloudIntegrityFence && !record.archivedConsentJournals?.length);
    if (!valid(local) || local.pending.length > 0) return null;

    return {
        isCurrent,
        submit: async (operation: DomainOperationBatch, beforeCommit?: LocalWriteGuard) => {
            const intents = normalizeKindeFitnessIntents(operation);
            if (!isCurrent()) throw new KindeCandidateBoundaryError();
            const grant = await unlockVaultForOwner(owner, isCurrent);
            const current = () => isCurrent() && grant.isCurrent();
            try {
                const before = await readLocal(owner);
                if (!current() || !valid(before)) throw new KindeCandidateBoundaryError();
                const committed = await commitDomainOperations(owner, intents, before.data,
                    record => current() && valid(record) && (!beforeCommit || beforeCommit(record)));
                const durable = await readLocal(owner);
                if (!current() || !valid(durable) || !committed.operations.every(op =>
                    durable.pending.some(candidate => equal(candidate, op)))) throw new KindeCandidateBoundaryError();
                return {
                    data: durable.data,
                    outcome: durable.pending.length
                        ? { kind: 'local-pending' as const, pendingCount: durable.pending.length }
                        : { kind: 'local-only' as const },
                };
            } finally {
                grant.release();
            }
        },
    };
}
