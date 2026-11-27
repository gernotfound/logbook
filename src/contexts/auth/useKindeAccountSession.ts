import { useCallback, useEffect, useRef, useState } from 'react';
import {
    captureKindeCandidatePresenceFence, KindeCandidateBoundaryError, readKindeCandidateAccess,
    revokeKindeCandidateSession, submitKindeHostedSignIn,
} from '../../lib/auth/kindeCandidateClient';
import { createKindeCandidateActivityReporter } from '../../lib/auth/kindeCandidateActivityReporter';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';
import type { prepareKindeCandidateOwner } from '../../lib/sync/kindeCandidateOwnerBootstrap';
import type {
    withdrawKindeCandidateHealthConsent, reconcileKindeCandidateWithdrawal,
} from '../../lib/auth/kindeCandidateWithdrawal';

type Status = 'checking' | 'signed-out' | 'guest-blocked';
type AccountStatus = 'email-unverified' | 'identity-verified' | 'consent-required'
    | 'consent-confirmed' | 'legal-update-required' | 'consent-suspended';
type Principal = Exclude<Awaited<ReturnType<typeof readKindeCandidateIdentity>>,
    { kind: 'signed-out' }>['principal'];
type View = { phase: Status; generation: number }
    | { phase: 'unavailable'; generation: number; allowLocalGuest: boolean }
    | { phase: AccountStatus; generation: number; principal: Principal };
type Decision = Parameters<typeof acceptKindeCandidateInitialConsent>[0]['decision'];
type PresenceFence = ReturnType<typeof captureKindeCandidatePresenceFence>;
type CandidatePreparationResult = Awaited<ReturnType<typeof prepareKindeCandidateOwner>>;
type CandidateReplicaRegistryResult = Awaited<ReturnType<typeof import('../../lib/sync/kindeCandidateReplicaRegistry').inspectKindeCandidateReplicaRegistry>>;
type CandidateOfflineReplicaJournalResult = Awaited<ReturnType<typeof import('../../lib/sync/kindeCandidateOfflineReplicaJournal').inspectKindeCandidateOfflineReplicaJournal>>;
type CandidateRetiredReplicaPreflightResult = Awaited<ReturnType<typeof import('../../lib/sync/kindeCandidateRetiredReplicaReadOnly').inspectKindeCandidateRetiredReplicaWithExistingKey>>;
type CandidateStagedReceiptResult = Awaited<ReturnType<typeof import('../../lib/sync/kindeCandidateStagedReceiptRecovery').recoverKindeCandidateStagedReceipt>>;
type CandidateRetirementWitness = import('../../lib/sync/kindeCandidateReplicaRetirementBridge').CandidateReplicaRetirementWitness;
type CandidateRetirementOutcome = Awaited<ReturnType<typeof import('../../lib/sync/kindeCandidateReplicaRetirementBridge').retireKindeCandidateReplica>>;
type CandidatePendingMutation = Awaited<ReturnType<typeof import('../../lib/sync/kindeCandidateReplicaCancellationBridge').inspectKindeCandidatePendingReplicaMutation>>;
type CandidateCancellationOutcome = Awaited<ReturnType<typeof import('../../lib/sync/kindeCandidateReplicaCancellationBridge').cancelKindeCandidatePendingReplicaMutation>>;
type CandidateRestoreResult = Awaited<ReturnType<typeof import('../../lib/auth/kindeCandidateRestore').restoreKindeCandidateBackup>>;

// Read only the local CSRF-cookie witness. Network refresh is triggered only
// on a change or a foreground event, including browsers without CookieStore.
const COOKIE_CHECK_MS = 1000;

