import { getArchiveRecord, updateArchiveRecord } from './secureArchiveRepository';
import { StaleLocalRevisionError } from './localRevisionError';
export { StaleLocalRevisionError } from './localRevisionError';
export { rebaseConsentRecoveryWithExplicitChoice } from './localConsentJournalRecovery';
import { ownerConsentRevision } from './localConsentReconciliation';
export {
    advanceLocalConsentRevisionIfClean,
    revertRejectedConsent,
} from './localConsentReconciliation';
export {
    markCloudIntegrityBlocked,
    completeCloudIntegrityRecovery,
    markReplicaCheckpointRequired,
} from './localCloudIntegrity';
import { enforceMonthlyEntityTombstones } from './monthlyEntityTombstones';
import { UserDataSchema } from '../schema';
import { equivalentWorkoutSnapshot } from './workoutSnapshotEquality';
import type { UserData } from '../../types';
import { generateId } from '../utils/date';
import { getNutritionConflictFingerprint } from '../utils/object';
import equal from 'fast-deep-equal';
import { type SemanticOperation, diffDocuments, applySemanticOperations } from './semanticProjection';
import { projectDocuments, applyRemoteDocuments } from './documentProjection';
import { getCachedCatalog } from '../catalog/catalogService';
import { normalizeStorageOwner } from './owner';
import { readDeviceValueStrict } from './deviceStorage';
import { requireBusinessId } from '../businessIdentity';
import {
    applyDomainOperations,
    compileDomainOperations,
    normalizeDomainOperationBatch,
    type DomainOperationBatch,
} from './domainOperations';
import {
    CURRENT_DATA_SCHEMA,
    CURRENT_LOCAL_ENVELOPE,
    CURRENT_SYNC_PROTOCOL,
} from '../schemaEvolution';
import { sequenceOperationsForBoundedTransactions } from './syncBatching';

import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';
export type { LocalEnvelope } from './localEnvelopeValidation';
export { hydrateLocal, IncompleteCloudSnapshotError } from './localCloudHydration';

export type { CloudCoverageMode } from './localCloudHydration';
export type LocalWriteGuard = () => boolean;

export class WorkoutIntentConflictError extends Error {
    readonly code = 'workout-intent-conflict';

    constructor(detail: string) {
        super(detail);
        this.name = 'WorkoutIntentConflictError';
    }
}

const currentEnvelopeVersions = () => ({
    version: CURRENT_LOCAL_ENVELOPE,
    dataSchemaVersion: CURRENT_DATA_SCHEMA,
    syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
});

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

function assertWorkoutNotClosed(id: string, envelope: LocalEnvelope | undefined): void {
    if (envelope && (envelope.lastClosedWorkoutId === id || envelope.closedWorkoutIds?.includes(id))) {
        throw new Error('Allenamento già terminato o eliminato: ricarica la sessione aggiornata.');
    }
}

/** Migration-only read verifier. Enforces the full existing causal/schema contract. */
export function assertLegacyEnvelopeValidForSecureMigration(raw: unknown, owner: string): void {
    if (raw === undefined) return;
    if (!validateLocalEnvelope(raw, normalizeStorageOwner(owner))) {
        throw new Error('Archivio legacy non valido: migrazione sospesa senza modificare il dato.');
    }
}

export async function readLocal(owner: string): Promise<LocalEnvelope | undefined> {
    owner = normalizeStorageOwner(owner);
    return validateLocalEnvelope(await getArchiveRecord<any>(owner), owner);
}

export { ensureBoundedPendingSequences } from './localPendingSequences';

