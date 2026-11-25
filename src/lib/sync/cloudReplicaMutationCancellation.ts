import equal from 'fast-deep-equal';
import type { createCloudflareReplicaTransport } from './cloudReplicaTransport';
import { readLocal } from './localArchiveBootstrap';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope } from './localEnvelopeValidation';

type Transport = Pick<ReturnType<typeof createCloudflareReplicaTransport>, 'cancelReplicaMutation' | 'control'>;
type Guard = () => boolean;

function current(guard: Guard): void {
    if (!guard()) throw new Error('Annullamento replica D1 invalidato dalla sessione: journal preservato.');
}

/**
 * Explicit cancellation is not a retry, ACK, or grant. The original immutable
 * request remains sealed until the primary proves its CAS can never commit.
 * A receipt that won the race requires ordinary recovery instead.
 */
export async function cancelCloudflareReplicaMutation(
    ownerInput: string,
    expectedMutationId: string,
    transport: Transport,
    csrfToken: string,
    guard: Guard,
): Promise<'cancelled' | 'committed' | 'reconciliation-required'> {
    const owner = normalizeStorageOwner(ownerInput);
    if (!owner.startsWith('user:') || owner.length <= 5 || !csrfToken) {
        throw new Error('Sessione D1 assente: annullamento sospeso.');
    }
    current(guard);
    const before = await readLocal(owner);
    current(guard);
    const claim = before?.cloudflareReplicaClaim;
    const retirement = before?.cloudflareReplicaRetirement;
    const intent = claim ?? retirement;
    if (!before || before.cloudIntegrityFence || before.cloudflareDelivery || !intent
        || (claim && retirement) || intent.mutationId !== expectedMutationId
        || before.consentRevision !== intent.consentRevision) return 'reconciliation-required';

    const outcome = await transport.cancelReplicaMutation(intent, csrfToken);
    current(guard);
    if (outcome.outcome === 'committed') return 'committed';
    if (outcome.outcome !== 'not-committed' || !Number.isSafeInteger(outcome.currentRevision)
        || outcome.currentRevision <= intent.expectedRevision) return 'reconciliation-required';

    const control = await transport.control();
    current(guard);
    if (control.uid !== owner.slice(5) || control.fenceEpoch !== intent.expectedFenceEpoch
        || control.consentRevision !== intent.consentRevision
        || !Number.isSafeInteger(control.revision)
        || control.revision < outcome.currentRevision) return 'reconciliation-required';

    await updateArchiveRecord<unknown>(owner, raw => {
        current(guard);
        const saved = validateLocalEnvelope(raw, owner);
        if (!saved || saved.cloudIntegrityFence || saved.cloudflareDelivery
            || saved.consentRevision !== intent.consentRevision
            || !equal(saved.replica, before.replica)
            || !equal(saved.cloudflareReplicaClaim, claim)
            || !equal(saved.cloudflareReplicaRetirement, retirement)) {
            throw new Error('Annullamento replica D1 concorrente: intent e journal preservati.');
        }
        return { ...saved, cloudflareReplicaClaim: undefined, cloudflareReplicaRetirement: undefined,
            revision: saved.revision + 1 };
    });
    current(guard);
    return 'cancelled';
}
