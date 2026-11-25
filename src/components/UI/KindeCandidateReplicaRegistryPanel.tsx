import { useEffect, useRef, useState } from 'react';
import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import type { CloudReplicaControlSnapshot } from '../../lib/sync/cloudReplicaTransport';
import type { CandidateReplicaRetirementWitness } from '../../lib/sync/kindeCandidateReplicaRetirementBridge';
import './kinde-replica-registry.css';

type Session = ReturnType<typeof useKindeAccountSession>;
type State = { kind: 'idle' | 'loading' | 'unavailable' }
    | { kind: 'observed'; control: CloudReplicaControlSnapshot };

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

    const entries = state.kind === 'observed'
        ? Object.entries(state.control.replicas).sort(([a], [b]) => a.localeCompare(b)) : [];
    const active = entries.filter(([, entry]) => entry.status === 'active').length;
    const disabled = session.busy || state.kind === 'loading' || maintenance === 'working';

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