export function useKindeAccountSession({
    guestArchivePresent, identityOnly, candidatePreparationEnabled = false,
    candidateLifecycleEnabled = false, candidateActivityEnabled = false,
}: {
    guestArchivePresent: boolean; identityOnly: boolean;
    candidatePreparationEnabled?: boolean; candidateLifecycleEnabled?: boolean; candidateActivityEnabled?: boolean;
}) {
    const [view, setView] = useState<View>({
        phase: guestArchivePresent ? 'guest-blocked' : 'checking', generation: 0,
    });
    const [busy, setBusy] = useState(false);
    const published = useRef(view);
    const mounted = useRef(false);
    const busyRef = useRef(false);
    const generation = useRef(0);
    const observed = useRef<PresenceFence | null>(null);
    const activity = useRef<{
        uid: string; epoch: number; csrf: string;
        report: ReturnType<typeof createKindeCandidateActivityReporter>;
    } | null>(null);
    const publish = useCallback((next: View) => {
        if (next.phase === 'signed-out' || next.phase === 'guest-blocked') {
            activity.current = null;
        }
        published.current = next;
        setView(next);
    }, []);

    const refresh = useCallback(async () => {
        const token = ++generation.current;
        observed.current = null;
        if (guestArchivePresent) {
            publish({ phase: 'guest-blocked', generation: token });
            return;
        }
        const current = () => mounted.current && generation.current === token;
        publish({ phase: 'checking', generation: token });
        try {
            const session = captureKindeCandidatePresenceFence({ stillCurrent: current });
            if (activity.current && activity.current.csrf !== session.csrfToken) activity.current = null;
            observed.current = session;
            const identity = await readKindeCandidateIdentity({ stillCurrent: session.stillCurrent });
            if (!current()) return;
            if (!session.stillCurrent()) throw new KindeCandidateBoundaryError();
            if (identity.kind === 'signed-out') {
                publish({ phase: 'signed-out', generation: token });
                return;
            }
            if (session.csrfToken === null) throw new KindeCandidateBoundaryError();
            const principal = identity.principal;
            if (activity.current && (activity.current.uid !== principal.uid || activity.current.epoch !== principal.fenceEpoch)) {
                activity.current = null;
            }
            if (identity.kind === 'email-unverified' || identityOnly) {
                publish({
                    phase: identity.kind === 'email-unverified' ? 'email-unverified' : 'identity-verified',
                    generation: token, principal,
                });
                return;
            }
            const access = await readKindeCandidateAccess({ stillCurrent: session.stillCurrent });
            if (!current()) return;
            if (!session.stillCurrent() || access.kind === 'signed-out'
                || access.principal.uid !== principal.uid
                || access.principal.fenceEpoch !== principal.fenceEpoch
                || access.principal.healthConsentRevision !== principal.healthConsentRevision) {
                throw new KindeCandidateBoundaryError();
            }
            publish({
                phase: access.kind === 'consent-required' ? 'consent-required'
                    : access.kind === 'consent-confirmed' ? 'consent-confirmed'
                        : access.kind === 'legal-update-required' ? 'legal-update-required' : 'consent-suspended',
                generation: token, principal,
            });
        } catch {
            if (current()) {
                const observation = observed.current;
                publish({ phase: 'unavailable', generation: token,
                    allowLocalGuest: observation?.csrfToken === null && observation.stillCurrent() });
            }
        }
    }, [guestArchivePresent, identityOnly, publish]);

    useEffect(() => {
        mounted.current = true;
        const token = ++generation.current;
        queueMicrotask(() => {
            if (mounted.current && generation.current === token) void refresh();
        });
        return () => {
            activity.current = null;
            mounted.current = false;
            generation.current += 1;
            observed.current = null;
        };
    }, [refresh]);

    useEffect(() => {
        if (guestArchivePresent) return;
        let queued = false;
        let active = true;
        const canRefresh = () => active && mounted.current && !busyRef.current
            && document.visibilityState !== 'hidden';
        const scheduleRecheck = () => {
            if (queued || !canRefresh()) return;
            queued = true;
            queueMicrotask(() => {
                queued = false;
                if (canRefresh()) void refresh();
            });
        };
        const timer = window.setInterval(() => {
            if (canRefresh() && observed.current && !observed.current.stillCurrent()) scheduleRecheck();
        }, COOKIE_CHECK_MS);
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) scheduleRecheck();
        };
        window.addEventListener('focus', scheduleRecheck);
        window.addEventListener('online', scheduleRecheck);
        window.addEventListener('pageshow', onPageShow);
        document.addEventListener('visibilitychange', scheduleRecheck);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener('focus', scheduleRecheck);
            window.removeEventListener('online', scheduleRecheck);
            window.removeEventListener('pageshow', onPageShow);
            document.removeEventListener('visibilitychange', scheduleRecheck);
        };
    }, [guestArchivePresent, refresh]);

    // Read the generation from the rendered view. An event queued by an old
    // button cannot bind itself to the observation refreshed in the meantime.
    const viewIsCurrent = () => mounted.current && !guestArchivePresent
        && generation.current === view.generation && published.current === view;
    // The UI calls this only for explicit candidate interactions. A refresh
    // invalidates the old callback, but retains the cooldown of the same session.
    const reportInteraction = async () => {
        const session = observed.current;
        if (!candidateActivityEnabled || identityOnly || !candidatePreparationEnabled || !viewIsCurrent()
            || !('principal' in view) || !session?.csrfToken || !session.stillCurrent()) return 'skipped';
        const { uid, fenceEpoch } = view.principal;
        try {
            if (!activity.current || activity.current.csrf !== session.csrfToken
                || activity.current.uid !== uid || activity.current.epoch !== fenceEpoch) {
                activity.current = { uid, epoch: fenceEpoch, csrf: session.csrfToken,
                    report: createKindeCandidateActivityReporter({ expectedCsrfToken: session.csrfToken }) };
            }
            return await activity.current.report(() => viewIsCurrent() && session.stillCurrent());
        } catch {
            // A missing/changed cookie cannot attest account activity.
            return 'unavailable';
        }
    };
    const canAct = () => viewIsCurrent() && !busyRef.current;
    const failAction = () => {
        if (viewIsCurrent()) publish({ phase: 'unavailable', generation: view.generation, allowLocalGuest: false });
    };
    const runAction = async (action: () => Promise<void>): Promise<boolean> => {
        if (!canAct()) return false;
        // The lock precedes state publication; focus can arrive in this turn.
        busyRef.current = true;
        setBusy(true);
        try {
            await action();
            return viewIsCurrent();
        } catch {
            failAction();
            return false;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    const signIn = () => {
        if (!canAct() || (view.phase !== 'signed-out' && !(identityOnly && view.phase === 'unavailable'))) return;
        try {
            if (view.phase === 'signed-out' && !observed.current?.stillCurrent()) {
                throw new KindeCandidateBoundaryError();
            }
            submitKindeHostedSignIn(document, viewIsCurrent);
        } catch { failAction(); }
    };

    const enterGuest = async (activate: (stillCurrent: () => boolean) => Promise<void>) => {
        if (view.phase !== 'signed-out' && !(view.phase === 'unavailable' && view.allowLocalGuest)) return;
        await runAction(async () => {
            const session = observed.current;
            if (!session) throw new KindeCandidateBoundaryError();
            const stillCurrent = () => viewIsCurrent() && session.stillCurrent();
            if (!stillCurrent()) throw new KindeCandidateBoundaryError();
            await activate(stillCurrent);
            if (viewIsCurrent() && !stillCurrent()) throw new KindeCandidateBoundaryError();
        });
    };

    const acceptConsent = async (decision: Decision) => {
        if (identityOnly || view.phase !== 'consent-required' || !('principal' in view)) return;
        if (!decision.confirmsOver18 || !decision.acceptedTerms || !decision.acceptedHealthData) return;
        const { principal } = view;
        await runAction(async () => {
            const session = observed.current;
            if (!session?.stillCurrent()) throw new KindeCandidateBoundaryError();
            const accepted = await acceptKindeCandidateInitialConsent({
                expectedOwner: principal, decision,
                stillCurrent: () => viewIsCurrent() && session.stillCurrent(),
            });
            if (!viewIsCurrent()) return;
            if (!session.stillCurrent()) throw new KindeCandidateBoundaryError();
            publish({
                phase: 'consent-confirmed', generation: view.generation,
                principal: { ...principal, ...accepted.principal },
            });
        });
    };

    /**
     * Explicit candidate-only handoff from the observed Kinde session to the
     * existing D1 bootstrap. The live provider leaves this capability disabled;
     * no readiness result installs an authenticated fitness owner or grant.
     */
    const prepareCandidateArchive = async ({ drainPendingJournal = false }: {
        drainPendingJournal?: boolean;
    } = {}): Promise<CandidatePreparationResult> => {
        if (!candidatePreparationEnabled || !canAct()
            || (view.phase !== 'identity-verified' && view.phase !== 'consent-confirmed')
            || view.principal.emailVerified !== true
            || view.principal.healthConsentRevision < 1) {
            throw new KindeCandidateBoundaryError();
        }
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid,
            fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            // The candidate D1/storage modules stay out of the initial guest
            // and identity-only runtime module graph.
            const { prepareKindeCandidateOwner } = await import('../../lib/sync/kindeCandidateOwnerBootstrap');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = await prepareKindeCandidateOwner({
                expected, stillCurrent: current,
                drainPendingJournal, retainDeviceVault: false,
            });
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    /** Read-only membership inspection stays available before a replica claim. */
    const inspectCandidateReplicas = async (): Promise<CandidateReplicaRegistryResult> => {
        if (identityOnly || !candidatePreparationEnabled || !canAct()
            || view.phase !== 'consent-confirmed' || !view.principal.emailVerified
            || view.principal.healthConsentRevision < 1) {
            throw new KindeCandidateBoundaryError();
        }
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const { inspectKindeCandidateReplicaRegistry } = await import('../../lib/sync/kindeCandidateReplicaRegistry');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = await inspectKindeCandidateReplicaRegistry({ expected, stillCurrent: current });
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    /** Inspect old offline operations without requesting a replica or acquiring an ADK. */
    const inspectCandidateOfflineReplicaJournal = async (): Promise<CandidateOfflineReplicaJournalResult> => {
        if (identityOnly || !candidatePreparationEnabled || !canAct()
            || view.phase !== 'consent-confirmed' || !view.principal.emailVerified
            || view.principal.healthConsentRevision < 1) throw new KindeCandidateBoundaryError();
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const { inspectKindeCandidateOfflineReplicaJournal } = await import('../../lib/sync/kindeCandidateOfflineReplicaJournal');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = await inspectKindeCandidateOfflineReplicaJournal({ expected, stillCurrent: current });
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    /** Read the old journal against an authenticated full D1 scan; no claim, provisioning or ACK. */
    const inspectCandidateRetiredReplicaPreflight = async (): Promise<CandidateRetiredReplicaPreflightResult> => {
        if (identityOnly || !candidatePreparationEnabled || !canAct()
            || view.phase !== 'consent-confirmed' || !view.principal.emailVerified
            || view.principal.healthConsentRevision < 1) throw new KindeCandidateBoundaryError();
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const { inspectKindeCandidateRetiredReplicaWithExistingKey } = await import('../../lib/sync/kindeCandidateRetiredReplicaReadOnly');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = await inspectKindeCandidateRetiredReplicaWithExistingKey({ expected, stillCurrent: current });
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    /** Receipt-only recovery cannot create a new writer or re-send an old batch. */
    const recoverCandidateStagedReceipt = async (): Promise<CandidateStagedReceiptResult> => {
        if (identityOnly || !candidatePreparationEnabled || !canAct()
            || view.phase !== 'consent-confirmed' || !view.principal.emailVerified
            || view.principal.healthConsentRevision < 1) throw new KindeCandidateBoundaryError();
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const { recoverKindeCandidateStagedReceipt } = await import('../../lib/sync/kindeCandidateStagedReceiptRecovery');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = await recoverKindeCandidateStagedReceipt({ expected, stillCurrent: current });
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    /** Explicit, isolated maintenance only; no public fitness grant or ACK. */
    const manageCandidateReplicaRetirement = async (witness?: CandidateRetirementWitness): Promise<CandidateRetirementOutcome> => {
        if (identityOnly || !candidatePreparationEnabled || !canAct()
            || view.phase !== 'consent-confirmed' || !view.principal.emailVerified
            || view.principal.healthConsentRevision < 1) throw new KindeCandidateBoundaryError();
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const bridge = await import('../../lib/sync/kindeCandidateReplicaRetirementBridge');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = witness
                ? await bridge.retireKindeCandidateReplica({ expected, witness, stillCurrent: current })
                : await bridge.recoverKindeCandidateReplicaRetirement({ expected, stillCurrent: current });
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    /** Read or cancel only an already sealed membership intent in the isolated candidate. */
    async function manageCandidateReplicaCancellation(): Promise<CandidatePendingMutation>;
    async function manageCandidateReplicaCancellation(mutationId: string): Promise<CandidateCancellationOutcome>;
    async function manageCandidateReplicaCancellation(mutationId?: string): Promise<CandidatePendingMutation | CandidateCancellationOutcome> {
        if (identityOnly || !candidatePreparationEnabled || !canAct()
            || view.phase !== 'consent-confirmed' || !view.principal.emailVerified
            || view.principal.healthConsentRevision < 1) throw new KindeCandidateBoundaryError();
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const bridge = await import('../../lib/sync/kindeCandidateReplicaCancellationBridge');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = mutationId === undefined
                ? await bridge.inspectKindeCandidatePendingReplicaMutation({ expected, stillCurrent: current })
                : await bridge.cancelKindeCandidatePendingReplicaMutation({ expected, stillCurrent: current, mutationId });
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    }

    /**
     * Candidate-only explicit export. Unlock an already provisioned device
     * vault for this operation, then release the exact grant even on failure.
     * Prepare a blob URL without a synthetic browser-save acknowledgement:
     * the UI must offer a separate, synchronous download gesture.
     */
    const prepareCandidateBackup = async (): Promise<{
        url: string; filename: string; isCurrent: () => boolean; dispose: () => void;
    }> => {
        if (identityOnly || !candidatePreparationEnabled || !canAct()
            || view.phase !== 'consent-confirmed'
            || !view.principal.emailVerified || view.principal.healthConsentRevision < 1) {
            throw new KindeCandidateBoundaryError();
        }
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const expected = {
            uid: view.principal.uid,
            fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        const owner = 'user:' + expected.uid;
        const current = () => viewIsCurrent() && session.stillCurrent();
        busyRef.current = true;
        setBusy(true);
        try {
            // Neither import nor read is performed in the public identity-only
            // module graph. A missing vault is NOT permission to provision one.
            const [{ unlockVaultForOwner }, { isKindeAccountLocalFitnessClear }] = await Promise.all([
                import('../../lib/sync/secureArchiveSession'),
                import('../../lib/sync/kindeOwnerLocalFitnessFence'),
            ]);
            const allowed = () => current()
                && isKindeAccountLocalFitnessClear(owner, expected.healthConsentRevision);
            if (!allowed()) throw new KindeCandidateBoundaryError();
            const grant = await unlockVaultForOwner(owner, allowed);
            let json: string;
            let filename: string;
            try {
                if (!grant.isCurrent() || !allowed()) throw new KindeCandidateBoundaryError();
                const { prepareKindeCandidatePortableBackupJson } =
                    await import('../../lib/auth/kindeCandidatePortableBackup');
                if (!grant.isCurrent() || !allowed()) throw new KindeCandidateBoundaryError();
                const result = await prepareKindeCandidatePortableBackupJson({
                    expected, stillCurrent: () => allowed() && grant.isCurrent(),
                });
                if (!grant.isCurrent() || !allowed()) throw new KindeCandidateBoundaryError();
                json = result.json;
                filename = result.filename;
            } finally {
                grant.release();
            }
            if (!allowed()) throw new KindeCandidateBoundaryError();
            const { createKindeCandidatePreparedJson } =
                await import('../../lib/auth/kindeCandidatePreparedJson');
            return createKindeCandidatePreparedJson({ json, filename }, allowed);
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    /**
     * Destructive Kinde consent withdrawal remains behind a second,
     * explicit candidate lifecycle flag. The caller must have shown the
     * optional pre-withdrawal export before requesting confirmation.
     * A lost response leaves the durable local marker pending; no retry
     * of the POST occurs from either this action or the reconciler.
     */
    const withdrawCandidateConsent = async (confirmsErasure: boolean):
        Promise<Awaited<ReturnType<typeof withdrawKindeCandidateHealthConsent>>> => {
        if (!confirmsErasure || identityOnly || !candidatePreparationEnabled
            || !candidateLifecycleEnabled || !canAct()
            || (view.phase !== 'consent-confirmed' && view.phase !== 'email-unverified')
            || view.principal.healthConsentRevision !== 1) {
            throw new KindeCandidateBoundaryError();
        }
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: 1 as const,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const { withdrawKindeCandidateHealthConsent: withdraw } =
                await import('../../lib/auth/kindeCandidateWithdrawal');
            if (!current()) throw new KindeCandidateBoundaryError();
            const proof = await withdraw({
                confirmsErasure: true, expected, stillCurrent: current,
            });
            if (!current()) throw new KindeCandidateBoundaryError();
            // A verified withdrawal receipt does not prove that the erasure
            // job is complete. Refresh only the identity/consent UI.
            await refresh();
            return proof;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    const reconcileCandidateWithdrawal = async ():
        Promise<Awaited<ReturnType<typeof reconcileKindeCandidateWithdrawal>>> => {
        if (identityOnly || !candidatePreparationEnabled || !candidateLifecycleEnabled
            || !canAct() || !('principal' in view)
            || !['consent-confirmed', 'consent-suspended', 'email-unverified'].includes(view.phase)
            || view.principal.healthConsentRevision !== 1) {
            throw new KindeCandidateBoundaryError();
        }
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: 1 as const,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const { reconcileKindeCandidateWithdrawal: reconcile } =
                await import('../../lib/auth/kindeCandidateWithdrawal');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = await reconcile({ expected, stillCurrent: current });
            if (!current()) throw new KindeCandidateBoundaryError();
            if (result.kind === 'withdrawal-proven') await refresh();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    /**
     * Rights-only export does not use a device vault or a fitness grant. It
     * remains available with a previously accepted but unverified email only
     * after the Worker proves that withdrawal and erasure allow the read.
     */
    const prepareCandidateRightsJson = async () => {
        if (identityOnly || !candidatePreparationEnabled || !candidateLifecycleEnabled
            || !canAct() || !('principal' in view)
            || (view.phase !== 'consent-suspended' && view.phase !== 'email-unverified')
            || view.principal.healthConsentRevision !== 1) {
            throw new KindeCandidateBoundaryError();
        }
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const current = () => viewIsCurrent() && session.stillCurrent();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: 1 as const,
        };
        busyRef.current = true;
        setBusy(true);
        try {
            const [{ prepareKindeCandidateRightsJson }, { createKindeCandidatePreparedJson }] =
                await Promise.all([
                    import('../../lib/auth/kindeCandidateRightsExport'),
                    import('../../lib/auth/kindeCandidatePreparedJson'),
                ]);
            if (!current()) throw new KindeCandidateBoundaryError();
            const file = await prepareKindeCandidateRightsJson({
                expected, stillCurrent: current,
            });
            if (!current()) throw new KindeCandidateBoundaryError();
            return createKindeCandidatePreparedJson(file, current);
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };


    /**
     * Candidate-only explicit restore. The import file is parsed before this
     * entrypoint; its schema/owner/coverage is checked before provisioning.
     * Neither a local commit nor an ambiguous D1 response is a cloud ACK.
     */
    const restoreCandidateBackup = async (backup: unknown): Promise<CandidateRestoreResult> => {
        if (identityOnly || !candidatePreparationEnabled || !canAct()
            || view.phase !== 'consent-confirmed' || !view.principal.emailVerified
            || view.principal.healthConsentRevision < 1) {
            throw new KindeCandidateBoundaryError();
        }
        const session = observed.current;
        if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
        const expected = {
            uid: view.principal.uid, fenceEpoch: view.principal.fenceEpoch,
            healthConsentRevision: view.principal.healthConsentRevision,
        };
        const current = () => viewIsCurrent() && session.stillCurrent();
        busyRef.current = true;
        setBusy(true);
        try {
            const { restoreKindeCandidateBackup } = await import('../../lib/auth/kindeCandidateRestore');
            if (!current()) throw new KindeCandidateBoundaryError();
            const result = await restoreKindeCandidateBackup({
                backup, expected, stillCurrent: current,
            });
            if (!current()) throw new KindeCandidateBoundaryError();
            return result;
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    const logout = async () => {
        if (!('principal' in view)) return;
        const completed = await runAction(async () => {
            const session = observed.current;
            if (!session?.csrfToken || !session.stillCurrent()) throw new KindeCandidateBoundaryError();
            await revokeKindeCandidateSession({
                stillCurrent: viewIsCurrent, expectedCsrfToken: session.csrfToken,
            });
        });
        if (completed && viewIsCurrent()) await refresh();
    };

    return {
        view, busy, reportInteraction, signIn, enterGuest, acceptConsent, logout, prepareCandidateArchive,
        inspectCandidateReplicas, inspectCandidateOfflineReplicaJournal, inspectCandidateRetiredReplicaPreflight,
        recoverCandidateStagedReceipt,
        manageCandidateReplicaRetirement, manageCandidateReplicaCancellation,
        prepareCandidateBackup,
        restoreCandidateBackup,
        withdrawCandidateConsent, reconcileCandidateWithdrawal, prepareCandidateRightsJson,
        retry: async () => { if (canAct()) await refresh(); },
    };
}
