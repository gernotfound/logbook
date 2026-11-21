import equal from 'fast-deep-equal';
import type { DomainOperationBatch } from '../sync/domainOperations';
import { normalizeDomainOperationBatch } from '../sync/domainOperations';
import { commitDomainOperations } from '../sync/localDomainCommit';
import { readLocal } from '../sync/localArchiveBootstrap';
import { coversVectorClock, type SemanticOperation } from '../sync/semanticProjection';
import { deliverKindeCandidateJournal } from '../sync/kindeCandidateJournalBridge';
import { KindeCandidateBoundaryError, type KindeCandidateAccess } from './kindeCandidateClient';
import { withKindeCandidateLocalReadiness } from './kindeCandidateLocalReadiness';

type Principal = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>['principal'];

type CandidateMutationOutcome =
    | { kind: 'cloud-acknowledged'; operations: number }
    | { kind: 'local-pending'; pendingCount: number }
    | { kind: 'local-only' };

const sameOperation = (a: SemanticOperation, b: SemanticOperation) => equal(a, b);

/**
 * An ordinary Kinde fitness intent is first committed with its semantic
 * journal in one encrypted IndexedDB transaction, then delivered through the
 * verified D1 receipt path. No Firebase store, implicit consent or optimistic
 * network success participates in this candidate-only use case.
 *
 * This is not the offline runtime: local readiness still needs a fresh trusted
 * Kinde session, consent, ADK and replica. Keep it outside the public provider
 * until the account owner/foreground/offline lifecycle is installed.
 */
export async function submitKindeCandidateDomainIntent({
    expected, operation, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: {
    expected: Readonly<Principal>;
    operation: DomainOperationBatch;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
}): Promise<CandidateMutationOutcome> {
    // The legal record is trusted D1 state, not a business mutation. Reject
    // this before any provider request, key opening or local write.
    const intents = normalizeDomainOperationBatch(operation);
    if (!intents.length || intents.some(intent => intent.type === 'legal-consent.set')) {
        throw new KindeCandidateBoundaryError();
    }

    return withKindeCandidateLocalReadiness(
        { expected, stillCurrent, send, browserCookies },
        async ({ owner, isCurrent }) => {
            const assertCurrent = () => { if (!isCurrent()) throw new KindeCandidateBoundaryError(); };
            assertCurrent();
            const initial = await readLocal(owner);
            assertCurrent();
            if (!initial || initial.consentRevision !== expected.healthConsentRevision
                || !initial.data.legalConsent) throw new KindeCandidateBoundaryError();

            // commitDomainOperations checks the pinned guard inside the same
            // IndexedDB update that persists both business data and journal.
            const committed = await commitDomainOperations(owner, intents, initial.data, isCurrent);
            assertCurrent();
            const durable = await readLocal(owner);
            assertCurrent();
            if (!durable || durable.owner !== owner
                || durable.consentRevision !== expected.healthConsentRevision
                || !equal(durable.data.legalConsent, initial.data.legalConsent)
                || durable.cloudIntegrityFence || durable.cloudflareReplicaRetirement
                || durable.cloudflareReplicaClaim) throw new KindeCandidateBoundaryError();

            const allPending = (ops: readonly SemanticOperation[], pending: readonly SemanticOperation[]) =>
                ops.every(op => pending.some(candidate => sameOperation(candidate, op)));
            if (!allPending(committed.operations, durable.pending)) {
                // A concurrent writer/ACK may have moved the frontier. Never
                // claim a local journal or reissue the same user intention.
                throw new KindeCandidateBoundaryError();
            }
            if (committed.operations.length === 0) return { kind: 'local-only' };

            let outcome: Awaited<ReturnType<typeof deliverKindeCandidateJournal>> | undefined;
            try {
                outcome = await deliverKindeCandidateJournal({
                    stillCurrent: isCurrent, send, browserCookies,
                });
            } catch (error) {
                assertCurrent();
                // A lost HTTP response could mean D1 committed. Classify as
                // local-pending ONLY when the exact semantic journal still
                // exists; otherwise preserve the error for a fresh readback.
                const recovered = await readLocal(owner);
                assertCurrent();
                if (!recovered || recovered.consentRevision !== expected.healthConsentRevision
                    || !allPending(committed.operations, recovered.pending)) throw error;
                return { kind: 'local-pending', pendingCount: recovered.pending.length };
            }

            assertCurrent();
            const final = await readLocal(owner);
            assertCurrent();
            if (!final || final.consentRevision !== expected.healthConsentRevision
                || !equal(final.data.legalConsent, initial.data.legalConsent)
                || final.cloudIntegrityFence || final.cloudflareReplicaRetirement
                || final.cloudflareReplicaClaim) throw new KindeCandidateBoundaryError();

            const covered = (op: SemanticOperation) => {
                const meta = final.syncMetaByDocument[op.docPath];
                return Boolean(meta && coversVectorClock(meta.clock, op.clock));
            };
            const waiting = committed.operations.filter(op =>
                final.pending.some(candidate => sameOperation(candidate, op)));
            if (outcome === 'acknowledged' && waiting.length === 0
                && !final.cloudflareDelivery && committed.operations.every(covered)) {
                // The delivery path already verified and persisted the exact
                // D1 receipt. A single ACK never means all future edits drained.
                return { kind: 'cloud-acknowledged', operations: committed.operations.length };
            }
            if (waiting.length > 0 && committed.operations.every(op =>
                waiting.some(pending => sameOperation(pending, op)) || covered(op))) {
                return { kind: 'local-pending', pendingCount: final.pending.length };
            }
            // Even 'idle' after a concurrent ACK is not proof that THIS
            // invocation delivered its intent; ask the caller to reconcile.
            throw new KindeCandidateBoundaryError();
        },
    );
}
