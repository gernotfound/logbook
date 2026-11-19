import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useSharedKindeAccountSession } from '../../contexts/auth/kindeAccountSessionContext';
import { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import { PrivacyPolicy } from '../../pages/PrivacyPolicy';
import { TermsAndConditions } from '../../pages/TermsAndConditions';
import { KindeCandidateBackupPanel } from './KindeCandidateBackupPanel';
const KindeCandidateWithdrawalPanel = lazy(async () =>
    ({ default: (await import('./KindeCandidateWithdrawalPanel')).KindeCandidateWithdrawalPanel }));
const KindeCandidateRightsPanel = lazy(async () =>
    ({ default: (await import('./KindeCandidateRightsPanel')).KindeCandidateRightsPanel }));

type Phase = ReturnType<typeof useKindeAccountSession>['view']['phase'];
type AcceptConsent = ReturnType<typeof useKindeAccountSession>['acceptConsent'];

const copy: Record<Exclude<Phase, 'checking' | 'signed-out' | 'consent-required' | 'guest-blocked'>, string> = {
    'email-unverified': 'Verifica il tuo indirizzo email tramite Kinde prima di accedere ai dati.',
    'identity-verified': 'Sessione Kinde verificata. L’accesso ai dati, il consenso e la sincronizzazione restano disabilitati fino al collaudo completo.',
    'consent-confirmed': 'Identità e consenso verificati. I dati rimangono bloccati finché archivio e sincronizzazione Kinde non saranno attivati e collaudati.',
    'legal-update-required': 'Le versioni dei documenti legali non sono più attuali. Le funzioni fitness restano bloccate.',
    'consent-suspended': 'Il consenso è revocato o la cancellazione è in corso. Le funzioni fitness sono sospese.',
    unavailable: 'Impossibile verificare la sessione in modo sicuro. Nessun dato è stato sbloccato.',
};

function KindeInitialConsentForm({ busy, onAccept }: { busy: boolean; onAccept: AcceptConsent }) {
    const [over18, setOver18] = useState(false);
    const [terms, setTerms] = useState(false);
    const [health, setHealth] = useState(false);
    const privacyDetails = useRef<HTMLDetailsElement>(null);
    const termsDetails = useRef<HTMLDetailsElement>(null);

    return (
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
                onClick={() => { void onAccept({
                    confirmsOver18: over18, acceptedTerms: terms, acceptedHealthData: health,
                }); }}>Conferma consenso</button>
        </section>
    );
}

/**
 * The public, identity-only entry doesn't contact consent or fitness APIs.
 * The full candidate entry can collect consent without opening a data vault.
 */
type EntryProps = {
    guestArchivePresent?: boolean;
    identityOnly?: boolean;
    // Only isolated candidate entry points may enable this; the public provider
    // continues observing Kinde identity without enabling fitness or D1.
    candidatePreparationEnabled?: boolean;
    // A second opt-in isolates destructive withdrawal and post-revocation rights.
    candidateLifecycleEnabled?: boolean;
    onLocalGuest?: (stillCurrent: () => boolean) => Promise<void>;
};
type Session = ReturnType<typeof useKindeAccountSession>;

function KindeCandidatePreparation({ session }: { session: Session }) {
    const [state, setState] = useState<'idle' | 'working' | 'observed' | 'pending' | 'error'>('idle');
    const mounted = useRef(true);
    const running = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const continueSetup = () => {
        if (running.current || session.busy || state === 'observed') return;
        running.current = true;
        setState('working');
        void session.prepareCandidateArchive({ drainPendingJournal: true }).then(result => {
            if (!mounted.current) return;
            // A checkpoint and replica alone do not acknowledge pending edits.
            // The candidate needs either the exact journal receipt or proof
            // that no pending delivery remains before reporting completion.
            const complete = result.kind === 'candidate-observed'
                && result.checkpointRevision !== null
                && (result.replicaOutcome === 'adopted'
                    || result.replicaOutcome === 'already-active')
                && result.journalDrained === true
                && (result.journalOutcome === 'idle'
                    || result.journalOutcome === 'acknowledged');
            setState(complete ? 'observed' : 'pending');
        }).catch(() => {
            if (mounted.current) setState('error');
        }).finally(() => { running.current = false; });
    };

    return (
        <section aria-label="Preparazione account cifrato">
            <p>Il consenso è stato verificato. Continua per controllare l’archivio cifrato dell’account.</p>
            <button type="button" className="btn btn-primary"
                disabled={session.busy || state === 'working' || state === 'observed'}
                onClick={continueSetup}>
                {state === 'working' ? 'Preparazione in corso…' : 'Continua'}
            </button>
            {state === 'observed' && (
                <p role="status">Archivio cifrato verificato nel percorso candidato. Le funzioni fitness restano disabilitate.</p>
            )}
            {state === 'pending' && (
                <p role="status">Preparazione non ancora confermata. I dati cifrati e le operazioni in attesa sono conservati: puoi riprovare.</p>
            )}
            {state === 'error' && (
                <p role="alert">Impossibile completare la preparazione. I dati esistenti restano protetti; riprova dopo la verifica della sessione.</p>
            )}
        </section>
    );
}

/** Identity-only runtime and the isolated candidate share the same presentation. */
function KindeAccountEntryView({
    identityOnly = false, candidatePreparationEnabled = false,
    candidateLifecycleEnabled = false, onLocalGuest, session,
}: Pick<EntryProps, 'identityOnly' | 'candidatePreparationEnabled' | 'candidateLifecycleEnabled' | 'onLocalGuest'> & { session: Session }) {
    const { view, busy, retry, signIn, enterGuest, acceptConsent, logout } = session;
    const { phase } = view;
    const titleId = useId();

    return (
        <main id={identityOnly ? 'auth-kinde-entry' : undefined}
            className="auth-login-card ui-login-box-1" aria-labelledby={titleId}>
            {identityOnly
                ? <h2 id={titleId}>Accesso con Kinde</h2>
                : <h1 id={titleId}>TheLogBook · Accesso Kinde</h1>}
            {phase === 'checking' && <p role="status">Verifica della sessione…</p>}
            {phase === 'guest-blocked' && (
                <p role="alert">È presente un archivio ospite. Il trasferimento verso Kinde non è ancora abilitato: i tuoi dati locali sono conservati. Resta nella modalità locale.</p>
            )}
            {phase === 'signed-out' && (
                <>
                    <p>Accedi o registrati tramite il servizio di identità Kinde. Nessuna password viene inserita in TheLogBook.</p>
                    <button type="button" className="btn btn-primary" onClick={signIn}>
                        Accedi o registrati
                    </button>
                    {onLocalGuest && <button type="button" className="btn auth-guest-action" disabled={busy}
                        onClick={() => { void enterGuest(onLocalGuest); }}>
                        <span>Continua senza account</span>
                        <span className="auth-guest-action__detail">I dati saranno salvati solo sul dispositivo.</span>
                    </button>}
                </>
            )}
            {phase === 'consent-required' && (
                <KindeInitialConsentForm key={view.generation} busy={busy} onAccept={acceptConsent} />
            )}
            {phase !== 'checking' && phase !== 'signed-out' && phase !== 'consent-required'
                && phase !== 'guest-blocked' && <p role="status">{copy[phase]}</p>}
            {!identityOnly && candidatePreparationEnabled && phase === 'consent-confirmed'
                && 'principal' in view && (
                    <div key={String(view.generation) + ':' + view.principal.uid + ':'
                        + String(view.principal.fenceEpoch) + ':' + String(view.principal.healthConsentRevision)}>
                        <KindeCandidatePreparation session={session} />
                        {candidateLifecycleEnabled
                            ? <Suspense fallback={<p role="status">Caricamento dei diritti account…</p>}>
                                <KindeCandidateWithdrawalPanel session={session} />
                            </Suspense>
                            : <KindeCandidateBackupPanel session={session} />}
                    </div>
                )}
            {!identityOnly && candidatePreparationEnabled && candidateLifecycleEnabled
                && phase === 'email-unverified' && 'principal' in view
                && view.principal.healthConsentRevision === 1 && (
                    <Suspense fallback={<p role="status">Caricamento gestione del consenso…</p>}>
                        <KindeCandidateWithdrawalPanel key={String(view.generation) + ':' + view.principal.uid
                            + ':' + String(view.principal.fenceEpoch)} session={session} allowBackup={false} />
                    </Suspense>
                )}
            {!identityOnly && candidatePreparationEnabled && candidateLifecycleEnabled
                && phase === 'consent-suspended' && 'principal' in view
                && view.principal.healthConsentRevision === 1 && (
                    <Suspense fallback={<p role="status">Caricamento stato della revoca…</p>}>
                        <KindeCandidateWithdrawalPanel key={String(view.generation) + ':' + view.principal.uid
                            + ':' + String(view.principal.fenceEpoch)} session={session}
                            allowBackup={false} allowWithdrawal={false} />
                    </Suspense>
                )}
            {!identityOnly && candidatePreparationEnabled && candidateLifecycleEnabled
                && 'principal' in view && view.principal.healthConsentRevision === 1
                && (phase === 'consent-suspended' || phase === 'email-unverified') && (
                    <Suspense fallback={<p role="status">Caricamento accesso ai dati…</p>}>
                        <KindeCandidateRightsPanel key={String(view.generation) + ':' + view.principal.uid
                            + ':' + String(view.principal.fenceEpoch)} session={session} />
                    </Suspense>
                )}
            {phase === 'unavailable' && (
                <>
                    <button type="button" className="btn" disabled={busy}
                        onClick={() => { void retry(); }}>Riprova la verifica</button>
                    {identityOnly && <button type="button" className="btn btn-primary" disabled={busy}
                        onClick={signIn}>Avvia un nuovo accesso con Kinde</button>}
                    {onLocalGuest && view.allowLocalGuest && (
                        <>
                            <button type="button" className="btn auth-guest-action" disabled={busy}
                                onClick={() => { void enterGuest(onLocalGuest); }}>
                                <span>Continua senza account</span>
                                <span className="auth-guest-action__detail">I dati saranno salvati solo sul dispositivo.</span>
                            </button>
                            <p>Modalità locale anche offline: nessun account Kinde o accesso cloud è stato verificato.</p>
                        </>
                    )}
                </>
            )}
            {'principal' in view && (
                <button type="button" className="btn" disabled={busy}
                    onClick={() => { void logout(); }}>Termina sessione TheLogBook</button>
            )}
        </main>
    );
}

function StandaloneKindeAccountEntry({
    guestArchivePresent = false, identityOnly = false, candidatePreparationEnabled = false,
    candidateLifecycleEnabled = false, onLocalGuest,
}: EntryProps) {
    const session = useKindeAccountSession({
        guestArchivePresent, identityOnly, candidatePreparationEnabled, candidateLifecycleEnabled,
    });
    return <KindeAccountEntryView session={session} identityOnly={identityOnly}
        candidatePreparationEnabled={candidatePreparationEnabled}
        candidateLifecycleEnabled={candidateLifecycleEnabled} onLocalGuest={onLocalGuest} />;
}

/**
 * The public application shares one session observer with its React runtime.
 * An isolated entry is still available for consent testing, but the live
 * identity-only path never starts a second probe or imports Firebase Auth.
 */
export function KindeAccountEntry(props: EntryProps) {
    const shared = useSharedKindeAccountSession();
    if (shared && props.identityOnly && !props.guestArchivePresent) {
        return <KindeAccountEntryView session={shared} identityOnly onLocalGuest={props.onLocalGuest} />;
    }
    return <StandaloneKindeAccountEntry {...props} />;
}