export async function commitLocal(owner: string, data: UserData, initialBase: UserData, guard?: LocalWriteGuard, expectedRevision?: number): Promise<SemanticOperation[]> {
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
            const stableData = current?.data ?? desired;
            return { ...(current ?? { completeMonths: [], replica: null }), ...currentEnvelopeVersions(), owner, actorId, actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: stableData, baseline: current?.baseline ?? callerBase, completeMonths: current?.completeMonths ?? [], pending: current?.pending ?? [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: current?.revision ?? 0 };
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

/**
 * IndexedDB writes are serialized but the synchronous Web Storage snapshot is
 * not. Verify ancestry INSIDE the same IDB transaction before accepting a
 * higher sequence from a different tab. Missing/corrupt parents are conflicts,
 * not evidence that an edit was superseded.
 */
function hasCommittedWorkoutAncestor(
    owner: string,
    candidate: { generation: string; sequence: number; parentIntentId?: string },
    applied: { generation: string; sequence: number; intentId?: string },
): boolean {
    if (!applied.intentId) return false;
    let parent = candidate.parentIntentId;
    let expectedSeq = candidate.sequence - 1;
    const seen = new Set<string>();
    while (parent && expectedSeq >= applied.sequence && !seen.has(parent)) {
        if (parent === applied.intentId) return expectedSeq === applied.sequence;
        seen.add(parent);
        const raw = readDeviceValueStrict('workout-intent:' + parent, owner);
        if (!raw) return false;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(raw) as Record<string, unknown>; }
        catch { throw new WorkoutIntentConflictError('Catena degli intenti workout non leggibile.'); }
        if (!parsed || parsed.__logbookWorkoutIntent !== 1 || parsed.owner !== owner
            || parsed.intentId !== parent || parsed.generation !== candidate.generation
            || parsed.sequence !== expectedSeq
            || (parsed.parentIntentId !== undefined
                && (typeof parsed.parentIntentId !== 'string' || !/^[a-f0-9]{32}$/.test(parsed.parentIntentId)))) {
            throw new WorkoutIntentConflictError('Catena degli intenti workout non valida.');
        }
        parent = parsed.parentIntentId as string | undefined;
        expectedSeq--;
    }
    return false;
}

export interface DomainCommitResult { operations: SemanticOperation[]; data: UserData; }

export async function commitDomainOperations(owner: string, batch: DomainOperationBatch, initialBase: UserData, guard?: LocalWriteGuard,
    workoutIntent?: { generation: string; sequence: number; consentRevision?: number; intentId?: string; parentIntentId?: string; ancestorIds?: string[]; baseline: import('../../types').WorkoutSession | null },
): Promise<DomainCommitResult> {
    owner = normalizeStorageOwner(owner);
    const domainOperations = normalizeDomainOperationBatch(batch);
    const fallback = structuredClone(parse(initialBase));
    const catalog = await getCachedCatalog();
    let operations: SemanticOperation[] = [];
    let savedData = fallback;
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) throw new Error('Commit locale invalidato dal cambio sessione');
        const current = validateLocalEnvelope(raw, owner);
        if (workoutIntent) {
            // Revalidate the source epoch IN the same IndexedDB commit which
            // would make this unacknowledged device snapshot a new cloud journal.
            // A revocation/reacceptance in another tab cannot restamp it.
            const localRevision = current?.consentRevision ?? 0;
            if (workoutIntent.consentRevision !== undefined
                ? (!Number.isSafeInteger(workoutIntent.consentRevision)
                    || workoutIntent.consentRevision < 1
                    || workoutIntent.consentRevision !== localRevision)
                : localRevision > 1) {
                throw new WorkoutIntentConflictError('Workout di un consenso precedente: journal invariato e copia dispositivo preservata.');
            }
            if (domainOperations.length !== 1 || domainOperations[0].type !== 'active-workout.set'
                || !domainOperations[0].workout || !owner.startsWith('user:')
                || !/^[a-f0-9]{32}$/.test(workoutIntent.generation)
                || !Number.isSafeInteger(workoutIntent.sequence) || workoutIntent.sequence < 1
                || (workoutIntent.intentId !== undefined && !/^[a-f0-9]{32}$/.test(workoutIntent.intentId))
                || (workoutIntent.parentIntentId !== undefined && !/^[a-f0-9]{32}$/.test(workoutIntent.parentIntentId))
                || (workoutIntent.ancestorIds !== undefined && (!Array.isArray(workoutIntent.ancestorIds)
                    || workoutIntent.ancestorIds.length > 64
                    || workoutIntent.ancestorIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
                    || new Set(workoutIntent.ancestorIds).size !== workoutIntent.ancestorIds.length
                    || (workoutIntent.parentIntentId !== undefined && workoutIntent.ancestorIds[0] !== workoutIntent.parentIntentId)))) {
                throw new Error('Intento workout non valido per il journal');
            }
            const applied = current?.lastWorkoutDeviceIntent;
            if (current?.data.activeWorkout && current.data.activeWorkout.id !== domainOperations[0].workout.id) {
                throw new Error('Workout attivo cambiato: intento device non applicabile.');
            }
            if (applied?.generation === workoutIntent.generation && applied.sequence > workoutIntent.sequence
                && applied.intentId && workoutIntent.intentId
                && !applied.ancestorIds?.includes(workoutIntent.intentId)) {
                throw new WorkoutIntentConflictError('Intento workout obsoleto ma non riconosciuto come antenato: dati preservati.');
            }
            if (applied?.generation === workoutIntent.generation && applied.sequence >= workoutIntent.sequence) {
                // A repeated sequence is idempotent only if it represents the
                // same workout. Different tabs can race on localStorage read/write
                // and independently allocate the same next sequence.
                if (applied.sequence === workoutIntent.sequence
                    && (applied.intentId !== undefined && workoutIntent.intentId !== undefined
                        ? applied.intentId !== workoutIntent.intentId
                        : !equivalentWorkoutSnapshot(current?.data.activeWorkout, domainOperations[0].workout))) {
                    throw new WorkoutIntentConflictError('Conflitto tra modifiche concorrenti del workout: journal preservato. Riapri TheLogBook per recuperare lo stato.');
                }
                savedData = current!.data;
                operations = [];
                return current;
            }
            if (applied?.generation === workoutIntent.generation
                && applied.sequence < workoutIntent.sequence && applied.intentId
                && (!workoutIntent.intentId || !(workoutIntent.ancestorIds?.includes(applied.intentId)
                    || hasCommittedWorkoutAncestor(owner, workoutIntent, applied)))) {
                throw new WorkoutIntentConflictError('Modifica workout non discendente dallo stato già registrato. Copie preservate.');
            }
            if (applied?.generation !== workoutIntent.generation
                && !equivalentWorkoutSnapshot(current?.data.activeWorkout, workoutIntent.baseline)) {
                throw new Error('Intento workout non collegato alla versione locale corrente');
            }
        }
        const intentPatch = workoutIntent
            ? { lastWorkoutDeviceIntent: { generation: workoutIntent.generation, sequence: workoutIntent.sequence,
                ...(workoutIntent.intentId ? { intentId: workoutIntent.intentId } : {}),
                ...(workoutIntent.parentIntentId ? { parentIntentId: workoutIntent.parentIntentId } : {}),
                ...(workoutIntent.ancestorIds ? { ancestorIds: workoutIntent.ancestorIds } : {}) } }
            : {};
        const base = current?.data ?? fallback;
        // A retry after a durable local completion can deliver an outstanding
        // journal without completing the same workout twice.
        const effectiveDomainOperations = domainOperations.map(operation => {
            if (operation.type !== 'workout.complete') return operation;
            const id = requireBusinessId(operation.workout.id, 'Allenamento completato');
            const previouslyClosed = current?.lastClosedWorkoutId === id || current?.closedWorkoutIds?.includes(id);
            if (!previouslyClosed) return operation;
            if (base.activeWorkout !== null || !base.history?.some(item => item.id === id)) {
                throw new Error('Allenamento già chiuso: impossibile completarlo nuovamente.');
            }
            return { type: 'active-workout.set' as const, workout: null };
        });
        const lastClosedWorkoutId = effectiveDomainOperations.reduce<string | undefined>((id, operation) => {
            if (operation.type === 'workout.complete') return requireBusinessId(operation.workout.id, 'Allenamento completato');
            if (operation.type === 'active-workout.set' && operation.deletedWorkoutId !== undefined) {
                if (operation.workout !== null) throw new Error('Eliminazione workout: stato incompatibile');
                return requireBusinessId(operation.deletedWorkoutId, 'Allenamento eliminato');
            }
            return id;
        }, undefined);
        const newlyClosedIds = effectiveDomainOperations.flatMap(operation =>
            operation.type === 'workout.complete'
                ? [requireBusinessId(operation.workout.id, 'Allenamento completato')]
                : operation.type === 'active-workout.set' && operation.deletedWorkoutId !== undefined
                    ? [requireBusinessId(operation.deletedWorkoutId, 'Allenamento eliminato')]
                    : []
        );
        for (const operation of effectiveDomainOperations) {
            if (operation.type === 'active-workout.set' && operation.workout) {
                assertWorkoutNotClosed(requireBusinessId(operation.workout.id, 'Allenamento attivo'), current);
            }
            if (operation.type === 'workout.complete') {
                assertWorkoutNotClosed(requireBusinessId(operation.workout.id, 'Allenamento completato'), current);
            }
        }
        if (lastClosedWorkoutId && effectiveDomainOperations.some(operation =>
            operation.type === 'active-workout.set' && operation.deletedWorkoutId !== undefined
        ) && base.activeWorkout && base.activeWorkout.id !== lastClosedWorkoutId) {
            throw new Error('Allenamento attivo cambiato prima della cancellazione');
        }
        const desired = applyDomainOperations(base, effectiveDomainOperations);
        const previousClosedIds = current?.closedWorkoutIds ?? [];
        // V5 envelopes written before the additive ledger retain only the last
        // closed ID. Fold it into the ledger before any subsequent closure can
        // replace that marker, without losing the fence for old browser tabs.
        const nextClosedIds = newlyClosedIds.length
            ? [...new Set([...previousClosedIds, ...(current?.lastClosedWorkoutId ? [current.lastClosedWorkoutId] : []), ...newlyClosedIds])]
            : previousClosedIds;
        const closure = {
            ...(lastClosedWorkoutId ? { lastClosedWorkoutId } : {}),
            ...(newlyClosedIds.length ? { closedWorkoutIds: nextClosedIds } : {}),
        };
        const closureChanged = (lastClosedWorkoutId !== undefined && lastClosedWorkoutId !== current?.lastClosedWorkoutId)
            || nextClosedIds.length !== previousClosedIds.length;
        const actorId = current?.replica?.slot ?? current?.actorId ?? generateId('actor');
        const baseSeq = current?.actorSeq ?? 0;
        const provisionalSeq = baseSeq + 1;
        const provisionalClock = { ...(current?.clock ?? {}), [actorId]: provisionalSeq };
        operations = compileDomainOperations(base, desired, effectiveDomainOperations, catalog, actorId, provisionalSeq, provisionalClock);
        savedData = desired;
        if (operations.length === 0) return { ...(current ?? { completeMonths: [], replica: null }), ...currentEnvelopeVersions(), ...closure, ...intentPatch, owner, actorId, actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: desired, baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [], pending: current?.pending ?? [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: (current?.revision ?? 0) + (closureChanged || workoutIntent ? 1 : 0) };
        const sequenced = sequenceOperationsForBoundedTransactions(operations, actorId, baseSeq, current?.clock ?? {});
        operations = sequenced.operations;
        return { ...(current ?? { completeMonths: [], replica: null }), ...currentEnvelopeVersions(), ...closure, ...intentPatch, owner, actorId, actorSeq: sequenced.actorSeq, clock: sequenced.clock, data: desired, baseline: current?.baseline ?? fallback, completeMonths: current?.completeMonths ?? [], pending: owner === 'guest' ? [] : [...(current?.pending ?? []), ...operations], syncMetaByDocument: current?.syncMetaByDocument ?? {}, replica: current?.replica ?? null, revision: (current?.revision ?? 0) + 1 };
    });
    return { operations, data: savedData };
}

