import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError, type KindeCandidateAccess } from './kindeCandidateClient';
import { withKindeCandidateLocalReadiness } from './kindeCandidateLocalReadiness';
import { submitKindeCandidateDomainIntent } from './kindeCandidateDomainIntent';
import { createKindeCandidateOfflineJournal } from './kindeCandidateOfflineJournal';
import { openKindeCandidateRoutineDraft, type KindeRoutineDraft } from './kindeCandidateRoutineDraft';
import { openKindeCandidateExerciseDraft, type KindeExerciseDraft } from './kindeCandidateExerciseDraft';
import { openKindeCandidateMeasurementDraft, type KindeMeasurementDraft } from './kindeCandidateMeasurementDraft';
import { openKindeCandidateSleepDraft, type KindeSleepDraft } from './kindeCandidateSleepDraft';
import { openKindeCandidateStepsDraft, type KindeStepsDraft } from './kindeCandidateStepsDraft';
import type { KindeCatalogDraftController } from './kindeCandidateCatalogDraft';
import { authenticatedIdentitySource } from '../sync/authenticatedIdentitySource';
import { isKindeAccountLocalFitnessClear } from '../sync/kindeOwnerLocalFitnessFence';
import { readLocal } from '../sync/localArchiveBootstrap';
import { userOwner } from '../sync/owner';
import type { DomainOperationBatch } from '../sync/domainOperations';
import type { LocalWriteGuard } from '../sync/localDomainCommit';
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
type DraftHandle = KindeRoutineDraft | KindeExerciseDraft | KindeMeasurementDraft | KindeSleepDraft | KindeStepsDraft;
type DraftSave = { outcome: MutationOutcome; draftCleared: boolean };

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
    openRoutineDraft: (routineId?: string) => Promise<KindeRoutineDraft>;
    saveRoutineDraft: (draft: KindeRoutineDraft) => Promise<DraftSave>;
    openExerciseDraft: (exerciseId?: string) => Promise<KindeExerciseDraft>;
    saveExerciseDraft: (draft: KindeExerciseDraft) => Promise<DraftSave>;
    openMeasurementDraft: (date: string) => Promise<KindeMeasurementDraft>;
    saveMeasurementDraft: (draft: KindeMeasurementDraft) => Promise<DraftSave>;
    openSleepDraft: (date: string) => Promise<KindeSleepDraft>;
    saveSleepDraft: (draft: KindeSleepDraft) => Promise<DraftSave>;
    openStepsDraft: (date: string) => Promise<KindeStepsDraft>;
    saveStepsDraft: (draft: KindeStepsDraft) => Promise<DraftSave>;
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
    let routineDraft: KindeCatalogDraftController<KindeRoutineDraft> | null = null;
    let exerciseDraft: KindeCatalogDraftController<KindeExerciseDraft> | null = null;
    let measurementDraft: KindeCatalogDraftController<KindeMeasurementDraft> | null = null;
    let sleepDraft: KindeCatalogDraftController<KindeSleepDraft> | null = null;
    let stepsDraft: KindeCatalogDraftController<KindeStepsDraft> | null = null;
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
    // The journal checks the base session permit during its transaction.
    // Retained views and edit witnesses also need its offline replica/vault
    // fence; using the view check inside the journal would make it recursive.
    const viewPermitted = () => permitted() && (!offline() || offlineJournal?.isCurrent() === true);
    const request = { expected: principal, stillCurrent: current, send, browserCookies };
    const closeDrafts = () => {
        routineDraft?.handle.close();
        exerciseDraft?.handle.close();
        measurementDraft?.handle.close();
        sleepDraft?.handle.close();
        stepsDraft?.handle.close();
        routineDraft = null;
        exerciseDraft = null;
        measurementDraft = null;
        sleepDraft = null;
        stepsDraft = null;
    };

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

    const submit = async (operation: DomainOperationBatch, beforeCommit?: LocalWriteGuard, saved?: () => void) => {
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
                const { data, outcome } = await journal.submit(operation, beforeCommit);
                requirePermit();
                saved?.();
                if (journal.isCurrent()) {
                    offlineJournal = journal;
                    visible = { owner, principal, data };
                }
                return outcome;
            }
            if (needsReconciliation) throw new KindeCandidateBoundaryError();
            offlineJournal = null;
            const result = await submitKindeCandidateDomainIntent({
                ...request, stillCurrent: permitted, operation, beforeCommit,
            });
            requirePermit();
            saved?.();
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
    };

    const openDraft = async <T extends DraftHandle>(
        create: (data: UserData, scope: { owner: string; revision: number; permitted: () => boolean }) => Promise<KindeCatalogDraftController<T>>,
        register: (controller: KindeCatalogDraftController<T>) => void,
    ): Promise<T> => {
        if (busy || !visible || !viewPermitted()) throw new KindeCandidateBoundaryError();
        busy = true;
        try {
            const journal = offlineJournal;
            const draftCurrent = () => permitted() && (!offline() || journal?.isCurrent() === true);
            const opened = await create(visible.data, { owner, revision: principal.healthConsentRevision, permitted: draftCurrent });
            if (!draftCurrent()) {
                opened.handle.close();
                throw new KindeCandidateBoundaryError();
            }
            register(opened);
            return opened.handle;
        } finally { busy = false; }
    };

    const saveDraft = async (handle: DraftHandle): Promise<DraftSave> => {
        const active = [routineDraft, exerciseDraft, measurementDraft, sleepDraft, stepsDraft]
            .find(draft => draft?.handle === handle);
        if (busy || !visible || !viewPermitted() || !active) throw new KindeCandidateBoundaryError();
        const { operation, beforeCommit, clearAfterCommit } = active.prepare(visible.data);
        let draftCleared = false;
        try {
            const outcome = await submit(operation, beforeCommit, () => {
                try { clearAfterCommit(); draftCleared = true; }
                catch { /* The business save is durable even if the exact draft cannot be cleared. */ }
            });
            return { outcome, draftCleared };
        } finally { closeDrafts(); }
    };

    return {
        isCurrent: viewPermitted,
        snapshot: () => viewPermitted() && visible && (offline() || !needsReconciliation)
            ? structuredClone(visible) : null,
        close: () => {
            closed = true;
            closeDrafts();
            visible = null;
            offlineJournal = null;
            sessionPermit = null;
        },
        refresh: async () => {
            if (busy || offline()) throw new KindeCandidateBoundaryError();
            requireCurrent();
            closeDrafts();
            busy = true;
            visible = null;
            offlineJournal = null;
            sessionPermit = null;
            try { return await load(); }
            finally { busy = false; }
        },
        submit: operation => {
            if (!busy) closeDrafts();
            return submit(operation);
        },
        openRoutineDraft: routineId => openDraft((data, scope) => {
            const routine = routineId === undefined ? undefined : data.routines?.find(item => item.id === routineId);
            if (routineId !== undefined && !routine) throw new KindeCandidateBoundaryError();
            routineDraft?.handle.close();
            routineDraft = null;
            return openKindeCandidateRoutineDraft({ ...scope, routine });
        }, draft => { routineDraft = draft; }),
        openExerciseDraft: exerciseId => openDraft((data, scope) => {
            const exercise = exerciseId === undefined ? undefined : data.library?.find(item => item.id === exerciseId && !item.isDefault);
            if (exerciseId !== undefined && !exercise) throw new KindeCandidateBoundaryError();
            exerciseDraft?.handle.close();
            exerciseDraft = null;
            return openKindeCandidateExerciseDraft({ ...scope, exercise });
        }, draft => { exerciseDraft = draft; }),
        openMeasurementDraft: date => openDraft((data, scope) => {
            measurementDraft?.handle.close();
            measurementDraft = null;
            return openKindeCandidateMeasurementDraft({
                ...scope, date, day: data.nutrition?.[date], profile: data.profile,
            });
        }, draft => { measurementDraft = draft; }),
        saveRoutineDraft: saveDraft,
        saveExerciseDraft: saveDraft,
        saveMeasurementDraft: saveDraft,
        openSleepDraft: date => openDraft((data, scope) => {
            sleepDraft?.handle.close();
            sleepDraft = null;
            return openKindeCandidateSleepDraft({
                ...scope, date, day: data.nutrition?.[date],
            });
        }, draft => { sleepDraft = draft; }),
        saveSleepDraft: saveDraft,
        openStepsDraft: date => openDraft((data, scope) => {
            stepsDraft?.handle.close();
            stepsDraft = null;
            return openKindeCandidateStepsDraft({ ...scope, date, day: data.nutrition?.[date] });
        }, draft => { stepsDraft = draft; }),
        saveStepsDraft: saveDraft,
    };
}
