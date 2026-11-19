import equal from 'fast-deep-equal';
import { decodeImport, prepareImport } from '../backup';
import { getCachedCatalog } from '../catalog/catalogService';
import type { UserData } from '../../types';
import { UserDataSchema } from '../schema';
import { removeUndefinedValuesForFirestore } from '../utils/object';
import { findLossyNormalization } from '../sync/businessNormalizationIntegrity';
import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    type KindeCandidateAccess } from './kindeCandidateClient';
import { isKindeAccountLocalFitnessClear } from '../sync/kindeOwnerLocalFitnessFence';
import { prepareKindeCandidateOwner } from '../sync/kindeCandidateOwnerBootstrap';
import { hydrateKindeCandidateArchive } from '../sync/kindeCandidateArchiveHydration';
import { deliverKindeCandidateJournal } from '../sync/kindeCandidateJournalBridge';
import { readLocal } from '../sync/localArchiveBootstrap';
import { commitLocal } from '../sync/localSnapshotCommit';
import { projectDocuments, applyRemoteDocuments } from '../sync/documentProjection';
import { enforceMonthlyEntityTombstones } from '../sync/monthlyEntityTombstones';
import { diffDocuments, applySemanticOperations } from '../sync/semanticProjection';
import { sequenceOperationsForBoundedTransactions } from '../sync/syncBatching';
import { userOwner } from '../sync/owner';
import { unlockVaultForOwner, requireUnlockedLocalKey } from '../sync/secureArchiveSession';

type Principal = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>['principal'];
type RestoreOutcome =
    | { kind: 'already-current' }
    | { kind: 'local-metadata-restored' }
    | { kind: 'local-pending'; pendingCount: number }
    | { kind: 'cloud-acknowledged' };
type RestoreOptions = {
    backup: unknown;
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
};

function requireCurrent(guard: () => boolean): void {
    if (!guard()) throw new KindeCandidateBoundaryError();
}

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
// IndexedDB seals the JSON form: undefined object properties do not survive encryption.
const canonicalBusiness = (value: UserData) => removeUndefinedValuesForFirestore(parse(value));
const sameBusiness = (left: UserData, right: UserData) => equal(canonicalBusiness(left), canonicalBusiness(right));

/**
 * A bulk restore must be representable by the SAME semantic journal as the
 * production snapshot writer. Reject unrepresentable fields before the first
 * IndexedDB mutation; a successful JSON decode is not sufficient evidence.
 */
async function assertDurableProjection(current: UserData, desired: UserData,
    actorId: string, actorSeq: number, clock: Record<string, number>,
): Promise<void> {
    const catalog = await getCachedCatalog();
    const baseDocuments = projectDocuments(current, catalog);
    const desiredDocuments = projectDocuments(desired, catalog);
    const provisional = actorSeq + 1;
    const provisionalClock = { ...clock, [actorId]: provisional };
    const diff = diffDocuments(baseDocuments, desiredDocuments, actorId, provisional, provisionalClock);
    const operations = enforceMonthlyEntityTombstones(
        baseDocuments, desiredDocuments, diff, actorId, provisional, provisionalClock,
    );
    const sequenced = sequenceOperationsForBoundedTransactions(operations, actorId, actorSeq, clock);
    const { documents } = applySemanticOperations(baseDocuments, sequenced.operations);
    const replayed = applyRemoteDocuments(current, documents, catalog);
    replayed.pendingConflicts = desired.pendingConflicts;
    const normalizedReplay = canonicalBusiness(replayed);
    const normalizedDesired = canonicalBusiness(desired);
    if (!equal(normalizedReplay, normalizedDesired)) {
        // Emit a property path, never the health value. An extra *defined*
        // field still fails; only JSON-elided undefined values are equivalent.
        const missing = findLossyNormalization(normalizedDesired, normalizedReplay);
        const unexpected = findLossyNormalization(normalizedReplay, normalizedDesired);
        const path = (missing ?? unexpected ?? []).join('.') || '<root>';
        throw new Error(`Backup non rappresentabile dal journal corrente (${path}): ripristino annullato.`);
    }
}

/**
 * Candidate-only restore for an already consented Kinde owner. It first
 * bootstraps and reconciles the existing D1 vault, then writes business and
 * semantic journal in ONE encrypted IndexedDB transaction. No imported
 * consent, device drafts, replica identity, old journal or cloud ACK is adopted.
 *
 * A failed delivery leaves the journal/staged ciphertext intact. The next
 * prepareKindeCandidateOwner(drainPendingJournal:true) resumes its original
 * batch before another restore can be prepared. The public fitness runtime
 * does not call this entrypoint.
 */
