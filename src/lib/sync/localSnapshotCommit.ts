import { updateArchiveRecord } from './secureArchiveRepository';
import { StaleLocalRevisionError } from './localRevisionError';
import { enforceMonthlyEntityTombstones } from './monthlyEntityTombstones';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { generateId } from '../utils/date';
import equal from 'fast-deep-equal';
import { type SemanticOperation, diffDocuments, applySemanticOperations } from './semanticProjection';
import { projectDocuments, applyRemoteDocuments } from './documentProjection';
import { getCachedCatalog } from '../catalog/catalogService';
import { normalizeStorageOwner } from './owner';
import { CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL } from '../schemaEvolution';
import { sequenceOperationsForBoundedTransactions } from './syncBatching';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';

const currentEnvelopeVersions = () => ({
    version: CURRENT_LOCAL_ENVELOPE,
    dataSchemaVersion: CURRENT_DATA_SCHEMA,
    syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
});

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

export function assertWorkoutNotClosed(id: string, envelope: LocalEnvelope | undefined): void {
    if (envelope && (envelope.lastClosedWorkoutId === id || envelope.closedWorkoutIds?.includes(id))) {
        throw new Error('Allenamento già terminato o eliminato: ricarica la sessione aggiornata.');
    }
}

export async function commitLocal(owner: string, data: UserData, initialBase: UserData, guard?: () => boolean, expectedRevision?: number): Promise<SemanticOperation[]> {
    owner = normalizeStorageOwner(owner);
    const desired = structuredClone(parse(data));
    const callerBase = structuredClone(parse(initialBase));
    let operations: SemanticOperation[] = [];
    const catalog = await getCachedCatalog();
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) throw new Error('Commit locale invalidato dal cambio sessione');
        const current = validateLocalEnvelope(raw, owner);
        if (expectedRevision !== undefined && (
            current?.revision !== expectedRevision
            || !current
            || !equal(parse(current.data), callerBase)
        )) {
            throw new StaleLocalRevisionError(expectedRevision, current?.revision ?? null);
        }
        const currentData = structuredClone(parse(current?.data ?? callerBase));
        const baseDocs = projectDocuments(callerBase, catalog);
        const desiredDocs = projectDocuments(desired, catalog);
        const actorId = current?.replica?.slot ?? current?.actorId ?? generateId('actor');
        const baseSeq = current?.actorSeq ?? 0;
        const provisionalSeq = baseSeq + 1;
        const provisionalClock = { ...(current?.clock ?? {}), [actorId]: provisionalSeq };
        operations = diffDocuments(baseDocs, desiredDocs, actorId, provisionalSeq, provisionalClock);
        operations = enforceMonthlyEntityTombstones(baseDocs, desiredDocs, operations, actorId, provisionalSeq, provisionalClock);

        if (operations.length === 0) {
            // A no-op must not reseal or rewrite a validated durable journal.
            if (current) return raw;
            return { ...currentEnvelopeVersions(), owner, actorId, actorSeq: 0, clock: {}, data: desired, baseline: callerBase, completeMonths: [], pending: [], syncMetaByDocument: {}, replica: null, revision: 0 };
        }

        const sequenced = sequenceOperationsForBoundedTransactions(
            operations,
            actorId,
            baseSeq,
            current?.clock ?? {},
        );
        operations = sequenced.operations;
        const nextSeq = sequenced.actorSeq;
        const testClock = sequenced.clock;

        // Snapshot boundaries express intent relative to the caller's observed base.
        // Replay only that delta over the latest durable envelope so concurrent changes
        // unknown to this tab cannot be converted into deletions/tombstones.
        const currentDocs = projectDocuments(currentData, catalog);
        const { documents: reconciledDocs } = applySemanticOperations(currentDocs, operations);
        const reconciled = applyRemoteDocuments(currentData, reconciledDocs, catalog);
        reconciled.pendingConflicts = currentData.pendingConflicts;
        const savedData = parse(reconciled);
        if (savedData.activeWorkout?.id) assertWorkoutNotClosed(String(savedData.activeWorkout.id), current);

        return { ...(current ?? { completeMonths: [], replica: null }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: nextSeq, clock: testClock, data: savedData, baseline: current?.baseline ?? callerBase, completeMonths: current?.completeMonths ?? [], pending: owner === 'guest' ? [] : [...(current?.pending ?? []), ...operations], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: (current?.revision ?? 0) + 1 };
    });
    return operations;
}

