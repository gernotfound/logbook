import { useEffect, useRef, useState } from 'react';
import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import type { CloudReplicaControlSnapshot } from '../../lib/sync/cloudReplicaTransport';
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
    const mounted = useRef(false);
    const running = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const inspect = () => {
        if (running.current || session.busy) return;
        running.current = true;
        setState({ kind: 'loading' });
        void session.inspectCandidateReplicas().then(observed => {
            if (mounted.current) setState({ kind: 'observed', control: observed.control });
        }).catch(() => {
            if (mounted.current) setState({ kind: 'unavailable' });
        }).finally(() => { running.current = false; });
    };

    const entries = state.kind === 'observed'
        ? Object.entries(state.control.replicas).sort(([a], [b]) => a.localeCompare(b)) : [];
    const active = entries.filter(([, entry]) => entry.status === 'active').length;

    return (
        <section className="kinde-replica-registry" aria-label="Registro repliche account">
            <h2>Registrazioni di sincronizzazione</h2>
            <p>Puoi controllare le repliche associate all’account anche prima di registrare questo dispositivo. Una replica non identifica con certezza un telefono o un computer.</p>
            <button type="button" className="btn" onClick={inspect}
                disabled={session.busy || state.kind === 'loading'}>
                {state.kind === 'loading' ? 'Verifica in corso…' : 'Consulta il registro'}
            </button>
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
                                    <details>
                                        <summary className="disclosure-summary">Identificativo tecnico e sequenza</summary>
                                        <code>{entry.replicaId}</code>
                                        <span>Sequenza confermata: {entry.lastSeq}</span>
                                    </details>
                                </li>
                            ))}
                        </ol>}
                    <p>Lo stato del registro non dimostra che un dispositivo sia online o che tutte le modifiche offline siano state inviate. Prima di ritirare una replica occorre verificare le copie locali e confermare esplicitamente il rischio: questa schermata è di sola consultazione.</p>
                </div>
            )}
        </section>
    );
}
