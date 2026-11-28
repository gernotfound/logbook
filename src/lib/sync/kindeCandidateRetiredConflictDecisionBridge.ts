import equal from 'fast-deep-equal';
import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError,
    readKindeCandidateAccess } from '../auth/kindeCandidateClient';
import { readBrowserValueStrict } from './browserStorage';
import { inspectKindeCandidateOfflineReplicaJournal } from './kindeCandidateOfflineReplicaJournal';
import { isKindeAccountLocalFitnessClear } from './kindeOwnerLocalFitnessFence';
import { inspectRetiredReplicaConflictDecisions, recordRetiredReplicaConflictDecision } from './retiredReplicaConflictDecisions';
import type { RetiredReplicaConflictDecision } from './retiredReplicaConflictDecisionRecord';
import type { RetiredConflictKind } from './retiredReplicaConflictRecord';
import { userOwner } from './owner';
import { unlockVaultForOwner } from './secureArchiveSession';

type Options = Parameters<typeof inspectKindeCandidateOfflineReplicaJournal>[0];
export type RetiredConflictSelection = {
    expectedRevision: number;
    identity: { kind: RetiredConflictKind; entityId: string };
    choice: RetiredReplicaConflictDecision['choice'] | null;
};

/**
 * Deliberate owner-local choices only; a new candidate writer must not infer
 * transfer authority from them. No cloud ADK or health data is sent to D1.
 */
export async function inspectOrChooseKindeCandidateRetiredConflicts({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie, selection,
}: Options & { selection?: RetiredConflictSelection }) {
    const owner = userOwner(expected.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    const current = () => {
        try {
            return fence.stillCurrent()
                && isKindeAccountLocalFitnessClear(owner, expected.healthConsentRevision)
                && (readBrowserValueStrict('logbook_is_guest') ?? 'false') === 'false';
        } catch { return false; }
    };
    if (!current()) throw new KindeCandidateBoundaryError();
    const request = { expected, stillCurrent: current, send, browserCookies };
    const access = await readKindeCandidateAccess(request);
    if (!current() || access.kind !== 'consent-confirmed' || !equal(access.principal, expected)) {
        throw new KindeCandidateBoundaryError();
    }
    const observed = await inspectKindeCandidateOfflineReplicaJournal(request);
    if (!current() || observed.kind !== 'retired-pending') throw new KindeCandidateBoundaryError();
    const grant = await unlockVaultForOwner(owner, current);
    const guarded = () => current() && grant.isCurrent();
    const frontier = { consentRevision: expected.healthConsentRevision, fenceEpoch: expected.fenceEpoch };
    try {
        if (!guarded()) throw new KindeCandidateBoundaryError();
        const before = await inspectRetiredReplicaConflictDecisions(owner, access.legalConsent, frontier, guarded);
        if (selection) {
            if (selection.expectedRevision !== before.revision) throw new KindeCandidateBoundaryError();
            await recordRetiredReplicaConflictDecision(owner, selection.expectedRevision,
                selection.choice === null ? null : { ...selection.identity, choice: selection.choice },
                selection.identity, access.legalConsent, frontier, guarded);
        }
        const latest = selection ? await inspectRetiredReplicaConflictDecisions(owner, access.legalConsent, frontier, guarded) : before;
        const after = await readKindeCandidateAccess({ ...request, stillCurrent: guarded });
        if (!guarded() || after.kind !== 'consent-confirmed'
            || !equal(after.principal, access.principal)
            || !equal(after.legalConsent, access.legalConsent)) throw new KindeCandidateBoundaryError();
        return latest;
    } finally {
        grant.release();
    }
}
