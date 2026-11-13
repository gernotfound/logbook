import { getArchiveRecord, updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
import { normalizeStorageOwner } from './owner';
import { resequencePendingOperationsForBoundedTransactions } from './syncBatching';

// Recheck inside the IndexedDB update: the initial read cannot prove another tab
// has not changed the journal or replica actor before compaction is committed.
export async function ensureBoundedPendingSequences(owner: string, expectedActorId: string, guard?: () => boolean): Promise<LocalEnvelope | undefined> {
    owner = normalizeStorageOwner(owner);
    const observed = validateLocalEnvelope(await getArchiveRecord<unknown>(owner), owner);
    if (guard && !guard()) throw new Error('Sequenze journal invalidate dal cambio sessione; dati locali preservati.');
    if (!observed || observed.actorId !== expectedActorId) return observed;

    const initial = resequencePendingOperationsForBoundedTransactions(
        observed.pending,
        expectedActorId,
        observed.actorSeq,
        observed.clock,
    );
    if (!initial.changed) return observed;
    if (observed.cloudflareDelivery) {
        throw new Error('Intento D1 pendente: risequenziamento sospeso fino alla riconciliazione del batch.');
    }

    let saved: LocalEnvelope | undefined;
    await updateArchiveRecord<unknown>(owner, raw => {
        if (guard && !guard()) throw new Error('Sequenze journal invalidate dal cambio sessione; dati locali preservati.');
        const current = validateLocalEnvelope(raw, owner);
        if (!current || current.actorId !== expectedActorId) {
            saved = current;
            return raw;
        }

        const bounded = resequencePendingOperationsForBoundedTransactions(
            current.pending,
            expectedActorId,
            current.actorSeq,
            current.clock,
        );
        if (!bounded.changed) {
            saved = current;
            return raw;
        }
        if (current.cloudflareDelivery) {
            throw new Error('Intento D1 pendente: risequenziamento sospeso fino alla riconciliazione del batch.');
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
