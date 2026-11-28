import {
    captureKindeCandidatePreWithdrawalSources,
    assertKindeCandidatePreWithdrawalSourcesStable,
} from './kindeCandidatePreWithdrawalExport';
import { KindeCandidateBoundaryError } from './kindeCandidateClient';
import { formatKindeCandidateExportDocuments } from './kindeCandidateExportDocuments';
import { inspectKindeCandidateOfflineReplicaJournal } from '../sync/kindeCandidateOfflineReplicaJournal';
import { userOwner } from '../sync/owner';
import { unlockVaultForOwner } from '../sync/secureArchiveSession';

type Options = Parameters<typeof inspectKindeCandidateOfflineReplicaJournal>[0];
const MAX_JSON_BYTES = 64 * 1024 * 1024;

/**
 * A human-controlled, non-restorable evidence copy for a retired writer.
 * The original encrypted journal stays in IndexedDB; cloud and device versions
 * are never combined or reattributed. This is not a recovery transaction.
 */
export async function prepareKindeCandidateRetiredReplicaEvidenceJson(options: Options): Promise<{
    filename: string; json: string; pendingOperationCount: number; cloudDocumentCount: number;
}> {
    const first = await inspectKindeCandidateOfflineReplicaJournal(options);
    if (first.kind !== 'retired-pending') throw new KindeCandidateBoundaryError();
    const grant = await unlockVaultForOwner(userOwner(options.expected.uid), options.stillCurrent);
    try {
        const sources = await captureKindeCandidatePreWithdrawalSources({
            ...options, stillCurrent: () => options.stillCurrent() && grant.isCurrent(),
            keyPurpose: 'recovery-inspect',
        });
        const { envelope, witnesses, observed, owner } = sources;
        if (!envelope || envelope.pending.length !== first.pendingOperations
            || !envelope.replica || envelope.replica.slot !== first.slot
            || envelope.replica.generation !== first.generation) {
            throw new KindeCandidateBoundaryError();
        }

        // Membership is a historical observation. A later cloud transition
        // does not invalidate an authenticated revision or grant replay.
        await assertKindeCandidatePreWithdrawalSourcesStable(sources);

        const exportedAt = new Date().toISOString();
        const documents = formatKindeCandidateExportDocuments(observed.checkpoint);
        const json = JSON.stringify({
            format: 'thelogbook-retired-replica-evidence', version: 1,
            type: 'retired-replica-evidence', owner, exportedAt,
            coverage: {
                scope: 'separate-cloud-and-retired-device-evidence',
                cloudCompleteAtObservedRevision: true,
                deviceReadsStableAtObservation: true,
                atomicAcrossSources: false,
                restorableBackup: false,
                mayContainCompetingVersions: true,
                containsPendingJournal: true,
                containsDeviceOnlyDrafts: Object.keys(witnesses).some(name => name.startsWith('draft:')
                    || name === 'draft_exercise' || name === 'draft_routine'),
            },
            retiredReplica: { slot: first.slot, generation: first.generation,
                reasonAtObservation: first.reason, pendingOperationCount: first.pendingOperations },
            cloud: {
                revision: observed.checkpoint.revision,
                fenceEpoch: observed.checkpoint.fenceEpoch,
                consentRevision: observed.checkpoint.consentRevision,
                documents,
            },
            device: { envelope, recovery: witnesses },
        }, null, 2);
        if (new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES) throw new KindeCandidateBoundaryError();
        await assertKindeCandidatePreWithdrawalSourcesStable(sources);
        return {
            filename: 'thelogbook_replica_ritirata_' + exportedAt.slice(0, 10) + '.json',
            json, pendingOperationCount: envelope.pending.length,
            cloudDocumentCount: documents.length,
        };
    } finally { grant.release(); }
}
