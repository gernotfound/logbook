import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { KindeCandidatePreparedJson } from '../../lib/auth/kindeCandidatePreparedJson';

type Props = {
    label: string;
    prepareLabel: string;
    downloadLabel: string;
    errorMessage: string;
    sessionBusy: boolean;
    active?: boolean;
    prepareFile: () => Promise<KindeCandidatePreparedJson>;
    children: ReactNode;
};

/**
 * A temporary plaintext Blob URL belongs to one React incarnation. Network
 * preparation is never followed by a synthetic click: the actual download
 * requires a new browser gesture and checks the same session fence.
 */
export function KindeCandidateJsonPanel({
    label, prepareLabel, downloadLabel, errorMessage, sessionBusy,
    active = true, prepareFile, children,
}: Props) {
    const [phase, setPhase] = useState<'idle' | 'working' | 'ready' | 'error'>('idle');
    const [prepared, setPrepared] = useState<KindeCandidatePreparedJson | null>(null);
    const currentFile = useRef<KindeCandidatePreparedJson | null>(null);
    const running = useRef(false);
    const mounted = useRef(false);
    const activeRef = useRef(active);

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

    useEffect(() => {
        activeRef.current = active;
        if (!active) {
            discard();
            setPhase('idle');
        }
    }, [active]);

    const prepare = () => {
        if (running.current || sessionBusy || !activeRef.current) return;
        running.current = true;
        discard();
        setPhase('working');
        void prepareFile().then(file => {
            if (!mounted.current || !activeRef.current || !file.isCurrent()) {
                file.dispose();
                if (mounted.current && activeRef.current) setPhase('error');
                return;
            }
            currentFile.current = file;
            setPrepared(file);
            setPhase('ready');
        }).catch(() => {
            if (mounted.current && activeRef.current) setPhase('error');
        }).finally(() => { running.current = false; });
    };

    const download = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!prepared || currentFile.current !== prepared
            || !activeRef.current || !prepared.isCurrent() || sessionBusy) {
            event.preventDefault();
            discard();
            setPhase('error');
        }
        // A successful click cannot attest that Safari or the operating
        // system saved a readable file.
    };

    return (
        <section aria-label={label}>
            {children}
            <button type="button" className="btn"
                disabled={!active || sessionBusy || phase === 'working'}
                onClick={prepare}>
                {phase === 'working' ? 'Verifica dei dati in corso…' : prepareLabel}
            </button>
            {active && phase === 'ready' && prepared && (
                <div>
                    <p role="status">File preparato. Il salvataggio sul dispositivo deve
                        essere avviato dal pulsante seguente.</p>
                    <a className="btn btn-primary" href={prepared.url}
                        download={prepared.filename} onClick={download}>{downloadLabel}</a>
                    <button type="button" className="btn"
                        onClick={() => { discard(); setPhase('idle'); }}>
                        Scarta il file temporaneo
                    </button>
                </div>
            )}
            {active && phase === 'error' && <p role="alert">{errorMessage}</p>}
        </section>
    );
}
