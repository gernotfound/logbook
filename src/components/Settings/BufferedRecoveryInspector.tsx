import { useEffect, useState, useSyncExternalStore } from 'react';
import { FileSearch } from 'lucide-react';
import { inspectBufferedRecoveryEvidence, type BufferedRecoveryEntry } from '../../lib/sync/bufferedDraftWriterIntent';
import { captureSession, isActiveGuestSession, isCurrentSession, type SessionSnapshot } from '../../lib/sync/session';
import { currentHealthConsentStatus, getGuestHealthConsentStatus, subscribeHealthConsent } from '../../lib/healthConsent';
import { useAppStore } from '../../store/useAppStore';

type Inspection = { session: SessionSnapshot; entries: BufferedRecoveryEntry[] };

function consentAllowed(): boolean {
    try {
        const session = captureSession();
        return session.owner === 'guest'
            ? isActiveGuestSession() && getGuestHealthConsentStatus() === 'active'
            : currentHealthConsentStatus(session.owner.slice(5)) === 'active';
    } catch {
        return false;
    }
}

const provenanceLabel: Record<BufferedRecoveryEntry['provenance'], string> = {
    current: 'Revisione di consenso corrente',
    previous: 'Revisione precedente: non riapplicare automaticamente',
    unknown: 'Revisione non verificabile: non riapplicare automaticamente',
    guest: 'Copia della sessione ospite',
};

/** A diagnostics-only view. No storage writes, replay or conflict resolution. */
export function BufferedRecoveryInspector() {
    const dataOwner = useAppStore(state => state.dataOwner);
    const allowed = useSyncExternalStore(subscribeHealthConsent, consentAllowed, () => false);
    const [inspection, setInspection] = useState<Inspection | null>(null);
    const [error, setError] = useState<string | null>(null);
    const shown = (() => {
        try {
            return inspection && allowed && isCurrentSession(inspection.session)
                && (!dataOwner || dataOwner === inspection.session.owner) ? inspection : null;
        } catch {
            return null;
        }
    })();

    useEffect(() => {
        // State changes from auth/consent are handled as events rather than
        // synchronously mirroring props into state during a React effect.
        const hide = () => { setInspection(null); setError(null); };
        const unsubscribeOwner = useAppStore.subscribe((next, previous) => {
            if (next.dataOwner !== previous.dataOwner) hide();
        });
        const unsubscribeConsent = subscribeHealthConsent(hide);
        return () => { unsubscribeOwner(); unsubscribeConsent(); };
    }, []);
    useEffect(() => {
        const hide = () => { setInspection(null); setError(null); };
        document.addEventListener('visibilitychange', hide);
        window.addEventListener('storage', hide);
        return () => {
            document.removeEventListener('visibilitychange', hide);
            window.removeEventListener('storage', hide);
        };
    }, []);

    const inspect = () => {
        setInspection(null);
        setError(null);
        try {
            const session = captureSession();
            if (!consentAllowed() || (dataOwner && dataOwner !== session.owner)) {
                throw new Error('Sessione o consenso non verificati: anteprima non disponibile.');
            }
            const entries = inspectBufferedRecoveryEvidence(session.owner);
            if (!isCurrentSession(session) || !consentAllowed()) {
                throw new Error('Sessione o consenso cambiati durante la verifica.');
            }
            setInspection({ session, entries });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Anteprima di recupero non disponibile.');
        }
    };
    const groups = new Map<string, BufferedRecoveryEntry[]>();
    if (shown) for (const entry of shown.entries) {
        const list = groups.get(entry.draftName) ?? [];
        list.push(entry);
        groups.set(entry.draftName, list);
    }

    return (
        <div className="settings-detail-card">
            <h2><FileSearch size={20} aria-hidden="true" /> Esamina bozze di recupero</h2>
            <p className="settings-help">Puoi leggere le copie conservate quando più schede modificano lo stesso campo. Questa funzione non sceglie, modifica, elimina o sincronizza nulla.</p>
            <p className="settings-help settings-warning">Il testo può contenere dati sulla salute. Conserva il Backup JSON originale in un luogo protetto prima di tentare altri recuperi.</p>
            <div className="settings-actions">
                <button type="button" className="btn" onClick={inspect} disabled={!allowed}>
                    <FileSearch size={18} aria-hidden="true" /> Esamina copie sul dispositivo
                </button>
                {shown && (
                    <button type="button" className="btn" onClick={() => setInspection(null)}>Nascondi copie</button>
                )}
            </div>
            {error && <p role="alert" className="settings-help settings-warning settings-recovery-message">{error} Nessun dato è stato modificato.</p>}
            {shown && (
                <div className="settings-recovery-list" role="region" aria-label="Copie di recupero">
                    {groups.size === 0
                        ? <p role="status" className="settings-help settings-help-last">Nessuna testimonianza indipendente disponibile. Le altre bozze non vengono esaminate qui.</p>
                        : <>
                            <p className="settings-help">{shown.entries.length} copie conservate in {groups.size} campi. I nomi tecnici non provano l'appartenenza all'allenamento corrente.</p>
                            {[...groups].map(([draftName, entries]) => (
                                <details key={draftName} className="settings-recovery-group">
                                    <summary>{draftName} — {entries.length} {entries.length === 1 ? 'copia' : 'copie'}</summary>
                                    {entries.map((entry, index) => (
                                        <div key={entry.name} className="settings-recovery-entry">
                                            <p className="settings-help settings-help-last">Copia {index + 1}: {provenanceLabel[entry.provenance]}</p>
                                            <textarea readOnly rows={3} value={entry.value}
                                                aria-label={`Testo copia ${index + 1} del campo ${draftName}`} />
                                        </div>
                                    ))}
                                </details>
                            ))}
                        </>
                    }
                </div>
            )}
        </div>
    );
}
