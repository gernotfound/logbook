import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { KindeCandidateBoundaryError } from '../../lib/auth/kindeCandidateClient';
import {
    openKindeCandidateFitnessRealm,
    type KindeCandidateFitnessRealm,
    type KindeCandidateFitnessSnapshot,
} from '../../lib/auth/kindeCandidateFitnessRealm';
import type { DomainOperationBatch } from '../../lib/sync/domainOperations';
import type { KindeRoutineDraft } from '../../lib/auth/kindeCandidateRoutineDraft';
import type { KindeExerciseDraft } from '../../lib/auth/kindeCandidateExerciseDraft';
import type { useKindeAccountSession } from './useKindeAccountSession';

type Session = ReturnType<typeof useKindeAccountSession>;
type ObserverView = Session['view'];
type State =
    | { phase: 'closed' }
    | { phase: 'opening' | 'unavailable' | 'recheck-required'; view: ObserverView }
    | { phase: 'ready'; view: ObserverView; snapshot: KindeCandidateFitnessSnapshot; hasPendingJournal: boolean };

const CLOSED: State = { phase: 'closed' };

/**
 * Candidate-only React lifecycle. A verified Kinde observer can request an
 * explicit, bounded fitness realm; changes in its view generation, cookie,
 * visibility, page cache or cross-tab lifecycle invalidate the plaintext view.
 *
 * This hook is intentionally not mounted in the public GuestOnlyAuthProvider:
 * the legacy Zustand writer and consent gate still belong to Firebase. No
 * effect installs an identity reader, loads data automatically or starts sync.
 */
