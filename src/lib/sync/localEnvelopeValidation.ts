import type { UserData } from '../../types';
import { UserDataSchema } from '../schema';
import { normalizeBusinessId } from '../businessIdentity';
import {
    CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE, CURRENT_SYNC_PROTOCOL,
    normalizeLocalEnvelopeRecord,
} from '../schemaEvolution';
import { normalizeStorageOwner } from './owner';
import { parseReplicaIdentity, type ReplicaIdentity } from './replicaProtocol';
import {
    coversVectorClock, parseSemanticOperation, parseSyncMeta, parseVectorClock,
    type SemanticOperation, type SyncMeta, type VectorClock,
} from './semanticProjection';

interface LocalEnvelopeV5 {
    version: typeof CURRENT_LOCAL_ENVELOPE;
    dataSchemaVersion: typeof CURRENT_DATA_SCHEMA;
    syncProtocolVersion: typeof CURRENT_SYNC_PROTOCOL;
    owner: string;
    actorId: string;
    actorSeq: number;
    clock: VectorClock;
    data: UserData;
    baseline: UserData;
    completeMonths: string[];
    pending: SemanticOperation[];
    syncMetaByDocument: Record<string, SyncMeta>;
    replica: ReplicaIdentity | null;
    revision: number;
    // Persistent owner-scoped barrier for unverified cloud snapshots.
    cloudIntegrityFence?: string;
    // An older journal must never be replayed under a newly accepted consent.
    consentRevision?: number;
    // Original local state is retained after an explicit, non-silent replay.
    // The entire original journal is included in JSON backup/recovery.
    archivedConsentJournals?: Array<{
        sourceConsentRevision: number;
        capturedAt: string;
        data: UserData;
        baseline: UserData;
        pending: SemanticOperation[];
    }>;
    // Owner-scoped closure evidence committed with the business mutation.
    // Older V5 envelopes legitimately omit this field.
    lastClosedWorkoutId?: string;
    // Owner-local closure ledger fences snapshots from suspended old tabs.
    closedWorkoutIds?: string[];
    // Synchronous device-workout write-ahead intent, journaled atomically with its business edit.
    lastWorkoutDeviceIntent?: { generation: string; sequence: number; intentId?: string; parentIntentId?: string; ancestorIds?: string[] };
}

export type LocalEnvelope = LocalEnvelopeV5;
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

