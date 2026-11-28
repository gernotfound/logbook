import equal from 'fast-deep-equal';
import { getCachedCatalog } from '../catalog/catalogService';
import { assertCloudBusinessPreserved } from './cloudBusinessIntegrity';
import { readAccountCloudDocument } from './cloudDocumentRead';
import { readAuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import { prepareCloudflareCommit } from './cloudReplicaCommit';
import { parseCloudflareDeliveryIntent, type CloudflareDeliveryIntent } from './cloudReplicaDeliveryRecord';
import { normalizeRemote } from './cloudMergeEngine';
import { projectDocuments, rootDocument, type DocumentData } from './documentProjection';
import type {
    CloudReplicaCompleteScan, createCloudflareReplicaTransport,
} from './cloudReplicaTransport';
import { readLocal } from './localArchiveBootstrap';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope } from './localEnvelopeValidation';
import type { LocalEnvelope } from './localEnvelopeValidation';
import { applySemanticOperations, coversVectorClock, diffDocuments, mergeVectors, parseSyncMeta } from './semanticProjection';
import { fieldKey, pathFromFieldKey } from './semanticProjection/metadata';
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
 * Workout history is sharded by month but causally keyed by workout ID. Two
 * independent upserts in the SAME month can be restaged without replacing
 * one another. Overlapping workout IDs, incomplete stamps, peer deletes and
 * unaccounted clocks must stay pending for explicit reconciliation.
 */
function independentHistoryEntityRebase(
    local: LocalEnvelope,
    operations: CloudflareDeliveryIntent['operations'],
    path: string,
    staged: NormalizedCloudDocument | undefined,
    verified: NormalizedCloudDocument | undefined,
    baseline: DocumentData,
    allDocuments: ReadonlyMap<string, NormalizedCloudDocument>,
): boolean {
    if (!path.startsWith('history_months/') || !staged || !verified
        || !operations.length || operations.some(op => op.docPath !== path || op.path.length < 1
            || op.guard || op.isDelete)) return false;

    const touched = new Set(operations.map(op => op.path[0]));
    const original = normalizeRemote(path, staged.business);
    const remote = normalizeRemote(path, verified.business);
    assertCloudBusinessPreserved(path, staged.business, original);
    assertCloudBusinessPreserved(path, verified.business, remote);

    // The original immutable ciphertext must be exactly the replay of the
    // current durable baseline and original operations, not a substitute for
    // a missing cloud snapshot or a hidden local overwrite.
    const replay = applySemanticOperations(new Map([[path, baseline]]), operations,
        local.syncMetaByDocument).documents.get(path);
    if (!equal(replay, original)) return false;

    const changed = new Set<string>();
    for (const id of new Set([...Object.keys(baseline), ...Object.keys(remote)])) {
        if (equal(baseline[id], remote[id])) continue;
        if (touched.has(id) || !Object.hasOwn(remote, id)) return false;
        changed.add(id);
    }
    if (!changed.size) return false;
    // A workout ID is globally stable even though its storage is monthly.
    // A competing move or duplicate ID in another month cannot be treated as
    // an independent insertion in this shard.
    for (const [otherPath, document] of allDocuments) {
        if (otherPath === path || !otherPath.startsWith('history_months/')) continue;
        if ([...touched, ...changed].some(id => Object.hasOwn(document.business, id))) return false;
    }

    // Use the SAME semantic diff policy as production, and demand a current
    // field stamp for every changed path. A stamp on one field of a workout
    // cannot account for changed sibling fields or an ignored mutation.
    let remoteChanges;
    try {
        remoteChanges = diffDocuments(new Map([[path, baseline]]), new Map([[path, remote]]),
            'diagnostic', 1, { diagnostic: 1 });
    } catch { return false; }
    if (!remoteChanges.length || remoteChanges.some(op => op.isDelete
        || !changed.has(op.path[0]) || touched.has(op.path[0]))) return false;
    const witnessed = new Set(remoteChanges.map(op => fieldKey(op.path)));

    const previous = parseSyncMeta(local.syncMetaByDocument[path]);
    const current = parseSyncMeta(verified.sync);
    if (!coversVectorClock(current.clock, previous.clock)) return false;
    let accountedClock = mergeVectors(previous.clock, ...operations.map(op => op.clock));
    const observed = new Set<string>();
    for (const key of new Set([...Object.keys(previous.fields), ...Object.keys(current.fields)])) {
        if (equal(previous.fields[key], current.fields[key])) continue;
        const recordPath = pathFromFieldKey(key);
        if (!recordPath.length || !changed.has(recordPath[0]) || !witnessed.has(key)) return false;
        const stamp = current.fields[key];
        if (!stamp || stamp.deleted || stamp.deleteClock || stamp.guard || stamp.candidates?.length
            || !Object.hasOwn(remote, recordPath[0])) return false;
        observed.add(key);
        accountedClock = mergeVectors(accountedClock, stamp.clock);
    }
    if (observed.size !== witnessed.size) return false;
    return coversVectorClock(accountedClock, current.clock);
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
    const stagedByPath = new Map(original.batch.documents.map(document => [document.path, document.document]));
    // Every D1 document write records the committing control revision.
    // Unchanged documents can be safely re-sealed; changed documents need
    // actual causal and business witnesses, not just a successful AEAD scan.
    const originalRoot = stagedByPath.get('');
    const openedOriginalRoot = originalRoot ? readAccountCloudDocument(
        originalRoot, 'D1 original recovery intent', uid, '', accountKey,
    ) : undefined;
    const changedHistory = paths.some(path => path.startsWith('history_months/')
        && (byPath.get(path)?.revision ?? 0) > original.batch.expectedRevision);
    const catalog = changedHistory ? await getCachedCatalog() : undefined;
    requireCurrent(guard);
    const baselineDocuments = catalog ? projectDocuments(local.baseline, catalog) : new Map<string, DocumentData>();
    if (paths.some(path => (byPath.get(path)?.revision ?? 0) > original.batch.expectedRevision
        && !(path === '' && openedOriginalRoot && independentProfileRebase(local,
            original.operations, openedOriginalRoot, checkpoint.documents.get(path)))
        && !(path.startsWith('history_months/') && independentHistoryEntityRebase(
            local, original.operations.filter(op => op.docPath === path), path,
            stagedByPath.has(path)
                ? readAccountCloudDocument(stagedByPath.get(path),
                    'D1 original history recovery intent', uid, path, accountKey) : undefined,
            checkpoint.documents.get(path), baselineDocuments.get(path) ?? {}, checkpoint.documents)))) {
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
