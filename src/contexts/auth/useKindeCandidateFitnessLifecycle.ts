import { useCallback, useEffect, useRef, useState } from 'react';
import { KindeCandidateBoundaryError } from '../../lib/auth/kindeCandidateClient';
import {
    openKindeCandidateFitnessRealm,
    type KindeCandidateFitnessRealm,
    type KindeCandidateFitnessSnapshot,
} from '../../lib/auth/kindeCandidateFitnessRealm';
import type { DomainOperationBatch } from '../../lib/sync/domainOperations';
import type { useKindeAccountSession } from './useKindeAccountSession';

type Session = ReturnType<typeof useKindeAccountSession>;
type ObserverView = Session['view'];
type State =
    | { phase: 'closed' }
    | { phase: 'opening' | 'unavailable' | 'recheck-required'; view: ObserverView }
    | { phase: 'ready'; view: ObserverView; snapshot: KindeCandidateFitnessSnapshot };

const CLOSED: State = { phase: 'closed' };

/**
 * Candidate-only React lifecycle. A verified Kinde observer can request an
 * explicit, bounded fitness realm; changes in its view generation, cookie,
 * visibility or cross-tab lifecycle invalidate the entire plaintext view.
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
        window.addEventListener('focus', onSuspend);
        window.addEventListener('storage', onSuspend);
        window.addEventListener('online', onSuspend);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('focus', onSuspend);
            window.removeEventListener('storage', onSuspend);
            window.removeEventListener('online', onSuspend);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [suspend]);

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
            setState({ phase: 'ready', view, snapshot });
        } catch (error) {
            if (current()) setState({ phase: 'unavailable', view });
            throw error;
        } finally {
            busy.current = false;
        }
    };

    const submit = async (operation: DomainOperationBatch) => {
        const active = realm.current;
        if (!enabled || busy.current || !active?.isCurrent()
            || state.phase !== 'ready' || state.view !== session.view) {
            throw new KindeCandidateBoundaryError();
        }
        const view = state.view;
        busy.current = true;
        setState({ phase: 'opening', view });
        try {
            const outcome = await active.submit(operation);
            if (realm.current !== active || !active.isCurrent()) throw new KindeCandidateBoundaryError();
            const snapshot = active.snapshot();
            setState(snapshot ? { phase: 'ready', view, snapshot } : { phase: 'recheck-required', view });
            return outcome;
        } catch (error) {
            if (realm.current === active) setState({ phase: 'unavailable', view });
            throw error;
        } finally {
            busy.current = false;
        }
    };

    return {
        // The immutable view identity suppresses stale plaintext on the very
        // render that changes identity, before passive effects can dispose.
        state: state.phase !== 'closed' && (!enabled || state.view !== session.view)
            ? CLOSED : state,
        open, submit, suspend,
    };
}
