import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError, type KindeCandidateAccess } from './kindeCandidateClient';
import { withKindeCandidateLocalReadiness } from './kindeCandidateLocalReadiness';
import { submitKindeCandidateDomainIntent } from './kindeCandidateDomainIntent';
import { createKindeCandidateOfflineJournal } from './kindeCandidateOfflineJournal';
import { authenticatedIdentitySource } from '../sync/authenticatedIdentitySource';
import { isKindeAccountLocalFitnessClear } from '../sync/kindeOwnerLocalFitnessFence';
import { readLocal } from '../sync/localArchiveBootstrap';
import { userOwner } from '../sync/owner';
import type { DomainOperationBatch } from '../sync/domainOperations';
import type { UserData } from '../../types';

type Principal = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>['principal'];

type Options = {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
};

export type KindeCandidateFitnessSnapshot = Readonly<{
    owner: string;
    principal: Readonly<Principal>;
    data: UserData;
}>;

type MutationOutcome = Awaited<ReturnType<typeof submitKindeCandidateDomainIntent>>;

type SessionPermit = Readonly<{
    verifiedAtMs: number;
    verifiedAtMonotonicMs: number;
    expiresAtMs: number;
}>;

function sessionPermitCurrent(permit: SessionPermit | null): boolean {
    if (!permit) return false;
    const wallNow = Date.now();
    const elapsed = performance.now() - permit.verifiedAtMonotonicMs;
    // A wall-clock rollback cannot extend the session, and elapsed time
    // must advance monotonically even if the device clock changes.
    return wallNow >= permit.verifiedAtMs && wallNow < permit.expiresAtMs
        && Number.isFinite(elapsed) && elapsed >= 0
        && elapsed < permit.expiresAtMs - permit.verifiedAtMs;
}

export type KindeCandidateFitnessRealm = {
    isCurrent: () => boolean;
    snapshot: () => KindeCandidateFitnessSnapshot | null;
    refresh: () => Promise<KindeCandidateFitnessSnapshot>;
    submit: (operation: DomainOperationBatch) => Promise<MutationOutcome>;
    close: () => void;
};

/**
 * Candidate React owner boundary, deliberately separate from the legacy
 * Firebase AuthContext and global authenticatedIdentitySource. A Kinde identity
 * alone cannot install an application owner while the legacy store still uses
 * Firebase consent and writer gates.
 *
 * Only an online readiness check can open a realm. A document which later
 * loses connectivity can journal locally while its bounded permit is current.
 */
export async function openKindeCandidateFitnessRealm({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: Options): Promise<KindeCandidateFitnessRealm> {
    const principal = { ...expected };
    const owner = userOwner(principal.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    let closed = false;
    let busy = false;
    let visible: KindeCandidateFitnessSnapshot | null = null;
    let offlineJournal: ReturnType<typeof createKindeCandidateOfflineJournal> = null;
    let needsReconciliation = false;
    let sessionPermit: SessionPermit | null = null;
    const offline = () => navigator.onLine === false;
    const current = () => {
        try {
            return !closed && fence.stillCurrent()
                && !authenticatedIdentitySource.hasReader()
                && isKindeAccountLocalFitnessClear(owner, principal.healthConsentRevision);
        } catch { return false; }
    };
    const requireCurrent = () => {
        if (!current()) throw new KindeCandidateBoundaryError();
    };
    const permitted = () => current() && sessionPermitCurrent(sessionPermit);
    const requirePermit = () => {
        if (!permitted()) throw new KindeCandidateBoundaryError();
    };
    const request = { expected: principal, stillCurrent: current, send, browserCookies };

    const load = async (): Promise<KindeCandidateFitnessSnapshot> => {
        requireCurrent();
        if (offline()) throw new KindeCandidateBoundaryError();
        const { snapshot, journal, permit } = await withKindeCandidateLocalReadiness(request, async ready => {
            if (!ready.isCurrent() || ready.owner !== owner) throw new KindeCandidateBoundaryError();
            const local = await readLocal(owner);
            if (!ready.isCurrent() || !local || local.owner !== owner
                || local.consentRevision !== principal.healthConsentRevision
                || !local.data.legalConsent) throw new KindeCandidateBoundaryError();
            const verifiedAtMs = Date.now();
            const verifiedAtMonotonicMs = performance.now();
            const expiresAtMs = ready.access.sessionExpiresAtMs;
            if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs === undefined
                || expiresAtMs <= verifiedAtMs || !Number.isFinite(verifiedAtMonotonicMs)) {
                throw new KindeCandidateBoundaryError();
            }
            return {
                snapshot: { owner, principal: { ...principal }, data: structuredClone(local.data) },
                journal: createKindeCandidateOfflineJournal(ready.access, local, permitted),
                permit: { verifiedAtMs, verifiedAtMonotonicMs, expiresAtMs },
            };
        });
        requireCurrent();
        if (!sessionPermitCurrent(permit)) throw new KindeCandidateBoundaryError();
        sessionPermit = permit;
        offlineJournal = journal;
        needsReconciliation = false;
        visible = snapshot;
        return structuredClone(snapshot);
    };

    try {
        await load();
    } catch (error) {
        closed = true;
        visible = null;
        sessionPermit = null;
        throw error;
    }

    return {
        isCurrent: permitted,
        snapshot: () => permitted() && visible
            && (offline() ? offlineJournal?.isCurrent() : !needsReconciliation) ? structuredClone(visible) : null,
        close: () => {
            closed = true;
            visible = null;
            offlineJournal = null;
            sessionPermit = null;
        },
        refresh: async () => {
            if (busy || offline()) throw new KindeCandidateBoundaryError();
            requireCurrent();
            busy = true;
            visible = null;
            offlineJournal = null;
            sessionPermit = null;
            try { return await load(); }
            finally { busy = false; }
        },
        submit: async operation => {
            if (busy) throw new KindeCandidateBoundaryError();
            requirePermit();
            busy = true;
            // The previous plaintext snapshot becomes stale as soon as this
            // operation starts, including when the remote response is lost.
            visible = null;
            try {
                if (offline()) {
                    const journal = offlineJournal;
                    if (!journal) throw new KindeCandidateBoundaryError();
                    // Reconnect via refresh even if the tab loses the result
                    // of a local commit, so the original intent is never retried.
                    needsReconciliation = true;
                    offlineJournal = null;
                    const { data, outcome } = await journal.submit(operation);
                    requirePermit();
                    if (journal.isCurrent()) {
                        offlineJournal = journal;
                        visible = { owner, principal, data };
                    }
                    return outcome;
                }
                if (needsReconciliation) throw new KindeCandidateBoundaryError();
                offlineJournal = null;
                const result = await submitKindeCandidateDomainIntent({
                    ...request, stillCurrent: permitted, operation,
                });
                requirePermit();
                // A pending journal is not a cloud checkpoint. Recover only
                // through a later explicit trusted refresh, never fake success.
                if (result.kind !== 'local-pending') {
                    try { await load(); } catch {
                        visible = null;
                        sessionPermit = null;
                    }
                }
                requirePermit();
                return result;
            } finally {
                busy = false;
            }
        },
    };
}
