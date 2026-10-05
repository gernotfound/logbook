import type { SemanticOperation, VectorClock } from './semanticProjection';

export const MAX_SYNC_DOCUMENTS_PER_TRANSACTION = 8;

function assertDocumentLimit(maxDocuments: number): void {
    if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 1) {
        throw new Error('Limite documenti sync non valido');
    }
}

function chunkByDocument(operations: SemanticOperation[], maxDocuments: number): SemanticOperation[][] {
    assertDocumentLimit(maxDocuments);
    const grouped = new Map<string, SemanticOperation[]>();
    for (const operation of operations) {
        const items = grouped.get(operation.docPath);
        if (items) items.push(operation);
        else grouped.set(operation.docPath, [operation]);
    }

    const entries = [...grouped.values()];
    const chunks: SemanticOperation[][] = [];
    for (let index = 0; index < entries.length; index += maxDocuments) {
        chunks.push(entries.slice(index, index + maxDocuments).flat());
    }
    return chunks;
}

export function distinctDocumentCount(operations: SemanticOperation[]): number {
    return new Set(operations.map(operation => operation.docPath)).size;
}

export function sequenceOperationsForBoundedTransactions(
    operations: SemanticOperation[],
    actorId: string,
    baseSeq: number,
    baseClock: VectorClock,
    maxDocuments = MAX_SYNC_DOCUMENTS_PER_TRANSACTION,
): { operations: SemanticOperation[]; actorSeq: number; clock: VectorClock } {
    if (operations.length === 0) {
        return { operations: [], actorSeq: baseSeq, clock: { ...baseClock } };
    }

    let actorSeq = Math.max(baseSeq, baseClock[actorId] ?? 0);
    const sequenced: SemanticOperation[] = [];
    for (const chunk of chunkByDocument(operations, maxDocuments)) {
        actorSeq += 1;
        const chunkClock: VectorClock = { ...baseClock, [actorId]: actorSeq };
        for (const operation of chunk) {
            sequenced.push({
                ...operation,
                actorId,
                seq: actorSeq,
                clock: chunkClock,
            });
        }
    }

    return {
        operations: sequenced,
        actorSeq,
        clock: { ...baseClock, [actorId]: actorSeq },
    };
}

export function resequencePendingOperationsForBoundedTransactions(
    pending: SemanticOperation[],
    actorId: string,
    actorSeq: number,
    clock: VectorClock,
    maxDocuments = MAX_SYNC_DOCUMENTS_PER_TRANSACTION,
): { operations: SemanticOperation[]; actorSeq: number; clock: VectorClock; changed: boolean } {
    if (pending.length === 0) {
        return { operations: pending, actorSeq, clock: { ...clock }, changed: false };
    }
    if (pending.some(operation => operation.actorId !== actorId)) {
        throw new Error('Journal locale appartiene a un actor diverso');
    }

    const bySequence = new Map<number, SemanticOperation[]>();
    for (const operation of pending) {
        const group = bySequence.get(operation.seq);
        if (group) group.push(operation);
        else bySequence.set(operation.seq, [operation]);
    }

    let previousAssignedSeq = 0;
    let changed = false;
    const resequenced: SemanticOperation[] = [];

    for (const originalSeq of [...bySequence.keys()].sort((left, right) => left - right)) {
        const originalGroup = bySequence.get(originalSeq)!;
        const chunks = chunkByDocument(originalGroup, maxDocuments);
        if (chunks.length > 1) changed = true;

        let assignedSeq = Math.max(originalSeq, previousAssignedSeq + 1);
        for (const [chunkIndex, chunk] of chunks.entries()) {
            if (chunkIndex > 0) assignedSeq = previousAssignedSeq + 1;
            if (assignedSeq !== originalSeq) changed = true;

            for (const operation of chunk) {
                const operationClock = operation.clock[actorId] === assignedSeq
                    ? operation.clock
                    : { ...operation.clock, [actorId]: assignedSeq };
                resequenced.push({
                    ...operation,
                    seq: assignedSeq,
                    clock: operationClock,
                });
            }
            previousAssignedSeq = assignedSeq;
        }
    }

    if (!changed) {
        return { operations: pending, actorSeq, clock: { ...clock }, changed: false };
    }

    const nextActorSeq = Math.max(actorSeq, previousAssignedSeq);
    return {
        operations: resequenced,
        actorSeq: nextActorSeq,
        clock: { ...clock, [actorId]: Math.max(clock[actorId] ?? 0, nextActorSeq) },
        changed: true,
    };
}

export function firstPendingSequenceBatch(pending: SemanticOperation[]): SemanticOperation[] {
    if (pending.length === 0) return [];
    const firstSeq = pending.reduce((minimum, operation) => Math.min(minimum, operation.seq), Number.POSITIVE_INFINITY);
    return pending.filter(operation => operation.seq === firstSeq);
}