export async function restoreKindeCandidateBackup({
    backup, expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: RestoreOptions): Promise<RestoreOutcome> {
    const principal = { ...expected };
    const owner = userOwner(principal.uid);
    // Reject anonymous/share/partial/foreign backups without provisioning a
    // new device vault or attempting network access.
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)
        || (backup as { owner?: unknown }).owner !== owner
        || (backup as { type?: unknown }).type !== 'backup') {
        throw new KindeCandidateBoundaryError();
    }
    const decoded = decodeImport(backup, owner);
    if (decoded.share || decoded.ownerUnknown || decoded.coverage?.scope !== 'cloud-and-device') {
        throw new KindeCandidateBoundaryError();
    }

    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => fence.stillCurrent()
        && isKindeAccountLocalFitnessClear(owner, principal.healthConsentRevision);
    requireCurrent(current);
    const request = { expected: principal, stillCurrent: current, send, browserCookies };
    // The bootstrap is responsible for trusted consent, current ADK/AEAD
    // hydration, replica claim and recovery of any prior ambiguous delivery.
    // It releases its own grant; this operation acquires a separate scoped one.
    const ready = await prepareKindeCandidateOwner({
        ...request, drainPendingJournal: true, retainDeviceVault: false,
    });
    requireCurrent(current);
    if (ready.kind !== 'candidate-observed' || ready.journalDrained !== true
        || ready.checkpointRevision === null
        || (ready.replicaOutcome !== 'adopted' && ready.replicaOutcome !== 'already-active')) {
        throw new Error('Ripristino sospeso: replica o precedente journal non riconciliati.');
    }
    const grant = await unlockVaultForOwner(owner, current);
    const deviceKey = requireUnlockedLocalKey(owner);
    const scoped = () => {
        try { return current() && grant.isCurrent() && requireUnlockedLocalKey(owner) === deviceKey; }
        catch { return false; }
    };

    try {
        requireCurrent(scoped);
        // Refresh against a complete authenticated cloud scan. A concurrent
        // remote edit after this point will still be rejected by the D1 revision
        // guard during delivery, not silently overwritten by a fabricated ACK.
        const hydrated = await hydrateKindeCandidateArchive({
            ...request, stillCurrent: scoped,
        });
        const before = hydrated.envelope;
        requireCurrent(scoped);
        if (!before.replica || before.replica.leaseUntilMs <= Date.now()
            || before.actorId !== before.replica.slot
            || before.consentRevision !== principal.healthConsentRevision
            || before.pending.length !== 0 || !sameBusiness(before.data, before.baseline)
            || before.cloudIntegrityFence || before.cloudflareDelivery
            || before.cloudflareReplicaClaim || before.cloudflareReplicaRetirement
            || (before.archivedConsentJournals?.length ?? 0) !== 0) {
            throw new Error('Archivio Kinde non pulito: ripristino sospeso senza sostituzioni.');
        }
        const restored = canonicalBusiness(prepareImport(before.data, decoded.data, 'restore', decoded.coverage).data);
        await assertDurableProjection(before.data, restored,
            before.actorId, before.actorSeq, before.clock);
        requireCurrent(scoped);
        const operations = await commitLocal(owner, restored, before.data, scoped,
            before.revision, { pendingConflicts: restored.pendingConflicts });
        requireCurrent(scoped);
        const committed = await readLocal(owner);
        if (!scoped() || !committed || !sameBusiness(committed.data, restored)
            || (operations.length > 0 && committed.pending.length === 0)) {
            throw new Error('Ripristino locale non verificato: conservare il backup e il journal.');
        }
        if (!operations.length) {
            // pendingConflicts is deliberately device-local. A metadata-only
            // restoration writes an encrypted revision without any cloud dot.
            return sameBusiness(before.data, restored)
                ? { kind: 'already-current' }
                : { kind: 'local-metadata-restored' };
        }

        const delivery = await deliverKindeCandidateJournal({
            stillCurrent: scoped, send, browserCookies,
        });
        requireCurrent(scoped);
        const after = await readLocal(owner);
        requireCurrent(scoped);
        if (!after || !sameBusiness(after.data, restored)) {
            // A newer edit is not part of this import's receipt. The original
            // backup remains available for an explicit subsequent decision.
            return { kind: 'local-pending', pendingCount: after?.pending.length ?? 0 };
        }
        if (delivery === 'acknowledged' && !after.pending.length
            && !after.cloudflareDelivery && sameBusiness(after.baseline, restored)) {
            return { kind: 'cloud-acknowledged' };
        }
        return { kind: 'local-pending', pendingCount: after.pending.length };
    } finally {
        grant.release();
    }
}
