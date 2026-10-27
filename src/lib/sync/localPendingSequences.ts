import { getArchiveRecord, updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
import { normalizeStorageOwner } from './owner';
import { resequencePendingOperationsForBoundedTransactions } from './syncBatching';

// Recheck inside the IndexedDB update: the initial read cannot prove another tab
// has not changed the journal or replica actor before compaction is committed.
export async function ensureBoundedPendingSequences(owner: string, expectedActorId: string): Promise<LocalEnvelope | undefined> {
    owner = normalizeStorageOwner(owner);
    const observed = validateLocalEnvelope(await getArchiveRecord<unknown>(owner), owner);
    if (!observed || observed.actorId !== expectedActorId) return observed;

    const initial = resequencePendingOperationsForBoundedTransactions(
        observed.pending,
        expectedActorId,
        observed.actorSeq,
        observed.clock,
    );
    if (!initial.changed) return observed;

    let saved: LocalEnvelope | undefined;
    await updateArchiveRecord<unknown>(owner, raw => {
        const current = validateLocalEnvelope(raw, owner);
        if (!current || current.actorId !== expectedActorId) {
            saved = current;
            return current;
        }

        const bounded = resequencePendingOperationsForBoundedTransactions(
            current.pending,
            expectedActorId,
            current.actorSeq,
            current.clock,
        );
        if (!bounded.changed) {
            saved = current;
            return current;
        }

        saved = {
            ...current,
            pending: bounded.operations,
            actorSeq: bounded.actorSeq,
            clock: bounded.clock,
            revision: current.revision + 1,
        };
        return saved;
    });
    return saved;
}