export { adoptReplicaCheckpoint } from './localReplicaCheckpoint';

export { acknowledgeThrough } from './localJournalAcknowledgement';

export async function initializeLocal(owner: string, data: UserData, completeMonths?: string[], guard?: LocalWriteGuard): Promise<void> {
    owner = normalizeStorageOwner(owner);
    const parsed = structuredClone(parse(data));
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) throw new Error('Inizializzazione locale invalidata dal cambio sessione');
        const current = validateLocalEnvelope(raw, owner);
        // Bootstrap is create-if-absent, not a replacement write: the journal
        // can be empty (especially for guest or an acknowledged account) while
        // a concurrent tab has already committed durable business edits.
        if (current) return current;
        return { ...currentEnvelopeVersions(), ...ownerConsentRevision(owner), owner, actorId: generateId('actor'), actorSeq: 0, clock: {}, data: parsed, baseline: parsed, completeMonths: completeMonths ?? [], pending: [], syncMetaByDocument: {}, replica: null, revision: 0 };
    });
}

export async function clearNutritionConflict(owner: string, fingerprint: string, guard?: LocalWriteGuard): Promise<UserData> {
    owner = normalizeStorageOwner(owner);
    let saved!: UserData;
    const clear = (data: UserData): UserData => {
        const { nutritionPlanning: _resolved, ...remaining } = data.pendingConflicts ?? {};
        const { pendingConflicts: _old, ...rest } = data;
        return Object.keys(remaining).length ? { ...rest, pendingConflicts: remaining } : rest;
    };
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) throw new Error('Risoluzione conflitto invalidata dal cambio sessione');
        const current = validateLocalEnvelope(raw, owner);
        // A stale memory snapshot must never recreate a deleted owner archive.
        if (!current) throw new Error('Archivio locale assente durante la risoluzione del conflitto');
        if (!fingerprint || getNutritionConflictFingerprint(current.data.pendingConflicts?.nutritionPlanning) !== fingerprint) {
            throw new Error('Conflitto cambiato durante la risoluzione');
        }
        saved = parse(clear(current.data));
        return { ...current, data: saved, baseline: clear(current.baseline) };
    });
    return saved;
}

