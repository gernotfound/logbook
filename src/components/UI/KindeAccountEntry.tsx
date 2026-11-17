import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
    KindeCandidateBoundaryError, readKindeCandidateAccess,
    revokeKindeCandidateSession, submitKindeHostedSignIn,
} from '../../lib/auth/kindeCandidateClient';
import {
    readKindeCandidateIdentity,
    type KindeCandidateIdentity,
} from '../../lib/auth/kindeCandidateIdentity';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';
import { TermsAndConditions } from '../../pages/TermsAndConditions';

type Phase = 'checking' | 'signed-out' | 'email-unverified' | 'identity-verified' | 'consent-required'
    | 'consent-confirmed' | 'legal-update-required' | 'consent-suspended'
    | 'guest-blocked' | 'unavailable';

const copy: Record<Exclude<Phase, 'checking' | 'signed-out' | 'consent-required' | 'guest-blocked'>, string> = {
    'email-unverified': 'Verifica il tuo indirizzo email tramite Kinde prima di accedere ai dati.',
    'identity-verified': 'Sessione Kinde verificata. L’accesso ai dati, il consenso e la sincronizzazione restano disabilitati fino al collaudo completo.',
    'consent-confirmed': 'Identità e consenso verificati. I dati rimangono bloccati finché archivio e sincronizzazione Kinde non saranno attivati e collaudati.',
    'legal-update-required': 'Le versioni dei documenti legali non sono più attuali. Le funzioni fitness restano bloccate.',
    'consent-suspended': 'Il consenso è revocato o la cancellazione è in corso. Le funzioni fitness sono sospese.',
    unavailable: 'Impossibile verificare la sessione in modo sicuro. Nessun dato è stato sbloccato.',
};

/**
 * Isolated Kinde identity entry. identityOnly is the first publicly mounted
 * account stage; it never calls consent or fitness APIs, adopts a Firebase User,
 * unlocks a vault or publishes an authenticated owner to the legacy store.
 * The full consent candidate remains unmounted until the D1 cutover is proven.
 */
