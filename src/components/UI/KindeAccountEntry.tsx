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

type Phase = 'checking' | 'signed-out' | 'email-unverified' | 'consent-required'
    | 'consent-confirmed' | 'legal-update-required' | 'consent-suspended'
    | 'guest-blocked' | 'unavailable';

const copy: Record<Exclude<Phase, 'checking' | 'signed-out' | 'consent-required' | 'guest-blocked'>, string> = {
    'email-unverified': 'Verifica il tuo indirizzo email tramite Kinde prima di accedere ai dati.',
    'consent-confirmed': 'Identità e consenso verificati. I dati rimangono bloccati finché archivio e sincronizzazione Kinde non saranno attivati e collaudati.',
    'legal-update-required': 'Le versioni dei documenti legali non sono più attuali. Le funzioni fitness restano bloccate.',
    'consent-suspended': 'Il consenso è revocato o la cancellazione è in corso. Le funzioni fitness sono sospese.',
    unavailable: 'Impossibile verificare la sessione in modo sicuro. Nessun dato è stato sbloccato.',
};

/**
 * Candidate-only isolated account entry. Never supplies Firebase User, vault
 * unlock, owner adoption or fitness permissions. The actual App/AuthProvider
 * remains separate until the production Kinde provider and sync are validated.
 */
export function KindeAccountEntry({
    guestArchivePresent = false,
}: {
    guestArchivePresent?: boolean;
}) {
    const [phase, setPhase] = useState<Phase>('checking');
    const [busy, setBusy] = useState(false);
    const [over18, setOver18] = useState(false);
    const [terms, setTerms] = useState(false);
    const [health, setHealth] = useState(false);
    const generation = useRef(0);
    const mounted = useRef(false);
    const titleId = useId();

    const refresh = useCallback(async () => {
        const token = ++generation.current;
        const current = () => mounted.current && generation.current === token && !guestArchivePresent;
        if (guestArchivePresent) {
            setPhase('guest-blocked');
            return;
        }
        setPhase('checking');
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
    }, [guestArchivePresent]);

    useEffect(() => {
        mounted.current = true;
        void refresh();
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
            || !['email-unverified', 'consent-required', 'consent-confirmed',
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
                    <details><summary>Leggi l'informativa sulla privacy</summary><PrivacyPolicy /></details>
                    <details><summary>Leggi i Termini e Condizioni</summary><TermsAndConditions /></details>
                    <button type="button" className="btn btn-primary" disabled={busy || !over18 || !terms || !health}
                        onClick={() => { void handleConsent(); }}>Conferma consenso</button>
                </section>
            )}
            {phase !== 'checking' && phase !== 'signed-out' && phase !== 'consent-required'
                && phase !== 'guest-blocked' && <p role="status">{copy[phase]}</p>}
            {phase === 'unavailable' && (
                <button type="button" className="btn" disabled={busy}
                    onClick={() => { void refresh(); }}>Riprova la verifica</button>
            )}
            {['email-unverified', 'consent-required', 'consent-confirmed',
                'legal-update-required', 'consent-suspended'].includes(phase) && (
                <button type="button" className="btn" disabled={busy}
                    onClick={() => { void handleLogout(); }}>Termina sessione TheLogBook</button>
            )}
        </main>
    );
}