export function useKindeCandidateFitnessLifecycle({
    session, enabled = false,
}: { session: Session; enabled?: boolean }) {
    const [state, setState] = useState<State>(CLOSED);
    const latestView = useRef(session.view);
    const mounted = useRef(false);
    const generation = useRef(0);
    const busy = useRef(false);
    const realm = useRef<KindeCandidateFitnessRealm | null>(null);

    const suspend = useCallback(() => {
        generation.current += 1;
        realm.current?.close();
        realm.current = null;
        setState(CLOSED);
    }, []);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            generation.current += 1;
            realm.current?.close();
            realm.current = null;
        };
    }, []);

    useEffect(() => {
        // Keep imperative generation/cookie callbacks synchronized with the
        // committed React view. Render itself never reads mutable refs.
        latestView.current = session.view;
        const token = ++generation.current;
        realm.current?.close();
        realm.current = null;
        // The old view is already hidden synchronously by the returned
        // immutable view identity; clear its retained plaintext after commit.
        queueMicrotask(() => {
            if (mounted.current && generation.current === token) {
                setState(previous => previous.phase !== 'closed'
                    && (!enabled || previous.view !== session.view) ? CLOSED : previous);
            }
        });
    }, [session.view, enabled]);

    useEffect(() => {
        const onSuspend = () => {
            if (realm.current || busy.current) suspend();
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') onSuspend();
        };
        const onPageHide = (event: PageTransitionEvent) => {
            // Commit removal of the fitness UI before the document is frozen,
            // even if visibilitychange already queued a deferred suspend.
            if (enabled && event.persisted) flushSync(suspend);
        };
        const checkRetainedView = () => {
            if (!busy.current && realm.current && !realm.current.isCurrent()) suspend();
        };
        window.addEventListener('focus', onSuspend);
        window.addEventListener('storage', onSuspend);
        window.addEventListener('online', onSuspend);
        window.addEventListener('offline', checkRetainedView);
        window.addEventListener('pagehide', onPageHide);
        document.addEventListener('visibilitychange', onVisibility);
        // Deadlines and local vault fences can change without a browser event.
        const expiryCheck = enabled ? window.setInterval(checkRetainedView, 1000) : null;
        return () => {
            if (expiryCheck !== null) window.clearInterval(expiryCheck);
            window.removeEventListener('focus', onSuspend);
            window.removeEventListener('storage', onSuspend);
            window.removeEventListener('online', onSuspend);
            window.removeEventListener('offline', checkRetainedView);
            window.removeEventListener('pagehide', onPageHide);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [suspend, enabled]);

    const open = async (): Promise<void> => {
        const view = session.view;
        if (!enabled || !mounted.current || busy.current || realm.current
            || view.phase !== 'consent-confirmed' || view.principal.emailVerified !== true
            || view.principal.healthConsentRevision < 1) throw new KindeCandidateBoundaryError();
        const token = generation.current;
        const current = () => mounted.current && token === generation.current
            && latestView.current === view && enabled;
        busy.current = true;
        setState({ phase: 'opening', view });
        try {
            const opened = await openKindeCandidateFitnessRealm({
                expected: {
                    uid: view.principal.uid,
                    fenceEpoch: view.principal.fenceEpoch,
                    healthConsentRevision: view.principal.healthConsentRevision,
                },
                stillCurrent: current,
            });
            if (!current() || !opened.isCurrent()) {
                opened.close();
                throw new KindeCandidateBoundaryError();
            }
            const snapshot = opened.snapshot();
            if (!snapshot) {
                opened.close();
                throw new KindeCandidateBoundaryError();
            }
            realm.current = opened;
            setState({ phase: 'ready', view, snapshot, hasPendingJournal: false });
        } catch (error) {
            if (current()) setState({ phase: 'unavailable', view });
            throw error;
        } finally {
            busy.current = false;
        }
    };

    const recheck = async (): Promise<void> => {
        const active = realm.current;
        if (!enabled || busy.current || !active?.isCurrent()
            || state.phase !== 'recheck-required' || state.view !== session.view) {
            throw new KindeCandidateBoundaryError();
        }
        const view = state.view;
        busy.current = true;
        setState({ phase: 'opening', view });
        try {
            // The original encrypted journal is already durable. Re-enter the
            // trusted readiness/receipt path, never dispatch the user's intent
            // again: replaying it here would create a second semantic operation.
            await active.refresh();
            if (realm.current !== active || !active.isCurrent()
                || latestView.current !== view) throw new KindeCandidateBoundaryError();
            const snapshot = active.snapshot();
            if (!snapshot) throw new KindeCandidateBoundaryError();
            setState({ phase: 'ready', view, snapshot, hasPendingJournal: false });
        } catch (error) {
            if (realm.current === active) {
                active.close();
                realm.current = null;
                setState({ phase: 'unavailable', view });
            }
            throw error;
        } finally {
            busy.current = false;
        }
    };

    const runMutation = async <T extends { outcome: Awaited<ReturnType<KindeCandidateFitnessRealm['submit']>> }>(
        run: (active: KindeCandidateFitnessRealm) => Promise<T>,
    ): Promise<T> => {
        const active = realm.current;
        if (!enabled || busy.current || !active?.isCurrent()
            || state.phase !== 'ready' || state.view !== session.view) {
            throw new KindeCandidateBoundaryError();
        }
        const view = state.view;
        busy.current = true;
        setState({ phase: 'opening', view });
        try {
            const result = await run(active);
            if (realm.current !== active || !active.isCurrent()) throw new KindeCandidateBoundaryError();
            const snapshot = active.snapshot();
            setState(snapshot
                ? { phase: 'ready', view, snapshot, hasPendingJournal: result.outcome.kind === 'local-pending' }
                : { phase: 'recheck-required', view });
            return result;
        } catch (error) {
            if (realm.current === active) {
                // Terminal failures must release this scope so a fresh
                // identity/consent bootstrap can be explicitly requested.
                active.close();
                realm.current = null;
                setState({ phase: 'unavailable', view });
            }
            throw error;
        } finally {
            busy.current = false;
        }
    };

    const submit = async (operation: DomainOperationBatch) => (
        await runMutation(async active => ({ outcome: await active.submit(operation) }))
    ).outcome;

    const saveRoutineDraft = (draft: KindeRoutineDraft) => runMutation(active => active.saveRoutineDraft(draft));
    const saveExerciseDraft = (draft: KindeExerciseDraft) => runMutation(active => active.saveExerciseDraft(draft));

    const captureEditWitness = () => {
        const active = realm.current;
        if (!enabled || state.phase !== 'ready' || state.view !== session.view
            || !active?.isCurrent()) return null;
        const view = state.view;
        return {
            owner: state.snapshot.owner,
            isCurrent: () => latestView.current === view
                && realm.current === active && active.isCurrent(),
        };
    };

    const openDraft = async <T extends { close: () => void }>(open: (active: KindeCandidateFitnessRealm) => Promise<T>) => {
        const active = realm.current;
        const witness = captureEditWitness();
        if (!active || !witness || busy.current) throw new KindeCandidateBoundaryError();
        busy.current = true;
        try {
            const opened = await open(active);
            if (!witness.isCurrent()) {
                opened.close();
                throw new KindeCandidateBoundaryError();
            }
            return opened;
        } finally { busy.current = false; }
    };

    return {
        // The immutable view identity suppresses stale plaintext on the very
        // render that changes identity, before passive effects can dispose.
        state: state.phase !== 'closed' && (!enabled || state.view !== session.view)
            ? CLOSED : state,
        open, submit, recheck, suspend, captureEditWitness,
        openRoutineDraft: (id?: string) => openDraft(active => active.openRoutineDraft(id)),
        openExerciseDraft: (id?: string) => openDraft(active => active.openExerciseDraft(id)),
        saveRoutineDraft, saveExerciseDraft,
    };
}
