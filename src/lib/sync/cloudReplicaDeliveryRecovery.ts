import equal from 'fast-deep-equal';
import { readAuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import { prepareCloudflareCommit } from './cloudReplicaCommit';
import { parseCloudflareDeliveryIntent, type CloudflareDeliveryIntent } from './cloudReplicaDeliveryRecord';
import type {
    CloudReplicaCompleteScan, createCloudflareReplicaTransport,
} from './cloudReplicaTransport';
import { readLocal } from './localRepository';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope } from './localEnvelopeValidation';

type Transport = Pick<ReturnType<typeof createCloudflareReplicaTransport>,
    'commitOutcome' | 'control' | 'scanAll'>;
type Guard = () => boolean;

function requireCurrent(guard: Guard): void {
    if (!guard()) throw new Error('Sessione D1 cambiata: journal e intento preservati.');
}

/**
 * After a 409, only a primary-SQL proof that the ORIGINAL immutable batch
 * cannot commit permits rotating its ciphertext and batch ID. A complete
 * authenticated scan plus two stable control reads bind the replacement to
 * the newest causal state. No network write or ACK occurs in this function.
 */
export async function restageUncommittedCloudflareDelivery(
    ownerInput: string,
    accountKey: Uint8Array,
    transport: Transport,
    csrfToken: string,
    guard: Guard,
): Promise<'retry-staged' | 'reconciliation-required'> {
    const owner = normalizeStorageOwner(ownerInput);
    if (!owner.startsWith('user:') || owner.length <= 5
        || !(accountKey instanceof Uint8Array) || accountKey.length !== 32 || !csrfToken) {
        throw new Error('Account, chiave o sessione D1 non validi: intento preservato.');
    }
    requireCurrent(guard);
    const local = await readLocal(owner);
    requireCurrent(guard);
    if (!local || local.cloudIntegrityFence || local.cloudflareReplicaClaim
        || local.cloudflareReplicaRetirement || !local.cloudflareDelivery) {
        throw new Error('Intento D1 non recuperabile: journal preservato.');
    }
    const original = local.cloudflareDelivery;
    const uid = owner.slice(5);
    const proof = await transport.commitOutcome(original.batch, csrfToken);
    requireCurrent(guard);
    if (proof.outcome !== 'not-committed') return 'reconciliation-required';

    const control = await transport.control();
    requireCurrent(guard);
    const member = control.replicas[original.replica.slot];
    const firstSeq = original.operations.reduce((minimum, operation) =>
        Math.min(minimum, operation.seq), Number.POSITIVE_INFINITY);
    if (control.revision !== proof.currentRevision
        || control.revision <= original.batch.expectedRevision
        || control.fenceEpoch !== original.batch.expectedFenceEpoch
        || control.consentRevision !== original.batch.consentRevision
        || !member || member.status !== 'active'
        || member.replicaId !== original.replica.replicaId
        || member.generation !== original.replica.generation
        || member.leaseUntilMs <= Date.now()
        || !Number.isSafeInteger(member.lastSeq) || member.lastSeq >= firstSeq) {
        return 'reconciliation-required';
    }

    // scanAll() uses bounded, revision-fenced pages. Authenticate *every*
    // returned document before deriving the new write snapshot; not just the
    // documents touched by the stale journal.
    const scan: CloudReplicaCompleteScan = await transport.scanAll();
    requireCurrent(guard);
    const checkpoint = await readAuthenticatedCloudflareCheckpoint(
        async () => scan,
        uid, accountKey, original.batch.consentRevision, guard,
    );
    requireCurrent(guard);
    if (!scan || checkpoint.revision !== control.revision
        || checkpoint.fenceEpoch !== control.fenceEpoch
        || checkpoint.consentRevision !== control.consentRevision
        || scan.documents.length !== checkpoint.documents.size
        || scan.documents.some(item => !Number.isSafeInteger(item.revision)
            || item.revision < 1 || item.revision > checkpoint.revision)) {
        return 'reconciliation-required';
    }

    const again = await transport.control();
    requireCurrent(guard);
    if (!equal(control, again) || member.leaseUntilMs <= Date.now()) {
        return 'reconciliation-required';
    }

    const byPath = new Map(scan.documents.map(item => [item.path, item]));
    const paths = [...new Set(original.operations.map(operation => operation.docPath))];
    const snapshot = {
        revision: checkpoint.revision, fenceEpoch: checkpoint.fenceEpoch,
        consentRevision: checkpoint.consentRevision,
        documents: paths.map(path => ({
            path, revision: byPath.get(path)?.revision ?? null,
            document: byPath.get(path)?.document ?? null,
        })),
    };
    const batchId = crypto.randomUUID();
    const prepared = prepareCloudflareCommit(
        uid, original.operations, snapshot, control, original.replica,
        batchId, accountKey, guard,
    );
    const replacement: CloudflareDeliveryIntent = {
        batch: prepared.batch, replica: structuredClone(original.replica),
        operations: structuredClone(original.operations),
    };

    await updateArchiveRecord<unknown>(owner, raw => {
        requireCurrent(guard);
        const saved = validateLocalEnvelope(raw, owner);
        if (!saved || saved.cloudIntegrityFence || saved.cloudflareReplicaClaim
            || saved.cloudflareReplicaRetirement
            || !equal(saved.cloudflareDelivery, original)
            || saved.consentRevision !== original.batch.consentRevision
            || !saved.replica
            || saved.replica.slot !== original.replica.slot
            || saved.replica.replicaId !== original.replica.replicaId
            || saved.replica.generation !== original.replica.generation
            || saved.replica.leaseUntilMs <= Date.now()
            || member.leaseUntilMs <= Date.now()) {
            throw new Error('Rebase D1 concorrente o replica scaduta: intento originale preservato.');
        }
        // Validate both the old and replacement immutable causal prefix
        // against the *current* vault, including edits added by another tab.
        parseCloudflareDeliveryIntent(original, owner, saved.pending,
            saved.replica, saved.consentRevision);
        parseCloudflareDeliveryIntent(replacement, owner, saved.pending,
            saved.replica, saved.consentRevision);
        return { ...saved, cloudflareDelivery: replacement, revision: saved.revision + 1 };
    });
    requireCurrent(guard);
    return 'retry-staged';
}
