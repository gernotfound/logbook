import equal from 'fast-deep-equal';
import {
    CloudReplicaMutationReconciliationRequiredError, CloudReplicaTransportError,
    type CloudReplicaControlSnapshot, type CloudReplicaMutationResult, type createCloudflareReplicaTransport,
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
type Transport = Pick<ReturnType<typeof createCloudflareReplicaTransport>, 'replayStoredRetirement' | 'retirementMutationOutcome' | 'control'>;
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
            || local.consentRevision !== control.consentRevision
            || (local.replica !== null && sameReplica(local.replica, replica))) {
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
 * A 409 is not evidence that the original retirement failed. Only a single
 * primary D1 read proving the original mutation absent AFTER its expected
 * CAS revision has been surpassed may authorize a new retirement request.
 * Membership is checked twice; a renewed/retired/reused target is never
 * acted on. The new mutation replaces the sealed intent BEFORE any retry.
 */
async function rebaseUncommittedRetirement(
    owner: string,
    intent: CloudflareReplicaRetirementIntent,
    transport: Transport,
    csrfToken: string,
    guard: Guard,
): Promise<'retry-staged' | 'reconciliation-required'> {
    const outcome = await transport.retirementMutationOutcome(intent, csrfToken);
    current(guard);
    if (outcome.outcome !== 'not-committed') return 'reconciliation-required';

    const control = await transport.control();
    current(guard);
    const target = control.replicas[intent.replica.slot];
    if (control.revision !== outcome.currentRevision
        || control.revision <= intent.expectedRevision
        || control.fenceEpoch !== intent.expectedFenceEpoch
        || control.consentRevision !== intent.consentRevision
        || !target || target.status !== 'active'
        || !sameReplica({ ...target, slot: intent.replica.slot }, intent.replica)
        || !Number.isSafeInteger(target.leaseUntilMs)
        || target.leaseUntilMs + SKEW_MS >= Date.now()) {
        return 'reconciliation-required';
    }

    const again = await transport.control();
    current(guard);
    if (!equal(control, again)) return 'reconciliation-required';

    const replacement = parseCloudflareReplicaRetirementIntent({
        ...intent, mutationId: crypto.randomUUID(), expectedRevision: control.revision,
    }, intent.consentRevision);
    await updateArchiveRecord<unknown>(owner, raw => {
        current(guard);
        const saved = validateLocalEnvelope(raw, owner);
        if (!saved || saved.cloudIntegrityFence || saved.cloudflareDelivery
            || saved.cloudflareReplicaClaim || saved.consentRevision !== intent.consentRevision
            || !equal(saved.cloudflareReplicaRetirement, intent)
            || (saved.replica !== null && sameReplica(saved.replica, intent.replica))
            || target.leaseUntilMs + SKEW_MS >= Date.now()) {
            throw new Error('Rebase retirement D1 concorrente o non autorizzato: intent e journal preservati.');
        }
        return { ...saved, cloudflareReplicaRetirement: replacement, revision: saved.revision + 1 };
    });
    current(guard);
    return 'retry-staged';
}

/**
 * A historical receipt is proof that the original retirement committed, but
 * not proof that the target is still retired. An unrelated control revision may
 * advance without invalidating this completed retirement. Require two stable
 * remote reads of the exact retired incarnation before clearing the intent.
 * Never ACK any business journal entry from a membership receipt.
 */
export async function resumeCloudflareReplicaRetirement(
    ownerInput: string,
    transport: Transport,
    csrfToken: string,
    guard: Guard,
): Promise<'idle' | 'retired' | 'retry-staged' | 'reconciliation-required'> {
    const owner = account(ownerInput);
    current(guard);
    if (!csrfToken) throw new Error('Sessione D1 assente: retirement sospeso.');
    const local = await readLocal(owner);
    current(guard);
    if (!local) throw new Error('Archivio locale assente: retirement sospeso.');
    const intent = local.cloudflareReplicaRetirement;
    if (!intent) return 'idle';
    if (local.cloudIntegrityFence || local.cloudflareDelivery || local.cloudflareReplicaClaim
        || local.consentRevision !== intent.consentRevision
        || (local.replica !== null && sameReplica(local.replica, intent.replica))) {
        throw new Error('Barriera integrità D1: retirement sospeso.');
    }

    let receipt: CloudReplicaMutationResult;
    try {
        receipt = await transport.replayStoredRetirement(intent, csrfToken);
    } catch (error) {
        current(guard);
        if (!(error instanceof CloudReplicaMutationReconciliationRequiredError)) {
            if (error instanceof CloudReplicaTransportError && error.status === 409) {
                return rebaseUncommittedRetirement(owner, intent, transport, csrfToken, guard);
            }
            throw error;
        }
        // The transport already validated the original request/receipt binding.
        // The fresh control below must still prove this exact incarnation retired.
        receipt = error.historicalReceipt;
    }
    current(guard);
    if (receipt.action !== 'retire' || receipt.mutationId !== intent.mutationId
        || receipt.revision !== intent.expectedRevision + 1
        || !sameReplica(receipt.replica, intent.replica)
        || !Number.isSafeInteger(receipt.currentRevision)
        || receipt.currentRevision < receipt.revision) return 'reconciliation-required';

    const control = await transport.control();
    current(guard);
    const entry = control.replicas[intent.replica.slot];
    if (control.revision < receipt.currentRevision
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
