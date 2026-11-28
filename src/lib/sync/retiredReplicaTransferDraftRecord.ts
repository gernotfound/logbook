import equal from 'fast-deep-equal';
import type { UserData } from '../../types';
import { UserDataSchema } from '../schema';
import { findLossyNormalization } from './businessNormalizationIntegrity';
import type { DocumentData } from './documentProjection';
import { normalizeStorageOwner } from './owner';
import { parseReplicaIdentity, type ReplicaIdentity } from './replicaProtocol';
import type { RetiredReplicaResolvedEntity } from './retiredReplicaConflictMaterialization';
import {
    coversVectorClock, parseSemanticOperation, parseSyncMeta, parseVectorClock,
    type SemanticOperation, type SyncMeta, type VectorClock,
} from './semanticProjection';

const MAX_DRAFT_BYTES = 8 * 1024 * 1024;
const MAX_DRAFT_DOCUMENTS = 1024;
const MONTH_PATH = /^(history_months|nutrition_months)\/\d{4}-(0[1-9]|1[0-2])$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const pathIsDocument = (path: string): boolean => path === '' || MONTH_PATH.test(path);

type DraftDocument = { path: string; business: DocumentData; sync: SyncMeta };
type ProposedDocument = { path: string; business: DocumentData };

/** Historical owner-vault evidence, never an adopted clock, claim, batch or ACK. */
export type RetiredReplicaTransferDraft = {
    format: 1;
    owner: string;
    consentRevision: number;
    fenceEpoch: number;
    cloudRevision: number;
    localRevision: number;
    sourceReplica: ReplicaIdentity;
    sourceActorSeq: number;
    sourceClock: VectorClock;
    sourcePending: SemanticOperation[];
    sourceBaseline: UserData;
    sourceData: UserData;
    sourceSyncMetaByDocument: Record<string, SyncMeta>;
    remoteDocuments: DraftDocument[];
    proposedDocuments: ProposedDocument[];
    selectedConflicts: RetiredReplicaResolvedEntity[];
    capturedAt: string;
};

function preserveBusiness(value: unknown, section: string): UserData {
    const parsed = UserDataSchema.parse(value) as unknown as UserData;
    if (findLossyNormalization(value, parsed)) {
        throw new Error(`Snapshot ${section} non conservabile senza perdita.`);
    }
    // Keep the exact serialized source, not fields added by schema defaults.
    return value as UserData;
}

function documentEntries(raw: unknown, remote: true): DraftDocument[];
function documentEntries(raw: unknown, remote: false): ProposedDocument[];
function documentEntries(raw: unknown, remote: boolean): Array<DraftDocument | ProposedDocument> {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_DRAFT_DOCUMENTS) {
        throw new Error('Documenti della proposta di trasferimento incompleti.');
    }
    const paths = new Set<string>();
    return raw.map(item => {
        if (!isRecord(item) || Object.keys(item).sort().join(',') !== (remote ? 'business,path,sync' : 'business,path')
            || typeof item.path !== 'string' || !pathIsDocument(item.path)
            || paths.has(item.path) || !isRecord(item.business)) {
            throw new Error('Percorso o documento di trasferimento non valido.');
        }
        paths.add(item.path);
        return remote ? { path: item.path, business: item.business, sync: parseSyncMeta(item.sync) }
            : { path: item.path, business: item.business };
    });
}

