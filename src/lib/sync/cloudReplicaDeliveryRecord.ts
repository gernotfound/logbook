import equal from 'fast-deep-equal';
import type { CloudReplicaBatch } from './cloudReplicaTransport';
import { parseReplicaIdentity, type ReplicaIdentity } from './replicaProtocol';
import { parseSemanticOperation, parseSyncMeta, type SemanticOperation } from './semanticProjection';

export interface CloudflareDeliveryIntent {
    batch: CloudReplicaBatch;
    replica: ReplicaIdentity;
    operations: SemanticOperation[];
}

const PATH = /^(?:(?:history_months|nutrition_months)\/\d{4}-(?:0[1-9]|1[0-2]))?$/;
const BATCH_ID = /^[A-Za-z0-9_-]{16,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function safeInt(value: unknown, minimum = 0): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function invalidIntent(): never {
    throw new Error('Intento D1 non verificabile: ciphertext e journal locale preservati.');
}

/**
 * A D1 request must be replayed with the SAME sealed bytes, nonce and batch ID.
 * The record is inside the owner-encrypted vault and is validated on every
 * read, before a network attempt or a local acknowledgement.
 */
export function parseCloudflareDeliveryIntent(
    raw: unknown,
    owner: string,
    pending: SemanticOperation[],
    localReplica: ReplicaIdentity | null,
    consentRevision?: number,
): CloudflareDeliveryIntent {
    if (!owner.startsWith('user:') || !record(raw) || !record(raw.batch)
        || !Array.isArray(raw.operations) || raw.operations.length === 0) invalidIntent();
    const batch = raw.batch;
    const replica = parseReplicaIdentity(raw.replica);
    if (!replica || !localReplica || replica.slot !== localReplica.slot
        || replica.replicaId !== localReplica.replicaId
        || replica.generation !== localReplica.generation
        || !BATCH_ID.test(String(batch.batchId))
        || !safeInt(batch.expectedRevision) || !safeInt(batch.expectedFenceEpoch, 1)
        || !safeInt(batch.consentRevision, 1) || batch.consentRevision !== consentRevision
        || !safeInt(batch.lastSeq, 1)
        || !record(batch.replica) || batch.replica.slot !== replica.slot
        || batch.replica.replicaId !== replica.replicaId
        || batch.replica.generation !== replica.generation
        || !Array.isArray(batch.documents) || batch.documents.length < 1
        || batch.documents.length > 8) invalidIntent();

    let operations: SemanticOperation[];
    try { operations = raw.operations.map(parseSemanticOperation); }
    catch { return invalidIntent(); }

    const deliveredSeq = operations.at(-1)?.seq;
    if (!safeInt(deliveredSeq, 1) || deliveredSeq > batch.lastSeq
        || operations.some(op => op.actorId !== replica.slot || op.seq > deliveredSeq)
        || !equal(pending.filter(op => op.seq <= deliveredSeq), operations)) invalidIntent();

    const expectedPaths = new Set(operations.map(op => op.docPath));
    const seenPaths = new Set<string>();
    for (const entry of batch.documents) {
        if (!record(entry) || typeof entry.path !== 'string' || !PATH.test(entry.path)
            || !expectedPaths.has(entry.path) || seenPaths.has(entry.path)
            || !record(entry.document)) invalidIntent();
        const cloud = entry.document;
        if (cloud._schemaVersion !== 1 || !record(cloud._sync)
            || !record(cloud._sealed) || Object.keys(cloud).length !== 3) invalidIntent();
        const sealed = cloud._sealed;
        if (sealed.format !== 'thelogbook-cloud-document' || sealed.version !== 1
            || typeof sealed.nonce !== 'string' || sealed.nonce.length !== 32
            || !BASE64URL.test(sealed.nonce)
            || typeof sealed.ciphertext !== 'string' || sealed.ciphertext.length < 22
            || sealed.ciphertext.length > 950000 || !BASE64URL.test(sealed.ciphertext)
            || JSON.stringify(cloud).length > 950000) invalidIntent();
        let sync;
        try { sync = parseSyncMeta(cloud._sync); } catch { return invalidIntent(); }
        if (Object.keys(sync.fields).length !== 0 || !sync.writer
            || sync.writer.slot !== replica.slot || sync.writer.replicaId !== replica.replicaId
            || sync.writer.generation !== replica.generation
            || sync.writer.seq !== batch.lastSeq || sync.writer.consentRevision !== batch.consentRevision
            // A document may be causally behind the final batch sequence:
            // do not reject valid multi-sequence, multi-document deliveries.
            || (sync.clock[replica.slot] ?? 0) < 1
            || sync.clock[replica.slot] > batch.lastSeq) invalidIntent();
        seenPaths.add(entry.path);
    }
    if (seenPaths.size !== expectedPaths.size) invalidIntent();
    return { batch: batch as unknown as CloudReplicaBatch, replica, operations };
}
