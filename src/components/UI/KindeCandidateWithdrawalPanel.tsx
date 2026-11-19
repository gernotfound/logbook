import { useEffect, useRef, useState } from 'react';
import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import {
    readKindeCandidateWithdrawalMarker, type KindeCandidateWithdrawalMarker,
} from '../../lib/auth/kindeCandidateWithdrawal';
import { KindeCandidateBackupPanel } from './KindeCandidateBackupPanel';

type Session = ReturnType<typeof useKindeAccountSession>;
type Phase = 'idle' | 'working' | 'pending' | 'confirmed' | 'error';

/**
 * The optional backup is offered before an irreversible consent decision.
 * Once the owner-scoped marker appears, an ambiguous HTTP result can ONLY
 * be reconciled by read-only server evidence; this UI never retries withdraw.
 */
export function KindeCandidateWithdrawalPanel({ session, allowBackup = true }: {
    session: Session; allowBackup?: boolean;
}) {
    const uid = 'principal' in session.view ? session.view.principal.uid : '';
    const [marker, setMarker] = useState<KindeCandidateWithdrawalMarker>(
        () => readKindeCandidateWithdrawalMarker(uid),
    );
    const [confirmedErasure, setConfirmedErasure] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const busy = useRef(false);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        const observe = () => setMarker(readKindeCandidateWithdrawalMarker(uid));
        observe();
        window.addEventListener('storage', observe);
        window.addEventListener('focus', observe);
        return () => {
            mounted.current = false;
            window.removeEventListener('storage', observe);
            window.removeEventListener('focus', observe);
        };
    }, [uid]);

    const tryWithdraw = () => {
        if (busy.current || session.busy || marker !== 'none' || !confirmedErasure) return;
        busy.current = true;
        setPhase('working');
        void session.withdrawCandidateConsent(true).then(() => {
            if (mounted.current) {
                setMarker(readKindeCandidateWithdrawalMarker(uid));
                setPhase('confirmed');
            }
        }).catch(() => {
            if (!mounted.current) return;
            const observed = readKindeCandidateWithdrawalMarker(uid);
            setMarker(observed);
            setPhase(observed === 'pending' || observed === 'withdrawn' ? 'pending' : 'error');
        }).finally(() => { busy.current = false; });
    };

    const reconcile = () => {
        if (busy.current || session.busy || (marker !== 'pending' && marker !== 'withdrawn')) return;
        busy.current = true;
        setPhase('working');
        void session.reconcileCandidateWithdrawal().then(proof => {
            if (!mounted.current) return;
            setMarker(readKindeCandidateWithdrawalMarker(uid));
            setPhase(proof.kind === 'withdrawal-proven' ? 'confirmed' : 'pending');
        }).catch(() => {
            if (!mounted.current) return;
            setMarker(readKindeCandidateWithdrawalMarker(uid));
            setPhase('pending');
        }).finally(() => { busy.current = false; });
    };

    const canOfferBackup = allowBackup && marker === 'none' && phase !== 'working'
        && phase !== 'pending' && phase !== 'confirmed';
    const inFlight = phase === 'working' || session.busy;
    return (
        <section aria-label="Gestione del consenso sanitario">
            {canOfferBackup && <KindeCandidateBackupPanel session={session} />}
            {!allowBackup && marker === 'none' && (
                <p role="status">Non è possibile preparare il backup completo
                    senza una email verificata. Puoi comunque revocare il
                    consenso; non è necessario verificare nuovamente l’email.</p>
            )}
            <section aria-label="Revoca del consenso sanitario">
                <h2>Revoca del consenso sanitario</h2>
                <p>La revoca sospende le funzioni fitness e avvia la cancellazione
                    dei dati sanitari cloud. Puoi salvare facoltativamente una
                    copia prima di confermare; non è necessario scaricare un
                    backup per esercitare il diritto di revoca.</p>
                <p>Il clic sul download non dimostra che il file sia stato
                    conservato: verifica personalmente la copia, se la desideri,
                    prima di avviare la cancellazione.</p>
                {marker === 'none' && phase !== 'confirmed' && (
                    <>
                        <label>
                            <input type="checkbox" checked={confirmedErasure}
                                disabled={inFlight}
                                onChange={event => setConfirmedErasure(event.target.checked)} />
                            Confermo di voler revocare il consenso e avviare la cancellazione dei dati sanitari cloud.
                        </label>
                        <button type="button" className="btn btn-danger"
                            disabled={!confirmedErasure || inFlight}
                            onClick={tryWithdraw}>
                            Revoca consenso e avvia cancellazione
                        </button>
                    </>
                )}
                {marker === 'invalid' && (
                    <p role="alert">Stato locale della revoca non verificabile.
                        Nessuna nuova richiesta viene autorizzata.</p>
                )}
                {(marker === 'pending' || marker === 'withdrawn') && phase !== 'confirmed' && (
                    <>
                        <p role="status">Revoca in verifica. La risposta può essere
                            andata persa o il job di cancellazione può essere già iniziato.
                            Non invieremo una seconda richiesta di revoca.</p>
                        <button type="button" className="btn"
                            disabled={inFlight} onClick={reconcile}>
                            Verifica stato della revoca
                        </button>
                    </>
                )}
                {phase === 'confirmed' && (
                    <p role="status">Revoca attestata dal server. La cancellazione è
                        stata accodata o avviata: non è confermato che sia completa.</p>
                )}
                {phase === 'error' && marker === 'none' && (
                    <p role="alert">Non è stato possibile avviare la revoca.
                        La richiesta non è stata confermata. Verifica la sessione.</p>
                )}
            </section>
        </section>
    );
}