export function validateLocalEnvelope(value: unknown, owner: string): LocalEnvelope | undefined {
    // Only a missing IndexedDB key means no archive. Invalid stored values
    // must fail closed so bootstrap cannot replace them with fresh data.
    if (value === undefined) return undefined;

    const canonicalOwner = normalizeStorageOwner(owner);
    // Dispatch on the container version before assuming the current envelope shape.
    // A future envelope may legitimately rename/move current-version fields such as owner.
    const migrated = normalizeLocalEnvelopeRecord(value);
    const record = migrated as Record<string, unknown>;
    if (record.owner !== canonicalOwner) throw new Error('Archivio locale non riconosciuto: conservato per il recupero');
    if (typeof record.actorId !== 'string' || !record.actorId.trim()) throw new Error('Archivio locale causale non valido');
    if (typeof record.actorSeq !== 'number' || !Number.isSafeInteger(record.actorSeq) || record.actorSeq < 0) {
        throw new Error('Archivio locale causale non valido');
    }

    const clock = parseVectorClock(record.clock, 'local envelope clock');
    if ((clock[record.actorId] ?? 0) !== record.actorSeq) throw new Error('Archivio locale causale non valido');

    if (!Array.isArray(record.pending)) throw new Error('Journal locale non valido');
    const pending = record.pending.map(parseSemanticOperation);
    for (const operation of pending) {
        if (operation.actorId !== record.actorId || operation.seq > record.actorSeq || !coversVectorClock(clock, operation.clock)) {
            throw new Error('Journal locale causale non valido');
        }
    }

    if (!record.syncMetaByDocument || typeof record.syncMetaByDocument !== 'object' || Array.isArray(record.syncMetaByDocument)) {
        throw new Error('Metadati sync locali non validi');
    }
    const syncMetaByDocument: Record<string, SyncMeta> = {};
    for (const [path, rawMeta] of Object.entries(record.syncMetaByDocument as Record<string, unknown>)) {
        const meta = parseSyncMeta(rawMeta);
        if (!coversVectorClock(clock, meta.clock)) throw new Error('Metadati sync locali fuori dal frontier');
        syncMetaByDocument[path] = meta;
    }

    if (!Array.isArray(record.completeMonths) || record.completeMonths.some(month => typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
        throw new Error('Copertura mensile locale non valida');
    }
    if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 0) {
        throw new Error('Revisione locale non valida');
    }

    if (record.cloudIntegrityFence !== undefined && (typeof record.cloudIntegrityFence !== 'string' || !record.cloudIntegrityFence.trim())) {
        throw new Error('Barriera integrità cloud locale non valida');
    }

    if (record.lastClosedWorkoutId !== undefined && (
        typeof record.lastClosedWorkoutId !== 'string'
        || normalizeBusinessId(record.lastClosedWorkoutId) !== record.lastClosedWorkoutId
    )) throw new Error('Identificativo workout chiuso non valido');

    if (record.closedWorkoutIds !== undefined && (
        !Array.isArray(record.closedWorkoutIds)
        || record.closedWorkoutIds.some(id => typeof id !== 'string' || normalizeBusinessId(id) !== id)
        || new Set(record.closedWorkoutIds).size !== record.closedWorkoutIds.length
    )) throw new Error('Registro workout chiusi non valido');

    if (record.lastWorkoutDeviceIntent !== undefined && (
        !record.lastWorkoutDeviceIntent || typeof record.lastWorkoutDeviceIntent !== 'object'
        || Array.isArray(record.lastWorkoutDeviceIntent)
        || typeof (record.lastWorkoutDeviceIntent as { generation?: unknown }).generation !== 'string'
        || !/^[a-f0-9]{32}$/.test((record.lastWorkoutDeviceIntent as { generation: string }).generation)
        || !Number.isSafeInteger((record.lastWorkoutDeviceIntent as { sequence?: unknown }).sequence)
        || Number((record.lastWorkoutDeviceIntent as { sequence: number }).sequence) < 1
        || ((record.lastWorkoutDeviceIntent as { intentId?: unknown }).intentId !== undefined
            && (typeof (record.lastWorkoutDeviceIntent as { intentId: unknown }).intentId !== 'string'
                || !/^[a-f0-9]{32}$/.test((record.lastWorkoutDeviceIntent as { intentId: string }).intentId)))
        || ((record.lastWorkoutDeviceIntent as { parentIntentId?: unknown }).parentIntentId !== undefined
            && (typeof (record.lastWorkoutDeviceIntent as { parentIntentId: unknown }).parentIntentId !== 'string'
                || !/^[a-f0-9]{32}$/.test((record.lastWorkoutDeviceIntent as { parentIntentId: string }).parentIntentId)))
        || ((record.lastWorkoutDeviceIntent as { ancestorIds?: unknown }).ancestorIds !== undefined
            && (!Array.isArray((record.lastWorkoutDeviceIntent as { ancestorIds: unknown }).ancestorIds)
                || (record.lastWorkoutDeviceIntent as { ancestorIds: string[] }).ancestorIds.length > 64
                || (record.lastWorkoutDeviceIntent as { ancestorIds: string[] }).ancestorIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
                || new Set((record.lastWorkoutDeviceIntent as { ancestorIds: string[] }).ancestorIds).size
                    !== (record.lastWorkoutDeviceIntent as { ancestorIds: string[] }).ancestorIds.length))
    )) throw new Error('Controllo journal workout locale non valido');

    if (record.consentRevision !== undefined && (
        typeof record.consentRevision !== 'number' || !Number.isSafeInteger(record.consentRevision) || record.consentRevision < 0
    )) throw new Error('Generazione consenso dell’archivio locale non valida');

    if (record.archivedConsentJournals !== undefined) {
        if (!Array.isArray(record.archivedConsentJournals) || record.archivedConsentJournals.length > 32) {
            throw new Error('Archivio storico dei consensi non valido');
        }
        for (const entry of record.archivedConsentJournals) {
            if (!entry || typeof entry !== 'object'
                || !Number.isSafeInteger(entry.sourceConsentRevision) || entry.sourceConsentRevision < 0
                || typeof entry.capturedAt !== 'string' || !Number.isFinite(Date.parse(entry.capturedAt))
                || !Array.isArray(entry.pending)) throw new Error('Storico di recupero non valido');
            parse(entry.data); parse(entry.baseline);
            entry.pending.forEach(parseSemanticOperation);
        }
    }

    const replica = parseReplicaIdentity(record.replica);

    return {
        ...(record as unknown as LocalEnvelopeV5),
        actorId: record.actorId,
        actorSeq: record.actorSeq,
        clock,
        data: parse(record.data),
        baseline: parse(record.baseline),
        completeMonths: [...record.completeMonths] as string[],
        pending,
        syncMetaByDocument,
        replica,
        revision: record.revision,
    };
}

