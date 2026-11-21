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
type State =
    | { phase: 'closed' | 'opening' | 'unavailable' | 'recheck-required' }
    | { phase: 'ready'; snapshot: KindeCandidateFitnessSnapshot };

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
    const viewRef = useRef(session.view);
    viewRef.current = session.view;
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
        // Even the same UID/consent revision with a replacement React view
        // must not reuse plaintext or an old session's CSRF witness.
        suspend();
    }, [session.view, enabled, suspend]);

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
        const view = viewRef.current;
        if (!enabled || !mounted.current || busy.current || realm.current
            || view.phase !== 'consent-confirmed' || view.principal.emailVerified !== true
            || view.principal.healthConsentRevision < 1) throw new KindeCandidateBoundaryError();
        const token = generation.current;
        const current = () => mounted.current && token === generation.current
            && viewRef.current === view && enabled;
        busy.current = true;
        setState({ phase: 'opening' });
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
            setState({ phase: 'ready', snapshot });
        } catch (error) {
            if (current()) setState({ phase: 'unavailable' });
            throw error;
        } finally {
            busy.current = false;
        }
    };

    const submit = async (operation: DomainOperationBatch) => {
        const active = realm.current;
        if (!enabled || busy.current || !active?.isCurrent() || state.phase !== 'ready') {
            throw new KindeCandidateBoundaryError();
        }
        busy.current = true;
        setState({ phase: 'opening' });
        try {
            const outcome = await active.submit(operation);
            if (realm.current !== active || !active.isCurrent()) throw new KindeCandidateBoundaryError();
            const snapshot = active.snapshot();
            setState(snapshot ? { phase: 'ready', snapshot } : { phase: 'recheck-required' });
            return outcome;
        } catch (error) {
            if (realm.current === active) setState({ phase: 'unavailable' });
            throw error;
        } finally {
            busy.current = false;
        }
    };

    return {
        // Synchronously suppress a view after a cookie/withdrawal fence change,
        // even before the parent Kinde observer has published its next state.
        state: state.phase === 'ready' && !realm.current?.isCurrent()
            ? { phase: 'unavailable' } as State : state,
        open, submit, suspend,
    };
}
