import equal from 'fast-deep-equal';
import type { createCloudflareReplicaTransport } from './cloudReplicaTransport';
import { readLocal } from './localArchiveBootstrap';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope, type LocalEnvelope } from './localEnvelopeValidation';

type Transport = Pick<ReturnType<typeof createCloudflareReplicaTransport>, 'cancelReplicaMutation' | 'control'>;
type Guard = () => boolean;

function current(guard: Guard): void {
    if (!guard()) throw new Error('Annullamento replica D1 invalidato dalla sessione: journal preservato.');
}

/**
 * Explicit cancellation is not a retry, ACK, or grant. The original immutable
 * request and cancellation decision remain sealed until the primary proves
 * its CAS can never commit. A winning receipt clears only the cancellation
 * decision and requires ordinary recovery. Crash/reload must not rebase the
 * original while a cancellation is unresolved.
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

    const matches = (saved: LocalEnvelope | undefined): saved is LocalEnvelope => !!saved
        && !saved.cloudIntegrityFence && !saved.cloudflareDelivery
        && saved.consentRevision === intent.consentRevision
        && equal(saved.replica, before.replica)
        && equal(saved.cloudflareReplicaClaim, claim)
        && equal(saved.cloudflareReplicaRetirement, retirement);
    // Persist the user's decision before the first cancel request. All normal
    // replay/adoption paths fence this marker in their IndexedDB callbacks.
    await updateArchiveRecord<unknown>(owner, raw => {
        current(guard);
        const saved = validateLocalEnvelope(raw, owner);
        if (!matches(saved)) throw new Error('Annullamento replica D1 concorrente: intent e journal preservati.');
        if (saved.cloudflareReplicaCancellation === intent.mutationId) return raw;
        return { ...saved, cloudflareReplicaCancellation: intent.mutationId, revision: saved.revision + 1 };
    });
    current(guard);
    const outcome = await transport.cancelReplicaMutation(intent, csrfToken);
    current(guard);
    if ((outcome.outcome !== 'not-committed' && outcome.outcome !== 'committed')
        || !Number.isSafeInteger(outcome.currentRevision)
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
        if (!matches(saved) || saved.cloudflareReplicaCancellation !== intent.mutationId) {
            throw new Error('Annullamento replica D1 concorrente: intent e journal preservati.');
        }
        return { ...saved, cloudflareReplicaCancellation: undefined,
            ...(outcome.outcome === 'not-committed' ? {
                cloudflareReplicaClaim: undefined, cloudflareReplicaRetirement: undefined,
            } : {}), revision: saved.revision + 1 };
    });
    current(guard);
    return outcome.outcome === 'committed' ? 'committed' : 'cancelled';
}
