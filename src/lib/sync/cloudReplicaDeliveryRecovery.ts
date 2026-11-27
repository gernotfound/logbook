import equal from 'fast-deep-equal';
import { assertCloudBusinessPreserved } from './cloudBusinessIntegrity';
import { readAccountCloudDocument } from './cloudDocumentRead';
import { readAuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import { prepareCloudflareCommit } from './cloudReplicaCommit';
import { parseCloudflareDeliveryIntent, type CloudflareDeliveryIntent } from './cloudReplicaDeliveryRecord';
import { normalizeRemote } from './cloudMergeEngine';
import { rootDocument } from './documentProjection';
import type {
    CloudReplicaCompleteScan, createCloudflareReplicaTransport,
} from './cloudReplicaTransport';
import { readLocal } from './localArchiveBootstrap';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope } from './localEnvelopeValidation';
import type { LocalEnvelope } from './localEnvelopeValidation';
import { coversVectorClock, mergeVectors, parseSyncMeta } from './semanticProjection';
import { pathFromFieldKey } from './semanticProjection/metadata';
import type { NormalizedCloudDocument } from '../schemaEvolution';

type Transport = Pick<ReturnType<typeof createCloudflareReplicaTransport>,
    'commitOutcome' | 'control' | 'scanAll'>;
type Guard = () => boolean;

function requireCurrent(guard: Guard): void {
    if (!guard()) throw new Error('Sessione D1 cambiata: journal e intento preservati.');
}

/**
 * A changed root can be rebased automatically only for independent profile
 * scalars. The complete new business root must equal the durable baseline
 * plus fields backed by previously unseen, disjoint causal stamps. This
 * rejects ABA, missing metadata and implicit dependencies (guards, ordering,
 * derived fields, collections); those require explicit reconciliation.
 */
function independentProfileRebase(
    local: LocalEnvelope,
    operations: CloudflareDeliveryIntent['operations'],
    staged: NormalizedCloudDocument,
    verified: NormalizedCloudDocument | undefined,
): boolean {
    if (!verified || !operations.length || operations.some(op => op.docPath !== ''
        || op.path.length !== 2 || op.path[0] !== 'profile' || op.guard
        || op.path[1] === '$order')) return false;

    const touched = new Set(operations.map(op => op.path[1]));
    const sourceClock = mergeVectors(...operations.map(op => op.clock));
    const meta = parseSyncMeta(verified.sync);
    let accountedClock = sourceClock;
    const independent = new Set<string>();
    for (const [key, stamp] of Object.entries(meta.fields)) {
        const witnesses = [stamp.clock, ...(stamp.deleteClock ? [stamp.deleteClock] : []),
            ...(stamp.candidates?.map(candidate => candidate.clock) ?? [])];
        const path = pathFromFieldKey(key);
        if (path.length === 2 && path[0] === 'profile' && touched.has(path[1])
            && operations.some(op => op.path[1] === path[1]
                && witnesses.some(clock => !coversVectorClock(op.clock, clock)))) return false;
        if (witnesses.every(clock => coversVectorClock(sourceClock, clock))) continue;
        if (path.length !== 2 || path[0] !== 'profile' || touched.has(path[1])) return false;
        independent.add(path[1]);
        accountedClock = mergeVectors(accountedClock, ...witnesses);
    }
    if (!independent.size || !coversVectorClock(accountedClock, meta.clock)) return false;

    const baseline = rootDocument(local.baseline);
    // The staged ciphertext is the immutable witness for OTHER root keys.
    // A local pre-claim baseline may have trusted legal fields that were not
    // yet present in the first cloud root; comparing those against the cloud
    // would falsely classify an unrelated profile edit as a conflict.
    const original = normalizeRemote('', staged.business);
    assertCloudBusinessPreserved('', staged.business, original);
    const remote = normalizeRemote('', verified.business);
    assertCloudBusinessPreserved('', verified.business, remote);
    const expected = structuredClone(original);
    const expectedProfile = { ...(baseline.profile as Record<string, unknown> | null ?? {}) };
    const remoteProfile = remote.profile as Record<string, unknown> | null;
    for (const field of independent) {
        if (remoteProfile && Object.hasOwn(remoteProfile, field)) expectedProfile[field] = remoteProfile[field];
        else delete expectedProfile[field];
    }
    expected.profile = expectedProfile;
    return equal(expected, remote);
}

/**
 * After a 409, only a primary-SQL proof that the ORIGINAL immutable batch
 * cannot commit permits rotating its ciphertext and batch ID. A complete
 * authenticated scan plus two stable control reads bind the replacement to
 * the newest causal state. A document changed since the original CAS cannot
 * be automatically rebased without a narrow proof of semantic independence.
 * No network write or ACK occurs in this function.
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
    if (control.uid !== uid || control.revision !== proof.currentRevision
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
    // Every D1 document write records the committing control revision.
    // Unchanged documents can be safely re-sealed; changed documents need
    // actual causal and business witnesses, not just a successful AEAD scan.
    const originalRoot = original.batch.documents.find(document => document.path === '');
    const openedOriginalRoot = originalRoot ? readAccountCloudDocument(
        originalRoot.document, 'D1 original recovery intent', uid, '', accountKey,
    ) : undefined;
    if (paths.some(path => (byPath.get(path)?.revision ?? 0) > original.batch.expectedRevision
        && (path !== '' || !openedOriginalRoot || !independentProfileRebase(local,
            original.operations, openedOriginalRoot, checkpoint.documents.get(path))))) {
        return 'reconciliation-required';
    }
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
            || !equal(saved.baseline, local.baseline)
            || !equal(saved.syncMetaByDocument, local.syncMetaByDocument)
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
