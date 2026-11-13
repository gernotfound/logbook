import equal from 'fast-deep-equal';
import {
    CloudReplicaMutationReconciliationRequiredError,
    type CloudReplicaControlSnapshot, type createCloudflareReplicaTransport,
} from './cloudReplicaTransport';
import {
    parseCloudflareReplicaRetirementIntent, type CloudflareReplicaRetirementIntent,
} from './cloudReplicaRetirementRecord';
import { readLocal } from './localRepository';
import { normalizeStorageOwner } from './owner';
import type { ReplicaIdentity } from './replicaProtocol';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope } from './localEnvelopeValidation';

type Guard = () => boolean;
type Transport = Pick<ReturnType<typeof createCloudflareReplicaTransport>, 'replayStoredRetirement' | 'control'>;
const SKEW_MS = 5 * 60 * 1000;

function current(guard: Guard): void {
    if (!guard()) throw new Error('Retirement D1 invalidato dalla sessione: journal preservato.');
}

function account(ownerInput: string): string {
    const owner = normalizeStorageOwner(ownerInput);
    if (!owner.startsWith('user:') || owner.length <= 5) {
        throw new Error('Retirement D1 riservato a un account verificato.');
    }
    return owner;
}

function sameReplica(a: Pick<ReplicaIdentity, 'slot' | 'replicaId' | 'generation'>,
    b: Pick<ReplicaIdentity, 'slot' | 'replicaId' | 'generation'>): boolean {
    return a.slot === b.slot && a.replicaId === b.replicaId && a.generation === b.generation;
}

/**
 * The request, including the original mutationId, is committed in the
 * owner-encrypted IndexedDB vault BEFORE any network call. An expired lease
 * only permits retiring a membership; it cannot prove causal GC safety.
 */
export async function stageCloudflareReplicaRetirement(
    ownerInput: string,
    control: CloudReplicaControlSnapshot,
    replica: Pick<ReplicaIdentity, 'slot' | 'replicaId' | 'generation'>,
    guard: Guard,
): Promise<CloudflareReplicaRetirementIntent> {
    const owner = account(ownerInput);
    current(guard);
    const entry = control.replicas[replica.slot];
    if (!Number.isSafeInteger(control.revision) || control.revision < 0
        || !Number.isSafeInteger(control.fenceEpoch) || control.fenceEpoch < 1
        || !Number.isSafeInteger(control.consentRevision) || control.consentRevision < 1
        || !entry || entry.status !== 'active' || !sameReplica({ ...entry, slot: replica.slot }, replica)
        || !Number.isSafeInteger(entry.leaseUntilMs)
        || entry.leaseUntilMs + SKEW_MS >= Date.now()) {
        throw new Error('Replica D1 non ritirabile: rileggere il registro senza modificare il journal.');
    }

    const mutationId = crypto.randomUUID();
    let staged: CloudflareReplicaRetirementIntent | undefined;
    await updateArchiveRecord<unknown>(owner, raw => {
        current(guard);
        const local = validateLocalEnvelope(raw, owner);
        if (!local || local.cloudIntegrityFence || local.cloudflareDelivery
            || local.cloudflareReplicaClaim || local.cloudflareReplicaRetirement
            || local.consentRevision !== control.consentRevision) {
            throw new Error('Retirement D1 non installabile: archivio, consenso o sync non coerenti.');
        }
        const intent = parseCloudflareReplicaRetirementIntent({
            mutationId, expectedRevision: control.revision,
            expectedFenceEpoch: control.fenceEpoch,
            consentRevision: control.consentRevision,
            replica: { slot: replica.slot, replicaId: replica.replicaId,
                generation: replica.generation },
        }, local.consentRevision);
        staged = intent;
        return { ...local, cloudflareReplicaRetirement: intent, revision: local.revision + 1 };
    });
    current(guard);
    if (!staged) throw new Error('Intento retirement D1 non persistito.');
    return staged;
}

/**
 * A historical receipt cannot prove which incarnation occupies a slot now.
 * Require a fresh, stable control with the exact retired incarnation before
 * clearing the intent atomically. No business journal entry is ACKed here.
 */
export async function resumeCloudflareReplicaRetirement(
    ownerInput: string,
    transport: Transport,
    csrfToken: string,
    guard: Guard,
): Promise<'idle' | 'retired' | 'reconciliation-required'> {
    const owner = account(ownerInput);
    current(guard);
    if (!csrfToken) throw new Error('Sessione D1 assente: retirement sospeso.');
    const local = await readLocal(owner);
    current(guard);
    if (!local) throw new Error('Archivio locale assente: retirement sospeso.');
    const intent = local.cloudflareReplicaRetirement;
    if (!intent) return 'idle';
    if (local.cloudIntegrityFence || local.cloudflareDelivery || local.cloudflareReplicaClaim
        || local.consentRevision !== intent.consentRevision) {
        throw new Error('Barriera integrità D1: retirement sospeso.');
    }

    let receipt;
    try {
        receipt = await transport.replayStoredRetirement(intent, csrfToken);
    } catch (error) {
        current(guard);
        if (error instanceof CloudReplicaMutationReconciliationRequiredError) {
            return 'reconciliation-required';
        }
        throw error;
    }
    current(guard);
    if (receipt.action !== 'retire' || receipt.mutationId !== intent.mutationId
        || receipt.revision !== intent.expectedRevision + 1
        || !sameReplica(receipt.replica, intent.replica)
        || receipt.reconciliationRequired) return 'reconciliation-required';

    const control = await transport.control();
    current(guard);
    const entry = control.replicas[intent.replica.slot];
    if (control.revision !== receipt.currentRevision
        || control.fenceEpoch !== intent.expectedFenceEpoch
        || control.consentRevision !== intent.consentRevision
        || !entry || entry.status !== 'retired'
        || !sameReplica({ ...entry, slot: intent.replica.slot }, intent.replica)
        || entry.lastSeq !== receipt.baseSeq
        || entry.leaseUntilMs !== receipt.replica.leaseUntilMs
        || entry.checkpointAtMs !== receipt.replica.checkpointAtMs) {
        return 'reconciliation-required';
    }
    const again = await transport.control();
    current(guard);
    if (!equal(control, again)) return 'reconciliation-required';

    await updateArchiveRecord<unknown>(owner, raw => {
        current(guard);
        const saved = validateLocalEnvelope(raw, owner);
        if (!saved || saved.cloudIntegrityFence || saved.cloudflareDelivery
            || saved.cloudflareReplicaClaim || saved.consentRevision !== intent.consentRevision
            || !equal(saved.cloudflareReplicaRetirement, intent)) {
            throw new Error('Retirement D1 variato durante il salvataggio: journal preservato.');
        }
        return { ...saved, cloudflareReplicaRetirement: undefined, revision: saved.revision + 1 };
    });
    current(guard);
    return 'retired';
}
