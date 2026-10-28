import { updateArchiveRecord } from './secureArchiveRepository';
export { StaleLocalRevisionError } from './localRevisionError';
export { rebaseConsentRecoveryWithExplicitChoice } from './localConsentJournalRecovery';
export { assertLegacyEnvelopeValidForSecureMigration, readLocal, initializeLocal } from './localArchiveBootstrap';
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
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { getNutritionConflictFingerprint } from '../utils/object';
import { normalizeStorageOwner } from './owner';
import { validateLocalEnvelope } from './localEnvelopeValidation';
export type { LocalEnvelope } from './localEnvelopeValidation';
export { hydrateLocal, IncompleteCloudSnapshotError } from './localCloudHydration';

export type { CloudCoverageMode } from './localCloudHydration';
export type LocalWriteGuard = () => boolean;

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

export { ensureBoundedPendingSequences } from './localPendingSequences';

export { adoptReplicaCheckpoint } from './localReplicaCheckpoint';

export { acknowledgeThrough } from './localJournalAcknowledgement';

export async function clearNutritionConflict(owner: string, fingerprint: string, guard?: LocalWriteGuard): Promise<UserData> {
    owner = normalizeStorageOwner(owner);
    let saved!: UserData;
    const clear = (data: UserData): UserData => {
        if (getNutritionConflictFingerprint(data.pendingConflicts?.nutritionPlanning) !== fingerprint) return data;
        const { nutritionPlanning: _resolved, ...remaining } = data.pendingConflicts ?? {};
        const { pendingConflicts: _old, ...rest } = data;
        return Object.keys(remaining).length ? { ...rest, pendingConflicts: remaining } : rest;
    };
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) throw new Error('Risoluzione conflitto invalidata dal cambio sessione');
        const current = validateLocalEnvelope(raw, owner);
        // A stale memory snapshot must never recreate a deleted owner archive.
        if (!current) throw new Error('Archivio locale assente durante la risoluzione del conflitto');
        if (!fingerprint || getNutritionConflictFingerprint(current.data.pendingConflicts?.nutritionPlanning) !== fingerprint) {
            throw new Error('Conflitto cambiato durante la risoluzione');
        }
        saved = parse(clear(current.data));
        return { ...current, data: saved, baseline: clear(current.baseline) };
    });
    return saved;
}

