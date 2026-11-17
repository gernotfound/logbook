export { StaleLocalRevisionError } from './localRevisionError';
export { rebaseConsentRecoveryWithExplicitChoice } from './localConsentJournalRecovery';
export { readLocal, initializeLocal } from './localArchiveBootstrap';
export { commitLocal } from './localSnapshotCommit';
export { commitDomainOperations, WorkoutIntentConflictError } from './localDomainCommit';
export type { DomainCommitResult } from './localDomainCommit';
export {
    advanceLocalConsentRevisionIfClean,
    revertRejectedConsent,
} from './localConsentReconciliation';
export {
    markCloudIntegrityBlocked,
    completeCloudIntegrityRecovery,
    markReplicaCheckpointRequired,
} from './localCloudIntegrity';
export type { LocalEnvelope } from './localEnvelopeValidation';
export { hydrateLocal, IncompleteCloudSnapshotError } from './localCloudHydration';

export type { CloudCoverageMode } from './localCloudHydration';
export type LocalWriteGuard = () => boolean;


export { ensureBoundedPendingSequences } from './localPendingSequences';

export { adoptReplicaCheckpoint } from './localReplicaCheckpoint';

export { acknowledgeThrough } from './localJournalAcknowledgement';

export { clearNutritionConflict } from './localNutritionConflict';
