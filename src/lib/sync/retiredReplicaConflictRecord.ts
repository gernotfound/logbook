import equal from 'fast-deep-equal';
import { normalizeBusinessId } from '../businessIdentity';
import { normalizeStorageOwner } from './owner';
import { parseReplicaIdentity, type ReplicaIdentity } from './replicaProtocol';
import { coversVectorClock, parseSemanticOperation, parseSyncMeta, parseVectorClock,
    type SemanticOperation, type SyncMeta, type VectorClock } from './semanticProjection';

export const MAX_CONFLICT_ENTITIES = 128;
const MAX_CONFLICT_BYTES = 2 * 1024 * 1024;
const MONTH = /^(history_months|nutrition_months)\/\d{4}-(0[1-9]|1[0-2])$/;
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export type RetiredConflictKind = 'history' | 'nutrition' | 'active-workout';
export type RetiredConflictVersion = { docPath: string; value: unknown; sync: SyncMeta | null } | null;
type SourceDocument = { path: string; baseline: Record<string, unknown> | null;
    device: Record<string, unknown> | null; sync: SyncMeta | null };
type RetiredConflictEntry = {
    kind: RetiredConflictKind;
    entityId: string;
    baseline: RetiredConflictVersion;
    device: RetiredConflictVersion;
    cloud: RetiredConflictVersion;
};

/** Historical alternatives only; never an adopted baseline or an ACK. */
export type RetiredReplicaConflictCapsule = {
    format: 1;
    owner: string;
    consentRevision: number;
    fenceEpoch: number;
    cloudRevision: number;
    localRevision: number;
    sourceReplica: ReplicaIdentity;
    sourceClock: VectorClock;
    sourcePending: SemanticOperation[];
    sourceDocuments: SourceDocument[];
    capturedAt: string;
    entries: RetiredConflictEntry[];
};

function jsonBytes(value: unknown): number {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') throw new Error('Versioni in conflitto non serializzabili.');
    const copy: unknown = JSON.parse(encoded);
    if (!equal(value, copy)) throw new Error('Versioni in conflitto non conservabili senza perdita.');
    return new TextEncoder().encode(encoded).byteLength;
}

function version(value: unknown, kind: RetiredConflictKind): RetiredConflictVersion {
    if (value === null) return null;
    if (!record(value) || Object.keys(value).sort().join(',') !== 'docPath,sync,value'
        || typeof value.docPath !== 'string'
        || (kind === 'active-workout' ? value.docPath !== '' : !MONTH.test(value.docPath))
        || (kind === 'history' && !value.docPath.startsWith('history_months/'))
        || (kind === 'nutrition' && !value.docPath.startsWith('nutrition_months/'))) {
        throw new Error('Versione di conflitto non valida: archivio cifrato preservato.');
    }
    if (value.sync !== null) parseSyncMeta(value.sync);
    return value as RetiredConflictVersion;
}