export function KindeAccountEntry({
    guestArchivePresent = false,
    identityOnly = false,
    onLocalGuest,
}: {
    guestArchivePresent?: boolean;
    identityOnly?: boolean;
    onLocalGuest?: () => Promise<void>;
}) {
    const [phase, setPhase] = useState<Phase>(guestArchivePresent ? 'guest-blocked' : 'checking');
    const [busy, setBusy] = useState(false);
    const [over18, setOver18] = useState(false);
    const [terms, setTerms] = useState(false);
    const [health, setHealth] = useState(false);
    const generation = useRef(0);
    const mounted = useRef(false);
    const titleId = useId();
    const privacyDetails = useRef<HTMLDetailsElement>(null);
    const termsDetails = useRef<HTMLDetailsElement>(null);

    const refresh = useCallback(async () => {
        const token = ++generation.current;
        const current = () => mounted.current && generation.current === token && !guestArchivePresent;
        if (guestArchivePresent) {
            await Promise.resolve();
            if (mounted.current && generation.current === token) setPhase('guest-blocked');
            return;
        }
        try {
            const identity: KindeCandidateIdentity = await readKindeCandidateIdentity({
                stillCurrent: current,
            });
            if (!current()) return;
            if (identity.kind === 'signed-out') {
                setPhase('signed-out');
                return;
            }
            if (identity.kind === 'email-unverified') {
                setPhase('email-unverified');
                return;
            }
            if (identityOnly) {
                // A verified identity does not imply health consent or local
                // archive ownership. The D1 fitness route is not public yet.
                setPhase('identity-verified');
                return;
            }
            const access = await readKindeCandidateAccess({ stillCurrent: current });
            if (!current()) return;
            if (access.kind === 'signed-out'
                || access.principal.uid !== identity.principal.uid
                || access.principal.fenceEpoch !== identity.principal.fenceEpoch
                || access.principal.healthConsentRevision !== identity.principal.healthConsentRevision) {
                throw new KindeCandidateBoundaryError();
            }
            setPhase(access.kind === 'consent-required' ? 'consent-required'
                : access.kind === 'consent-confirmed' ? 'consent-confirmed'
                    : access.kind === 'legal-update-required' ? 'legal-update-required'
                        : 'consent-suspended');
        } catch {
            if (current()) setPhase('unavailable');
        }
    }, [guestArchivePresent, identityOnly]);

    useEffect(() => {
        mounted.current = true;
        const effectGeneration = ++generation.current;
        // React's commit must finish before an HTTP result may publish UI state.
        // A StrictMode teardown or owner-mode change invalidates this start.
        queueMicrotask(() => {
            if (mounted.current && generation.current === effectGeneration) {
                void refresh();
            }
        });
        return () => {
            mounted.current = false;
            generation.current += 1;
        };
    }, [refresh]);

    const handleSignIn = () => {
        if (busy || guestArchivePresent || phase !== 'signed-out') return;
        const token = generation.current;
        try {
            submitKindeHostedSignIn(document, () =>
                mounted.current && generation.current === token && !guestArchivePresent);
        } catch {
            if (mounted.current && generation.current === token) setPhase('unavailable');
        }
    };

    const handleLocalGuest = async () => {
        if (busy || guestArchivePresent || !['signed-out', 'unavailable'].includes(phase)
            || !onLocalGuest) return;
        const token = generation.current;
        const current = () => mounted.current && generation.current === token && !guestArchivePresent;
        setBusy(true);
        try {
            await onLocalGuest();
        } catch {
            if (current()) setPhase('unavailable');
        } finally {
            if (current()) setBusy(false);
        }
    };

    const handleConsent = async () => {
        if (busy || guestArchivePresent || phase !== 'consent-required'
            || !over18 || !terms || !health) return;
        const token = generation.current;
        const current = () => mounted.current && generation.current === token && !guestArchivePresent;
        setBusy(true);
        try {
            await acceptKindeCandidateInitialConsent({
                decision: { confirmsOver18: over18, acceptedTerms: terms, acceptedHealthData: health },
                stillCurrent: current,
            });
            if (current()) setPhase('consent-confirmed');
        } catch {
            if (current()) setPhase('unavailable');
        } finally {
            if (current()) setBusy(false);
        }
    };

    const handleLogout = async () => {
        if (busy || guestArchivePresent
            || !['email-unverified', 'identity-verified', 'consent-required', 'consent-confirmed',
                'legal-update-required', 'consent-suspended'].includes(phase)) return;
        const token = generation.current;
        const current = () => mounted.current && generation.current === token && !guestArchivePresent;
        setBusy(true);
        try {
            await revokeKindeCandidateSession({ stillCurrent: current });
            if (current()) {
                setOver18(false);
                setTerms(false);
                setHealth(false);
                setBusy(false);
                await refresh();
            }
        } catch {
            if (current()) setPhase('unavailable');
        } finally {
            if (current()) setBusy(false);
        }
    };

    return (
        <main className="auth-login-card" aria-labelledby={titleId}>
            <h1 id={titleId}>TheLogBook · Accesso Kinde</h1>
            {phase === 'checking' && <p role="status">Verifica della sessione…</p>}
            {phase === 'guest-blocked' && (
                <p role="alert">È presente un archivio ospite. Il trasferimento verso Kinde non è ancora abilitato: i tuoi dati locali sono conservati. Resta nella modalità locale.</p>
            )}
            {phase === 'signed-out' && (
                <>
                    <p>Accedi o registrati tramite il servizio di identità Kinde. Nessuna password viene inserita in TheLogBook.</p>
                    <button type="button" className="btn btn-primary" onClick={handleSignIn}>
                        Accedi o registrati
                    </button>
                    {onLocalGuest && <button type="button" className="btn" disabled={busy}
                        onClick={() => { void handleLocalGuest(); }}>Continua senza account</button>}
                    {onLocalGuest && <p>I dati dell’ospite rimangono solo su questo dispositivo e non vengono associati all’account Kinde.</p>}
                </>
            )}
            {phase === 'consent-required' && (
                <section aria-label="Consenso iniziale">
                    <p>Prima di utilizzare le funzioni fitness, conferma separatamente i seguenti requisiti.</p>
                    <label><input type="checkbox" checked={over18} disabled={busy}
                        onChange={event => setOver18(event.target.checked)} /> Confermo di avere almeno 18 anni.</label>
                    <label><input type="checkbox" checked={terms} disabled={busy}
                        onChange={event => setTerms(event.target.checked)} /> Ho letto e accetto i Termini e Condizioni.</label>
                    <label><input type="checkbox" checked={health} disabled={busy}
                        onChange={event => setHealth(event.target.checked)} /> Acconsento esplicitamente al trattamento dei dati sanitari per il servizio.</label>
                    <details ref={privacyDetails}><summary className="disclosure-summary">Leggi l'informativa sulla privacy</summary><PrivacyPolicy onClose={() => { if (privacyDetails.current) privacyDetails.current.open = false; }} /></details>
                    <details ref={termsDetails}><summary className="disclosure-summary">Leggi i Termini e Condizioni</summary><TermsAndConditions onClose={() => { if (termsDetails.current) termsDetails.current.open = false; }} /></details>
                    <button type="button" className="btn btn-primary" disabled={busy || !over18 || !terms || !health}
                        onClick={() => { void handleConsent(); }}>Conferma consenso</button>
                </section>
            )}
            {phase !== 'checking' && phase !== 'signed-out' && phase !== 'consent-required'
                && phase !== 'guest-blocked' && <p role="status">{copy[phase]}</p>}
            {phase === 'unavailable' && (
                <>
                    <button type="button" className="btn" disabled={busy}
                        onClick={() => { setPhase('checking'); void refresh(); }}>Riprova la verifica</button>
                    {onLocalGuest && !guestArchivePresent && (
                        <>
                            <button type="button" className="btn" disabled={busy}
                                onClick={() => { void handleLocalGuest(); }}>Continua senza account</button>
                            <p>Puoi utilizzare soltanto l'archivio ospite locale, anche offline. La sessione Kinde e i dati cloud non sono disponibili e non vengono associati all'ospite.</p>
                        </>
                    )}
                </>
            )}
            {['email-unverified', 'identity-verified', 'consent-required', 'consent-confirmed',
                'legal-update-required', 'consent-suspended'].includes(phase) && (
                <button type="button" className="btn" disabled={busy}
                    onClick={() => { void handleLogout(); }}>Termina sessione TheLogBook</button>
            )}
        </main>
    );
}
