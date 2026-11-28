import type { RetiredConflictKind } from './retiredReplicaConflictRecord';
import type { UserData } from '../../types';
import equal from 'fast-deep-equal';
import { parseRetiredReplicaConflictDecisions,
    type RetiredReplicaConflictDecision } from './retiredReplicaConflictDecisionRecord';
import { previewRetiredReplicaConflictResolution } from './retiredReplicaConflictResolution';
import { validateLocalEnvelope } from './localEnvelopeValidation';
import { readLocal } from './localArchiveBootstrap';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';

type ExpectedFrontier = { consentRevision: number; fenceEpoch: number };

export async function inspectRetiredReplicaConflictDecisions(
    ownerInput: string, expectedLegal: UserData['legalConsent'], frontier: ExpectedFrontier,
    guard: () => boolean,
) {
    const owner = normalizeStorageOwner(ownerInput);
    if (!guard()) throw new Error('Sessione non valida per la lettura dei conflitti.');
    const local = await readLocal(owner);
    if (!guard() || !local?.retiredReplicaConflictCapsule
        || local.consentRevision !== frontier.consentRevision
        || local.retiredReplicaConflictCapsule.consentRevision !== frontier.consentRevision
        || local.retiredReplicaConflictCapsule.fenceEpoch !== frontier.fenceEpoch
        || !equal(local.data.legalConsent, expectedLegal)) {
        throw new Error('Archivio dei conflitti non disponibile per questa sessione.');
    }
    return {
        revision: local.revision,
        entries: structuredClone(local.retiredReplicaConflictCapsule.entries),
        drafts: previewRetiredReplicaConflictResolution(local.retiredReplicaConflictCapsule),
        decisions: structuredClone(local.retiredReplicaConflictDecisions ?? []),
    };
}

/**
 * One exact IndexedDB update for one explicit choice. This leaves business
 * data, original pending, replica and ciphertext alternatives untouched.
 * A later recovery must separately reauthenticate the full remote frontier.
 */
export async function recordRetiredReplicaConflictDecision(
    ownerInput: string, expectedRevision: number,
    selection: RetiredReplicaConflictDecision | null,
    identity: { kind: RetiredConflictKind; entityId: string },
    expectedLegal: UserData['legalConsent'], frontier: ExpectedFrontier, guard: () => boolean,
): Promise<number> {
    const owner = normalizeStorageOwner(ownerInput);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Revisione conflitto non valida.');
    let resultRevision = 0;
    await updateArchiveRecord<unknown>(owner, raw => {
        if (!guard()) throw new Error('Sessione cambiata: scelte non salvate.');
        const current = validateLocalEnvelope(raw, owner);
        if (!current || current.revision !== expectedRevision || !current.retiredReplicaConflictCapsule
            || current.consentRevision !== frontier.consentRevision
            || current.retiredReplicaConflictCapsule.consentRevision !== frontier.consentRevision
            || current.retiredReplicaConflictCapsule.fenceEpoch !== frontier.fenceEpoch
            || !equal(current.data.legalConsent, expectedLegal)
            || current.cloudIntegrityFence || current.cloudflareDelivery || current.cloudflareReplicaClaim
            || current.cloudflareReplicaRetirement || current.cloudflareReplicaCancellation) {
            throw new Error('Scelta obsoleta: nessuna versione sostituita.');
        }
        const existing = current.retiredReplicaConflictDecisions ?? [];
        const next = existing.filter(item => item.kind !== identity.kind || item.entityId !== identity.entityId);
        if (selection) next.push(selection);
        const verified = parseRetiredReplicaConflictDecisions(next, current.retiredReplicaConflictCapsule);
        if (!verified || !current.retiredReplicaConflictCapsule.entries.some(entry =>
            entry.kind === identity.kind && entry.entityId === identity.entityId)
            || (selection && (selection.kind !== identity.kind || selection.entityId !== identity.entityId))) {
            throw new Error('Conflitto non presente nella capsula corrente.');
        }
        resultRevision = current.revision + 1;
        return { ...current, retiredReplicaConflictDecisions: verified, revision: resultRevision };
    });
    return resultRevision;
}
