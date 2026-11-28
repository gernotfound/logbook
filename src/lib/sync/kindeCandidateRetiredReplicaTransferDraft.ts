import equal from 'fast-deep-equal';
import {
    captureKindeCandidatePreWithdrawalSources, assertKindeCandidatePreWithdrawalSourcesStable,
} from '../auth/kindeCandidatePreWithdrawalExport';
import { KindeCandidateBoundaryError } from '../auth/kindeCandidateClient';
import { getCachedCatalog } from '../catalog/catalogService';
import { createCloudflareReplicaTransport } from './cloudReplicaTransport';
import { inspectKindeCandidateOfflineReplicaJournal } from './kindeCandidateOfflineReplicaJournal';
import { userOwner } from './owner';
import { buildRetiredReplicaTransferDraft, stageRetiredReplicaTransferDraft } from './retiredReplicaTransferDraft';
import { unlockVaultForOwner } from './secureArchiveSession';

type Options = Parameters<typeof inspectKindeCandidateOfflineReplicaJournal>[0];

/** Explicit owner-vault-only escrow; the candidate fitness API remains disabled. */
export async function preserveKindeCandidateRetiredReplicaTransferDraft({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: Options): Promise<{ cloudRevision: number; savedRevision: number; pendingOperations: number; conflictingEntities: number }> {
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
        const draft = buildRetiredReplicaTransferDraft(expected.uid, local,
            sources.observed.checkpoint, afterControl, catalog);
        await assertKindeCandidatePreWithdrawalSourcesStable(sources);
        if (!current()) throw new KindeCandidateBoundaryError();
        const savedRevision = await stageRetiredReplicaTransferDraft(owner, local, draft, current);
        if (!current()) throw new KindeCandidateBoundaryError();
        return { cloudRevision: draft.cloudRevision, savedRevision,
            pendingOperations: draft.sourcePending.length, conflictingEntities: draft.selectedConflicts.length };
    } finally {
        grant.release();
    }
}
