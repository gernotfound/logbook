import { useCallback, useEffect, useRef, useState } from 'react';
import {
    captureKindeCandidatePresenceFence, KindeCandidateBoundaryError, readKindeCandidateAccess,
    revokeKindeCandidateSession, submitKindeHostedSignIn,
} from '../../lib/auth/kindeCandidateClient';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';

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

// Read only the local CSRF-cookie witness. Network refresh is triggered only
// on a change or a foreground event, including browsers without CookieStore.
const COOKIE_CHECK_MS = 1000;

export function useKindeAccountSession({
    guestArchivePresent, identityOnly,
}: { guestArchivePresent: boolean; identityOnly: boolean }) {
    const [view, setView] = useState<View>({
        phase: guestArchivePresent ? 'guest-blocked' : 'checking', generation: 0,
    });
    const [busy, setBusy] = useState(false);
    const published = useRef(view);
    const mounted = useRef(false);
    const busyRef = useRef(false);
    const generation = useRef(0);
    const observed = useRef<PresenceFence | null>(null);
    const publish = useCallback((next: View) => {
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
        window.addEventListener('focus', scheduleRecheck);
        window.addEventListener('online', scheduleRecheck);
        document.addEventListener('visibilitychange', scheduleRecheck);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener('focus', scheduleRecheck);
            window.removeEventListener('online', scheduleRecheck);
            document.removeEventListener('visibilitychange', scheduleRecheck);
        };
    }, [guestArchivePresent, refresh]);

    // Read the generation from the rendered view. An event queued by an old
    // button cannot bind itself to the observation refreshed in the meantime.
    const viewIsCurrent = () => mounted.current && !guestArchivePresent
        && generation.current === view.generation && published.current === view;
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
        view, busy, signIn, enterGuest, acceptConsent, logout,
        retry: async () => { if (canAct()) await refresh(); },
    };
}