/** Validate on every local read, including after a browser crash or restore. */
export function parseRetiredReplicaConflictCapsule(raw: unknown, owner: string): RetiredReplicaConflictCapsule {
    if (!record(raw) || Object.keys(raw).sort().join(',') !==
        'capturedAt,cloudRevision,consentRevision,entries,fenceEpoch,format,localRevision,owner,sourceClock,sourceDocuments,sourcePending,sourceReplica'
        || raw.format !== 1 || raw.owner !== normalizeStorageOwner(owner)
        || !Number.isSafeInteger(raw.consentRevision) || Number(raw.consentRevision) < 1
        || !Number.isSafeInteger(raw.fenceEpoch) || Number(raw.fenceEpoch) < 1
        || !Number.isSafeInteger(raw.cloudRevision) || Number(raw.cloudRevision) < 0
        || !Number.isSafeInteger(raw.localRevision) || Number(raw.localRevision) < 0
        || typeof raw.capturedAt !== 'string' || !Number.isFinite(Date.parse(raw.capturedAt))
        || !Array.isArray(raw.entries) || raw.entries.length < 1 || raw.entries.length > MAX_CONFLICT_ENTITIES
        || !Array.isArray(raw.sourcePending) || !raw.sourcePending.length
        || !Array.isArray(raw.sourceDocuments) || !raw.sourceDocuments.length
        || raw.sourceDocuments.length > 1024) {
        throw new Error('Registro versioni concorrenti non valido: archivio cifrato preservato.');
    }
    const sourceReplica = parseReplicaIdentity(raw.sourceReplica);
    if (!sourceReplica) throw new Error('Replica sorgente del conflitto assente.');
    const sourceClock = parseVectorClock(raw.sourceClock, 'conflict source clock');
    const sourcePending = raw.sourcePending.map(parseSemanticOperation);
    if (sourcePending.some(operation => operation.actorId !== sourceReplica.slot
        || !coversVectorClock(sourceClock, operation.clock))) {
        throw new Error('Provenienza del journal in conflitto non valida.');
    }
    const sourceDocuments: SourceDocument[] = [];
    const sourcePaths = new Set<string>();
    for (const source of raw.sourceDocuments) {
        if (!record(source) || Object.keys(source).sort().join(',') !== 'baseline,device,path,sync'
            || typeof source.path !== 'string' || (source.path !== '' && !MONTH.test(source.path))
            || sourcePaths.has(source.path)
            || (source.baseline !== null && !record(source.baseline))
            || (source.device !== null && !record(source.device))) {
            throw new Error('Documento sorgente del journal non valido.');
        }
        sourcePaths.add(source.path);
        if (source.sync !== null) parseSyncMeta(source.sync);
        sourceDocuments.push(source as SourceDocument);
    }
    if (sourcePending.some(operation => !sourcePaths.has(operation.docPath))) {
        throw new Error('Baseline sorgente del journal incompleta.');
    }
    const entries: RetiredConflictEntry[] = [];
    const seen = new Set<string>();
    for (const item of raw.entries) {
        if (!record(item) || Object.keys(item).sort().join(',') !== 'baseline,cloud,device,entityId,kind'
            || !['history', 'nutrition', 'active-workout'].includes(String(item.kind))
            || typeof item.entityId !== 'string' || !item.entityId || item.entityId.length > 128
            || (item.kind === 'active-workout' && item.entityId !== 'activeWorkout')) {
            throw new Error('Entità del conflitto non valida.');
        }
        const kind = item.kind as RetiredConflictKind;
        if ((kind === 'nutrition' && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(item.entityId as string))
            || (kind === 'history' && normalizeBusinessId(item.entityId) !== item.entityId)) {
            throw new Error('Identità business del conflitto non valida.');
        }
        const key = `${kind}:${item.entityId}`;
        if (seen.has(key)) throw new Error('Entità in conflitto duplicata.');
        seen.add(key);
        const baseline = version(item.baseline, kind);
        const device = version(item.device, kind);
        const cloud = version(item.cloud, kind);
        if (equal(baseline?.value, device?.value)
            || equal(baseline?.value, cloud?.value) || equal(device?.value, cloud?.value)) {
            throw new Error('Versioni del conflitto non concorrenti.');
        }
        entries.push({ kind, entityId: item.entityId, baseline, device, cloud });
    }
    const parsed: RetiredReplicaConflictCapsule = {
        format: 1, owner: raw.owner as string,
        consentRevision: raw.consentRevision as number, fenceEpoch: raw.fenceEpoch as number,
        cloudRevision: raw.cloudRevision as number, localRevision: raw.localRevision as number,
        sourceReplica, sourceClock, sourcePending, sourceDocuments,
        capturedAt: raw.capturedAt as string, entries,
    };
    if (!equal(raw, parsed) || jsonBytes(parsed) > MAX_CONFLICT_BYTES) {
        throw new Error('Registro conflitti modificato o troppo grande: originali preservati.');
    }
    return parsed;
}
