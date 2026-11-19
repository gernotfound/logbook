import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';

type Session = ReturnType<typeof useKindeAccountSession>;
type Prepared = Awaited<ReturnType<Session['prepareCandidateBackup']>>;

/**
 * Isolated candidate UI: a verified data file is made available as a real
 * anchor only after the asynchronous source checks have completed. This
 * component never initiates revocation, erasure, sync or account activation.
 */
export function KindeCandidateBackupPanel({ session }: { session: Session }) {
    const [phase, setPhase] = useState<'idle' | 'working' | 'ready' | 'error'>('idle');
    const [prepared, setPrepared] = useState<Prepared | null>(null);
    const currentFile = useRef<Prepared | null>(null);
    const running = useRef(false);
    const mounted = useRef(false);

    const discard = () => {
        currentFile.current?.dispose();
        currentFile.current = null;
        setPrepared(null);
    };
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            currentFile.current?.dispose();
            currentFile.current = null;
        };
    }, []);

    const prepare = () => {
        if (running.current || session.busy) return;
        running.current = true;
        discard();
        setPhase('working');
        void session.prepareCandidateBackup().then(result => {
            if (!mounted.current || !result.isCurrent()) {
                result.dispose();
                if (mounted.current) setPhase('error');
                return;
            }
            currentFile.current = result;
            setPrepared(result);
            setPhase('ready');
        }).catch(() => {
            if (mounted.current) setPhase('error');
        }).finally(() => { running.current = false; });
    };

    const download = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!prepared || currentFile.current !== prepared
            || !prepared.isCurrent() || session.busy) {
            event.preventDefault();
            discard();
            setPhase('error');
        }
        // Browsers decide whether a download was saved: never show success
        // merely because a link was clicked.
    };

    return (
        <section aria-label="Backup account prima della revoca">
            <p>Prima di revocare il consenso, puoi preparare una copia JSON dei dati
                verificabili del cloud e di questo dispositivo. Il file contiene
                dati sanitari leggibili: conservalo in un luogo riservato.</p>
            <p>Se le copie non sono coerenti, non verrà creato alcun backup
                completo. Il download è facoltativo e non revoca il consenso.</p>
            <button type="button" className="btn" disabled={session.busy || phase === 'working'}
                onClick={prepare}>
                {phase === 'working' ? 'Verifica dei dati in corso…' : 'Prepara backup JSON'}
            </button>
            {phase === 'ready' && prepared && (
                <div>
                    <p role="status">File preparato. Il salvataggio sul dispositivo deve
                        essere avviato dal pulsante seguente.</p>
                    <a className="btn btn-primary" href={prepared.url} download={prepared.filename}
                        onClick={download}>Scarica backup JSON</a>
                    <button type="button" className="btn" onClick={() => { discard(); setPhase('idle'); }}>
                        Scarta il file temporaneo
                    </button>
                </div>
            )}
            {phase === 'error' && (
                <p role="alert">Backup non disponibile o sessione cambiata.
                    Nessun dato è stato modificato. Verifica l’archivio e riprova.</p>
            )}
        </section>
    );
}
