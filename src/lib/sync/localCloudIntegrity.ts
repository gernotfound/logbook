import { generateId } from '../utils/date';
import { normalizeStorageOwner } from './owner';
import { ReplicaFencedError, type ReplicaIdentity } from './replicaProtocol';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';

/**
 * Integrity/recovery mutations stay atomic through the same IndexedDB gateway
 * as localRepository. Hydration can also use the pure fence transition within
 * its own IndexedDB update rather than creating a second transaction.
 */
export function fenceCloudIntegrity(current: LocalEnvelope): LocalEnvelope {
    // A newly detected divergence must invalidate a recovery based on any
    // earlier observation, even when another tab is attempting a checkpoint.
    return {
        ...current,
        cloudIntegrityFence: generateId('cloud-fence'),
        replica: current.replica ? { ...current.replica, checkpointAtMs: 1, leaseUntilMs: 1 } : null,
        revision: current.revision + 1,
    };
}

export async function markCloudIntegrityBlocked(owner: string): Promise<void> {
    owner = normalizeStorageOwner(owner);
    await updateArchiveRecord<any>(owner, raw => {
        const current = validateLocalEnvelope(raw, owner);
        if (!current) throw new Error('Archivio locale non disponibile per la protezione cloud');
        return fenceCloudIntegrity(current);
    });
}

export async function completeCloudIntegrityRecovery(
    owner: string, expectedFence: string | null, fullCheckpointCompleted: boolean, guard?: () => boolean,
): Promise<LocalEnvelope> {
    owner = normalizeStorageOwner(owner);
    let saved: LocalEnvelope | undefined;
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) return raw;
        const current = validateLocalEnvelope(raw, owner);
        if (!current) throw new Error('Archivio locale non disponibile durante il recupero cloud');
        if ((current.cloudIntegrityFence ?? null) !== expectedFence) {
            throw new ReplicaFencedError('La verifica cloud è stata invalidata da una nuova divergenza; copia locale preservata.');
        }
        if (expectedFence && (!fullCheckpointCompleted || !current.replica || current.replica.leaseUntilMs <= Date.now())) {
            throw new ReplicaFencedError('La divergenza cloud richiede un checkpoint completo prima dello sblocco.');
        }
        saved = expectedFence ? { ...current, cloudIntegrityFence: undefined, revision: current.revision + 1 } : current;
        return saved;
    });
    if (!saved) throw new Error('Recupero cloud invalidato dal cambio di sessione');
    return saved;
}

export async function markReplicaCheckpointRequired(
    owner: string,
    expectedReplica?: ReplicaIdentity,
): Promise<void> {
    owner = normalizeStorageOwner(owner);
    await updateArchiveRecord<any>(owner, raw => {
        const current = validateLocalEnvelope(raw, owner);
        if (!current?.replica) return current;
        if (expectedReplica && (
            current.replica.slot !== expectedReplica.slot
            || current.replica.replicaId !== expectedReplica.replicaId
            || current.replica.generation !== expectedReplica.generation
        )) return current;

        return {
            ...current,
            replica: {
                ...current.replica,
                checkpointAtMs: 1,
                leaseUntilMs: 1,
            },
            revision: current.revision + 1,
        };
    });
}

