import equal from 'fast-deep-equal';
import { KindeCandidateBoundaryError, type KindeCandidateAccess } from './kindeCandidateClient';
import { normalizeKindeFitnessIntents } from './kindeCandidateDomainIntent';
import type { DomainOperationBatch } from '../sync/domainOperations';
import { readLocal } from '../sync/localArchiveBootstrap';
import { commitDomainOperations } from '../sync/localDomainCommit';
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
    if (!vault || vault.phase !== 'active' || !replica || access.sessionExpiresAtMs === undefined) return null;

    const deadline = Math.min(access.sessionExpiresAtMs, replica.leaseUntilMs);
    const verifiedAt = Date.now();
    if (deadline <= verifiedAt) return null;
    const monotonicDeadline = performance.now() + (deadline - verifiedAt);
    let invalidated = false;
    const isCurrent = () => {
        try {
            if (invalidated || navigator.onLine !== false) return false;
            const now = Date.now();
            if (!realmIsCurrent() || now < verifiedAt || now >= deadline || performance.now() >= monotonicDeadline) {
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
        submit: async (operation: DomainOperationBatch) => {
            const intents = normalizeKindeFitnessIntents(operation);
            if (!isCurrent()) throw new KindeCandidateBoundaryError();
            const grant = await unlockVaultForOwner(owner, isCurrent);
            const current = () => isCurrent() && grant.isCurrent();
            try {
                const before = await readLocal(owner);
                if (!current() || !valid(before)) throw new KindeCandidateBoundaryError();
                const committed = await commitDomainOperations(owner, intents, before.data,
                    record => current() && valid(record));
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
