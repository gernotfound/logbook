import { useEffect, useRef, useState } from 'react';
import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import type { CloudReplicaControlSnapshot } from '../../lib/sync/cloudReplicaTransport';
import type { CandidateReplicaRetirementWitness } from '../../lib/sync/kindeCandidateReplicaRetirementBridge';
import type { CandidatePendingReplicaMutation } from '../../lib/sync/kindeCandidateReplicaCancellationBridge';
import './kinde-replica-registry.css';

type Session = ReturnType<typeof useKindeAccountSession>;
type State = { kind: 'idle' | 'loading' | 'unavailable' }
    | { kind: 'observed'; control: CloudReplicaControlSnapshot };
type PendingState = { kind: 'idle' | 'loading' | 'none' | 'unavailable' }
    | { kind: 'observed'; mutation: CandidatePendingReplicaMutation };
type OfflineState = { kind: 'idle' | 'loading' | 'unavailable' }
    | { kind: 'observed'; result: Awaited<ReturnType<Session['inspectCandidateOfflineReplicaJournal']>> };

function dateText(milliseconds: number): string {
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? 'Data non rappresentabile'
        : new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Candidate-only read surface: never infers a physical device from a slot. */
export function KindeCandidateReplicaRegistryPanel({ session }: { session: Session }) {
    const [state, setState] = useState<State>({ kind: 'idle' });
    const [selected, setSelected] = useState<CandidateReplicaRetirementWitness | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [maintenance, setMaintenance] = useState<'idle' | 'working' | 'retired' | 'pending' | 'none' | 'unknown'>('idle');
    const [pendingState, setPendingState] = useState<PendingState>({ kind: 'idle' });
    const [cancelConfirmed, setCancelConfirmed] = useState(false);
    const [cancelOutcome, setCancelOutcome] = useState<'idle' | 'working' | 'cancelled' | 'committed' | 'pending' | 'unknown'>('idle');
    const [offlineState, setOfflineState] = useState<OfflineState>({ kind: 'idle' });
    const mounted = useRef(false);
    const running = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const inspect = () => {
        if (running.current || session.busy) return;
        running.current = true;
        setSelected(null);
        setConfirmed(false);
        setMaintenance('idle');
        setPendingState({ kind: 'idle' });
        setCancelConfirmed(false);
        setCancelOutcome('idle');
        setOfflineState({ kind: 'idle' });
        setState({ kind: 'loading' });
        void session.inspectCandidateReplicas().then(observed => {
            if (mounted.current) setState({ kind: 'observed', control: observed.control });
        }).catch(() => {
            if (mounted.current) setState({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const manage = (witness?: CandidateReplicaRetirementWitness) => {
        if (running.current || session.busy || (witness && !confirmed)) return;
        running.current = true;
        setMaintenance('working');
        setPendingState({ kind: 'idle' });
        setCancelConfirmed(false);
        setCancelOutcome('idle');
        setOfflineState({ kind: 'idle' });
        void session.manageCandidateReplicaRetirement(witness).then(outcome => {
            if (!mounted.current) return;
            // The previously observed registry is no longer an authorization
            // for a second retirement, even if the first response was lost.
            setState({ kind: 'idle' });
            setSelected(null);
            setConfirmed(false);
            setMaintenance(outcome === 'retired' || outcome === 'superseded' ? 'retired'
                : outcome === 'idle' ? 'none' : 'pending');
        }).catch(() => {
            if (!mounted.current) return;
            setState({ kind: 'idle' });
            setSelected(null);
            setConfirmed(false);
            setMaintenance('unknown');
        }).finally(() => { running.current = false; });
    };

    const inspectPending = () => {
        if (running.current || session.busy) return;
        running.current = true;
        setState({ kind: 'idle' });
        setSelected(null);
        setConfirmed(false);
        setMaintenance('idle');
        setCancelConfirmed(false);
        setCancelOutcome('idle');
        setOfflineState({ kind: 'idle' });
        setPendingState({ kind: 'loading' });
        void session.manageCandidateReplicaCancellation().then(mutation => {
            if (mounted.current) setPendingState(mutation ? { kind: 'observed', mutation } : { kind: 'none' });
        }).catch(() => {
            if (mounted.current) setPendingState({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const cancelPending = () => {
        if (running.current || session.busy || pendingState.kind !== 'observed' || !cancelConfirmed) return;
        running.current = true;
        setPendingState({ kind: 'idle' });
        setCancelConfirmed(false);
        setCancelOutcome('working');
        void session.manageCandidateReplicaCancellation(pendingState.mutation.mutationId).then(outcome => {
            if (mounted.current) setCancelOutcome(outcome === 'cancelled' ? 'cancelled'
                : outcome === 'committed' ? 'committed' : 'pending');
        }).catch(() => {
            if (mounted.current) setCancelOutcome('unknown');
        }).finally(() => { running.current = false; });
    };

    const inspectOffline = () => {
        if (running.current || session.busy) return;
        running.current = true;
        setState({ kind: 'idle' });
        setPendingState({ kind: 'idle' });
        setSelected(null);
        setConfirmed(false);
        setMaintenance('idle');
        setCancelConfirmed(false);
        setCancelOutcome('idle');
        setOfflineState({ kind: 'loading' });
        void session.inspectCandidateOfflineReplicaJournal().then(result => {
            if (mounted.current) setOfflineState({ kind: 'observed', result });
        }).catch(() => {
            if (mounted.current) setOfflineState({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const entries = state.kind === 'observed'
        ? Object.entries(state.control.replicas).sort(([a], [b]) => a.localeCompare(b)) : [];
    const active = entries.filter(([, entry]) => entry.status === 'active').length;
    const disabled = session.busy || state.kind === 'loading' || pendingState.kind === 'loading'
        || offlineState.kind === 'loading'
        || maintenance === 'working' || cancelOutcome === 'working';

    return (
        <section className="kinde-replica-registry" aria-label="Registro repliche account">
            <h2>Registrazioni di sincronizzazione</h2>
            <p>Puoi controllare le repliche associate all’account anche prima di registrare questo dispositivo. Una replica non identifica con certezza un telefono o un computer.</p>
            <button type="button" className="btn" onClick={inspect}
                disabled={disabled}>
                {state.kind === 'loading' ? 'Verifica in corso…' : 'Consulta il registro'}
            </button>
            <button type="button" className="btn" onClick={() => manage()}
                disabled={disabled}>
                Verifica una richiesta di ritiro in sospeso
            </button>
            <button type="button" className="btn" onClick={inspectPending} disabled={disabled}>
                {pendingState.kind === 'loading' ? 'Verifica richiesta locale…' : 'Esamina una richiesta da annullare'}
            </button>
            <button type="button" className="btn" onClick={inspectOffline} disabled={disabled}>
                {offlineState.kind === 'loading' ? 'Controllo modifiche offline…' : 'Controlla modifiche offline su questo dispositivo'}
            </button>
            {offlineState.kind === 'loading' && <p role="status">Verifica dell’archivio cifrato in corso, senza sincronizzare o modificare i dati…</p>}
            {offlineState.kind === 'unavailable' && <p role="alert">Non è possibile verificare il journal locale con questa sessione e questo archivio. Nessuna operazione è stata eseguita: non cancellare i dati del dispositivo.</p>}
            {offlineState.kind === 'observed' && <div className="kinde-replica-registry__confirmation">
                {offlineState.result.kind === 'no-pending' && <p role="status">Nessuna operazione nel journal di sincronizzazione di questo archivio al momento della verifica. Questo non verifica eventuali bozze device o altri dispositivi offline.</p>}
                {offlineState.result.kind === 'transition-pending' && <p role="alert">Esiste una transizione di sincronizzazione da riconciliare prima di valutare il recupero. Operazioni nel journal: {offlineState.result.pendingOperations}. Usa la verifica della richiesta in sospeso; nessun dato è stato scartato.</p>}
                {offlineState.result.kind === 'first-claim-pending' && <p role="status">Questo archivio conserva {offlineState.result.pendingOperations} operazioni locali e non ha ancora una replica assegnata. Non è un rientro di replica ritirata; non è stata effettuata alcuna registrazione.</p>}
                {offlineState.result.kind === 'active-pending' && <p role="status">La replica {offlineState.result.slot} (generazione {offlineState.result.generation}) risultava attiva nel registro verificato. Restano {offlineState.result.pendingOperations} operazioni locali non confermate: questa osservazione non è un ACK né autorizza il replay senza i controlli ordinari.</p>}
                {offlineState.result.kind === 'retired-pending' && <p role="alert"><strong>Recupero necessario:</strong> {offlineState.result.pendingOperations} operazioni restano nel journal locale senza ACK verificato della replica {offlineState.result.slot} (generazione {offlineState.result.generation}). La sua registrazione non è più utilizzabile ({offlineState.result.reason === 'retired' ? 'ritirata' : offlineState.result.reason === 'replaced' ? 'sostituita' : offlineState.result.reason === 'expired' ? 'scaduta' : 'non presente nel registro'}). Non eliminare l’archivio e non tentare di riattribuire automaticamente le modifiche: la riconciliazione causale è ancora da completare.</p>}
                <p>Questa è una verifica di sola lettura, non un recupero: il cloud può evolvere successivamente. Le modifiche e le bozze del dispositivo non sono state cancellate.</p>
            </div>}
            {pendingState.kind === 'loading' && <p role="status">Lettura della richiesta cifrata in corso…</p>}
            {pendingState.kind === 'none' && <p role="status">Nessuna richiesta di registrazione o ritiro in sospeso in questo archivio.</p>}
            {pendingState.kind === 'unavailable' && <p role="alert">Impossibile verificare una richiesta locale: nessun annullamento eseguito.</p>}
            {pendingState.kind === 'observed' && <div className="kinde-replica-registry__confirmation">
                <p><strong>Richiesta cifrata da verificare:</strong> {pendingState.mutation.kind === 'claim' ? 'registrazione della replica' : 'ritiro della replica'}.
                    {pendingState.mutation.slot !== null && <> Replica {pendingState.mutation.slot}, generazione {pendingState.mutation.generation}.</>}
                    {' '}Riferimento operazione: <code>{pendingState.mutation.mutationId}</code>.</p>
                {pendingState.mutation.cancellationRequested && <p role="alert">Annullamento già richiesto: occorre riconciliare la stessa richiesta con il server.</p>}
                <p>L’annullamento non elimina dati o modifiche locali. Se il server ha già eseguito la richiesta, non può annullarne retroattivamente gli effetti; servirà un recupero separato. Una risposta persa non prova l’annullamento.</p>
                <label><input type="checkbox" disabled={disabled} checked={cancelConfirmed}
                    onChange={event => setCancelConfirmed(event.target.checked)} /> Confermo di voler annullare proprio questa richiesta dopo averne letto il riferimento.</label>
                <button className="btn btn-primary" type="button" disabled={disabled || !cancelConfirmed}
                    onClick={cancelPending}>Conferma annullamento richiesta</button>
                <button className="btn" type="button" disabled={disabled}
                    onClick={() => { setPendingState({ kind: 'idle' }); setCancelConfirmed(false); }}>Torna senza modifiche</button>
            </div>}
            {cancelOutcome === 'working' && <p role="status">Annullamento e controllo della revisione server in corso…</p>}
            {cancelOutcome === 'cancelled' && <p role="status">Il server ha provato che la richiesta non è stata eseguita e l’annullamento è stato riconciliato. Il journal locale non è stato cancellato.</p>}
            {cancelOutcome === 'committed' && <p role="alert">La richiesta originale risulta già eseguita: l’annullamento non la ripristina. Procedi con il recupero della registrazione o del ritiro, senza crearne un’altra.</p>}
            {cancelOutcome === 'pending' && <p role="alert">Annullamento non ancora riconciliato. La decisione e la richiesta originali rimangono sigillate; esamina di nuovo la stessa richiesta.</p>}
            {cancelOutcome === 'unknown' && <p role="alert">Esito dell’annullamento sconosciuto. Non presumere successo: riesamina la richiesta locale prima di altre operazioni.</p>}
            {maintenance === 'working' && <p role="status">Verifica del ritiro e delle ricevute in corso…</p>}
            {maintenance === 'retired' && <p role="status">Il ritiro è stato verificato sul registro. Consulta nuovamente il registro prima di altre operazioni; gli eventuali dati rimasti offline sull’altra replica non sono stati recuperati.</p>}
            {maintenance === 'none' && <p role="status">Nessuna richiesta di ritiro cifrata in sospeso in questo archivio locale.</p>}
            {maintenance === 'pending' && <p role="alert">Ritiro ancora da riconciliare: l’operazione e il journal locale sono conservati. Non ripetere la selezione; usa la verifica della richiesta in sospeso.</p>}
            {maintenance === 'unknown' && <p role="alert">Esito del ritiro non verificabile. La richiesta potrebbe essere già stata salvata o inviata: controlla la richiesta in sospeso prima di scegliere un’altra replica.</p>}
            {state.kind === 'loading' && <p role="status">Lettura del registro in corso…</p>}
            {state.kind === 'unavailable' && <p role="alert">Registro non verificabile in questa sessione. Nessuna replica o dato locale è stato modificato.</p>}
            {state.kind === 'observed' && (
                <div>
                    <p role="status">{active} {active === 1 ? 'replica contrassegnata attiva' : 'repliche contrassegnate attive'} nel registro, su {entries.length} {entries.length === 1 ? 'registrazione' : 'registrazioni'}.</p>
                    {entries.length === 0
                        ? <p>Il registro verificato non contiene ancora repliche.</p>
                        : <ol className="kinde-replica-registry__list">
                            {entries.map(([slot, entry]) => (
                                <li key={slot + ':' + entry.generation}>
                                    <strong>Replica {slot} · generazione {entry.generation}</strong>
                                    <span>Stato nel registro: {entry.status === 'active' ? 'attiva' : 'ritirata'}</span>
                                    <span>Ultimo checkpoint: {dateText(entry.checkpointAtMs)}</span>
                                    <span>Scadenza registrata: {dateText(entry.leaseUntilMs)}</span>
                                    {entry.status === 'active' && <button className="btn" type="button"
                                        disabled={disabled}
                                        onClick={() => {
                                            setSelected({ slot, replicaId: entry.replicaId, generation: entry.generation,
                                                lastSeq: entry.lastSeq, checkpointAtMs: entry.checkpointAtMs,
                                                leaseUntilMs: entry.leaseUntilMs });
                                            setConfirmed(false);
                                        }}>Prepara ritiro replica {slot}</button>}
                                    {selected?.slot === slot && selected.replicaId === entry.replicaId
                                        && selected.generation === entry.generation && <div className="kinde-replica-registry__confirmation">
                                            <p><strong>Attenzione:</strong> ritirare la replica {slot} può impedire di recuperare modifiche rimaste soltanto offline su quel dispositivo. Non è un logout, una cancellazione dell’account o una prova che il dispositivo sia online. Verifica prima le copie locali.</p>
                                            <label><input type="checkbox" checked={confirmed}
                                                disabled={disabled}
                                                onChange={event => setConfirmed(event.target.checked)} /> Confermo di voler ritirare questa replica tecnica e di accettare il rischio di perdita delle modifiche offline non sincronizzate.</label>
                                            <button className="btn btn-primary" type="button"
                                                disabled={!confirmed || disabled}
                                                onClick={() => manage(selected)}>Conferma ritiro replica {slot}</button>
                                            <button className="btn" type="button"
                                                disabled={disabled}
                                                onClick={() => { setSelected(null); setConfirmed(false); }}>Annulla selezione</button>
                                        </div>}
                                    <details>
                                        <summary className="disclosure-summary">Identificativo tecnico e sequenza</summary>
                                        <code>{entry.replicaId}</code>
                                        <span>Sequenza confermata: {entry.lastSeq}</span>
                                    </details>
                                </li>
                            ))}
                        </ol>}
                    <p>Lo stato del registro non dimostra che un dispositivo sia online o che tutte le modifiche offline siano state inviate. Il ritiro è disponibile solo in questo percorso candidato isolato; richiede conferma e prova remota, senza cancellare il journal locale.</p>
                </div>
            )}
        </section>
    );
}
