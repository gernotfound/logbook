import equal from 'fast-deep-equal';
import { captureKindeCandidatePreWithdrawalSources,
    assertKindeCandidatePreWithdrawalSourcesStable } from '../auth/kindeCandidatePreWithdrawalExport';
import { KindeCandidateBoundaryError } from '../auth/kindeCandidateClient';
import { getCachedCatalog } from '../catalog/catalogService';
import { createCloudflareReplicaTransport } from './cloudReplicaTransport';
import { inspectKindeCandidateOfflineReplicaJournal } from './kindeCandidateOfflineReplicaJournal';
import { buildRetiredReplicaConflictCapsule, stageRetiredReplicaConflictCapsule } from './retiredReplicaConflictCapsule';
import { previewRetiredReplicaConflictResolution } from './retiredReplicaConflictResolution';
import { userOwner } from './owner';
import { unlockVaultForOwner } from './secureArchiveSession';

type Options = Parameters<typeof inspectKindeCandidateOfflineReplicaJournal>[0];

/**
 * Candidate-only, explicit preservation of competing versions in the existing
 * encrypted device vault. The cloud scan is authenticated with a pre-existing
 * ADK; this path never provisions a key, selects a winner or sends a commit.
 */
export async function preserveKindeCandidateRetiredReplicaConflicts({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: Options): Promise<{ preservedEntities: number; cloudRevision: number;
    automaticCandidates: number; manualRequired: number }> {
    const observed = await inspectKindeCandidateOfflineReplicaJournal({
        expected, stillCurrent, send, browserCookies,
    });
    if (observed.kind !== 'retired-pending') throw new KindeCandidateBoundaryError();
    const owner = userOwner(expected.uid);
    const grant = await unlockVaultForOwner(owner, stillCurrent);
    const current = () => stillCurrent() && grant.isCurrent();
    try {
        if (!current()) throw new KindeCandidateBoundaryError();
        const transport = createCloudflareReplicaTransport(send);
        const beforeControl = await transport.control();
        if (!current() || beforeControl.uid !== expected.uid
            || beforeControl.fenceEpoch !== expected.fenceEpoch
            || beforeControl.consentRevision !== expected.healthConsentRevision) {
            throw new KindeCandidateBoundaryError();
        }
        const sources = await captureKindeCandidatePreWithdrawalSources({
            expected, stillCurrent: current, send, browserCookies, keyPurpose: 'recovery-inspect',
        });
        const afterControl = await transport.control();
        if (!current() || !equal(beforeControl, afterControl)
            || sources.observed.checkpoint.revision !== afterControl.revision
            || sources.observed.checkpoint.fenceEpoch !== afterControl.fenceEpoch
            || sources.observed.checkpoint.consentRevision !== afterControl.consentRevision) {
            throw new KindeCandidateBoundaryError();
        }
        const local = sources.envelope;
        if (!local || !local.replica || local.replica.slot !== observed.slot
            || local.replica.generation !== observed.generation
            || local.pending.length !== observed.pendingOperations) throw new KindeCandidateBoundaryError();

        const catalog = await getCachedCatalog();
        if (!current()) throw new KindeCandidateBoundaryError();
        const capsule = buildRetiredReplicaConflictCapsule(expected.uid, local,
            sources.observed.checkpoint, afterControl, catalog);
        const drafts = previewRetiredReplicaConflictResolution(capsule);
        await assertKindeCandidatePreWithdrawalSourcesStable(sources);
        if (!current()) throw new KindeCandidateBoundaryError();
        const preservedEntities = await stageRetiredReplicaConflictCapsule(owner, local, capsule, current);
        if (!current()) throw new KindeCandidateBoundaryError();
        return { preservedEntities, cloudRevision: capsule.cloudRevision,
            automaticCandidates: drafts.filter(draft => draft.kind === 'automatic-candidate').length,
            manualRequired: drafts.filter(draft => draft.kind === 'manual-required').length };
    } finally {
        grant.release();
    }
}