/** Run on every owner-vault read; a malformed draft must not be silently discarded. */
export function parseRetiredReplicaTransferDraft(raw: unknown, owner: string): RetiredReplicaTransferDraft {
    if (!isRecord(raw) || Object.keys(raw).sort().join(',') !==
        'capturedAt,cloudRevision,consentRevision,fenceEpoch,format,localRevision,owner,proposedDocuments,remoteDocuments,selectedConflicts,sourceActorSeq,sourceBaseline,sourceClock,sourceData,sourcePending,sourceReplica,sourceSyncMetaByDocument'
        || raw.format !== 1 || raw.owner !== normalizeStorageOwner(owner)
        || !Number.isSafeInteger(raw.consentRevision) || Number(raw.consentRevision) < 1
        || !Number.isSafeInteger(raw.fenceEpoch) || Number(raw.fenceEpoch) < 1
        || !Number.isSafeInteger(raw.cloudRevision) || Number(raw.cloudRevision) < 0
        || !Number.isSafeInteger(raw.localRevision) || Number(raw.localRevision) < 0
        || !Number.isSafeInteger(raw.sourceActorSeq) || Number(raw.sourceActorSeq) < 1
        || typeof raw.capturedAt !== 'string' || !Number.isFinite(Date.parse(raw.capturedAt))
        || !Array.isArray(raw.sourcePending) || raw.sourcePending.length < 1
        || !Array.isArray(raw.selectedConflicts) || raw.selectedConflicts.length > 128
        || !isRecord(raw.sourceSyncMetaByDocument)) {
        throw new Error('Proposta di trasferimento non valida: originali cifrati preservati.');
    }
    // Cap the whole lossless JSON before recursively walking arbitrarily large records.
    const serialized = JSON.stringify(raw);
    if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).byteLength > MAX_DRAFT_BYTES
        || !equal(raw, JSON.parse(serialized))) {
        throw new Error('Proposta di trasferimento troppo grande o non serializzabile.');
    }
    const sourceReplica = parseReplicaIdentity(raw.sourceReplica);
    if (!sourceReplica) throw new Error('Identità della replica sorgente assente.');
    const sourceClock = parseVectorClock(raw.sourceClock, 'retired transfer source clock');
    if (sourceClock[sourceReplica.slot] !== raw.sourceActorSeq) {
        throw new Error('Sequenza causale del trasferimento incoerente.');
    }
    const sourcePending = raw.sourcePending.map(parseSemanticOperation);
    if (sourcePending.some(operation => operation.actorId !== sourceReplica.slot
        || operation.seq > Number(raw.sourceActorSeq)
        || !coversVectorClock(sourceClock, operation.clock))) {
        throw new Error('Journal sorgente non attribuibile alla replica ritirata.');
    }
    const sourceSyncMetaByDocument: Record<string, SyncMeta> = {};
    for (const [path, meta] of Object.entries(raw.sourceSyncMetaByDocument)) {
        if (!pathIsDocument(path)) throw new Error('Percorso causale di origine non valido.');
        const parsed = parseSyncMeta(meta);
        if (!coversVectorClock(sourceClock, parsed.clock)) {
            throw new Error('Metadati causali di origine fuori frontier.');
        }
        Object.defineProperty(sourceSyncMetaByDocument, path, {
            value: parsed, enumerable: true, configurable: true, writable: true,
        });
    }
    const remoteDocuments = documentEntries(raw.remoteDocuments, true);
    const proposedDocuments = documentEntries(raw.proposedDocuments, false);
    if (!remoteDocuments.some(item => item.path === '') || !proposedDocuments.some(item => item.path === '')
        || sourcePending.some(operation => !pathIsDocument(operation.docPath))) {
        throw new Error('Copertura dei documenti del trasferimento incompleta.');
    }
    const selectedConflicts: RetiredReplicaResolvedEntity[] = [];
    const seen = new Set<string>();
    for (const item of raw.selectedConflicts) {
        if (!isRecord(item) || Object.keys(item).sort().join(',') !== 'choice,docPath,entityId,kind,value'
            || !['history', 'nutrition', 'active-workout'].includes(String(item.kind))
            || !['device', 'cloud', 'combined'].includes(String(item.choice))
            || typeof item.entityId !== 'string' || !item.entityId || item.entityId.length > 128
            || (item.kind === 'active-workout' && item.entityId !== 'activeWorkout')
            || (item.docPath !== null && (typeof item.docPath !== 'string'
                || (item.kind === 'active-workout' ? item.docPath !== '' : !MONTH_PATH.test(item.docPath))))
            || (item.docPath === null && item.value !== null)
            || seen.has(`${item.kind}:${item.entityId}`)) {
            throw new Error('Scelta di conflitto nella proposta non valida.');
        }
        seen.add(`${item.kind}:${item.entityId}`);
        selectedConflicts.push(item as RetiredReplicaResolvedEntity);
    }
    const draft: RetiredReplicaTransferDraft = {
        format: 1, owner: raw.owner as string,
        consentRevision: raw.consentRevision as number, fenceEpoch: raw.fenceEpoch as number,
        cloudRevision: raw.cloudRevision as number, localRevision: raw.localRevision as number,
        sourceReplica, sourceActorSeq: raw.sourceActorSeq as number,
        sourceClock, sourcePending,
        sourceBaseline: preserveBusiness(raw.sourceBaseline, 'baseline'),
        sourceData: preserveBusiness(raw.sourceData, 'device'),
        sourceSyncMetaByDocument, remoteDocuments, proposedDocuments, selectedConflicts,
        capturedAt: raw.capturedAt as string,
    };
    if (!equal(raw, draft)) throw new Error('Proposta alterata: originali cifrati preservati.');
    return draft;
}
