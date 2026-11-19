import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';

type Session = ReturnType<typeof useKindeAccountSession>;
type Outcome = Awaited<ReturnType<Session['restoreCandidateBackup']>>['kind'];
type Phase = 'idle' | 'working' | 'error' | Outcome;
const STREAMING_THRESHOLD = 64 * 1024 * 1024;

/**
 * Candidate-only browser file entry. Parsing is local, with a streaming
 * reader above 64 MiB; the trusted restore adapter validates schema, owner,
 * consent and current D1 state before mutating an encrypted archive.
 * A response lost after the local commit must never be reported as failure
 * without warning about a potentially pending journal.
 */
export function KindeCandidateRestorePanel({ session }: { session: Session }) {
    const inputId = useId();
    const [file, setFile] = useState<File | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [pendingCount, setPendingCount] = useState(0);
    const selected = useRef<File | null>(null);
    const running = useRef(false);
    const mounted = useRef(false);
    const generation = useRef(0);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            generation.current += 1;
            selected.current = null;
        };
    }, []);

    const choose = (event: ChangeEvent<HTMLInputElement>) => {
        if (running.current) return;
        const next = event.target.files?.[0] ?? null;
        generation.current += 1;
        selected.current = next;
        setFile(next);
        setConfirmed(false);
        setPendingCount(0);
        setPhase('idle');
    };

    const restore = () => {
        const input = selected.current;
        if (!input || file !== input || !confirmed || running.current || session.busy) return;
        const token = ++generation.current;
        const current = () => mounted.current && generation.current === token
            && selected.current === input;
        const assertCurrent = () => {
            if (!current()) throw new Error('Selezione del backup non più attuale.');
        };
        running.current = true;
        setPhase('working');
        void (async () => {
            if (input.size === 0) throw new Error('Backup vuoto.');
            const backup = input.size <= STREAMING_THRESHOLD
                ? JSON.parse(await input.text()) as unknown
                : await (await import('../../lib/streamJsonImport')).parseLargeBackupJson(input, assertCurrent);
            assertCurrent();
            return session.restoreCandidateBackup(backup);
        })().then(result => {
            if (!current()) return;
            setPhase(result.kind);
            setPendingCount(result.kind === 'local-pending' ? result.pendingCount : 0);
        }).catch(() => {
            if (current()) setPhase('error');
        }).finally(() => { running.current = false; });
    };

    const blocked = phase === 'working' || session.busy;
    return (
        <section aria-label="Ripristino backup account Kinde">
            <h2>Ripristina backup account</h2>
            <p>Seleziona un backup JSON completo del tuo account. Il file può
                contenere dati sanitari in chiaro: viene letto in questo browser
                e non è caricato come file sul server.</p>
            <p>Il ripristino può sostituire i dati business dell’account e
                sincronizzarli come modifiche cifrate. Non trasferisce il consenso,
                le sessioni o le bozze del vecchio dispositivo. Conserva il file
                originale finché non avrai verificato il risultato.</p>
            <label htmlFor={inputId}>File backup JSON</label>
            <input id={inputId} type="file" accept=".json,application/json"
                disabled={blocked} onChange={choose} />
            <label>
                <input type="checkbox" checked={confirmed}
                    disabled={blocked || !file}
                    onChange={event => setConfirmed(event.target.checked)} />
                Confermo di voler ripristinare questo backup nell’account attuale,
                sapendo che potrebbe sostituire modifiche successive.
            </label>
            <button type="button" className="btn btn-primary"
                disabled={blocked || !file || !confirmed} onClick={restore}>
                {phase === 'working' ? 'Ripristino in corso…' : 'Avvia ripristino'}
            </button>
            {phase === 'cloud-acknowledged' && (
                <p role="status">Ripristino confermato dal server e journal locale senza operazioni in attesa.</p>
            )}
            {phase === 'already-current' && (
                <p role="status">Il backup corrisponde già ai dati verificati: nessuna modifica necessaria.</p>
            )}
            {phase === 'local-metadata-restored' && (
                <p role="status">Ripristinati soltanto i metadati locali cifrati. Nessuna nuova ricevuta cloud.</p>
            )}
            {phase === 'local-pending' && (
                <p role="status">Ripristino salvato localmente, ma conferma cloud ancora in attesa
                    ({pendingCount} operazioni). Conserva il file e riconcilia prima di considerarlo completato.</p>
            )}
            {phase === 'error' && (
                <p role="alert">Ripristino non confermato. Potrebbero esistere modifiche cifrate
                    già salvate localmente in attesa di riconciliazione. Conserva il backup originale;
                    non cancellare dati né considerare completata la sincronizzazione.</p>
            )}
        </section>
    );
}
