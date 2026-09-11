import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { readLocal, resolveLocalConflicts, type LocalEnvelope } from '../../lib/sync/localRepository';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { userDataConflictPath } from '../../lib/sync/conflictResolution';
import { Exporter } from '../../lib/export';

const labels: Record<string, string> = { profile: 'Profilo', height: 'Altezza', gender: 'Genere', dob: 'Data di nascita', history: 'Allenamenti', nutrition: 'Nutrizione', library: 'Esercizi', customFoods: 'Alimenti', routines: 'Schede', trainingCycles: 'Cicli', meals: 'Pasti', weight: 'Peso', notes: 'Note', nutritionPlanning: 'Piano nutrizionale', activeWorkout: 'Allenamento attivo', supplements: 'Integratori' };
const display = (value: unknown) => value === undefined ? 'Eliminato' : JSON.stringify(value, null, 2);

export function SyncConflictPanel() {
    const { currentUser, isGuest } = useAuth();
    const owner = isGuest ? 'guest' : currentUser ? 'user:' + currentUser.uid : null;
    const health = useAppStore(state => state.syncHealth);
    const [snapshot, setSnapshot] = useState<LocalEnvelope | null>(null);
    const [open, setOpen] = useState(false);
    const [choices, setChoices] = useState<Array<'local' | 'remote' | undefined>>([]);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    useEffect(() => {
        const session = captureSession();
        let active = true;
        if (!owner || session.owner !== owner) return;
        void readLocal(owner).then(value => {
            if (active && isCurrentSession(session)) setSnapshot(value?.conflicts?.length ? value : null);
        }).catch(error => { if (active && isCurrentSession(session)) setMessage(error instanceof Error ? error.message : 'Archivio non leggibile.'); });
        return () => { active = false; };
    }, [owner, health]);
    if (!snapshot || snapshot.owner !== owner || !snapshot.conflicts?.length) return null;
    const conflicts = snapshot.conflicts;
    const examine = async () => {
        const session = captureSession();
        const latest = await readLocal(session.owner);
        if (!isCurrentSession(session) || !latest?.conflicts?.length) return;
        setSnapshot(latest); setChoices([]); setOpen(true); setMessage(null);
    };
    const apply = async () => {
        if (inFlight.current) return;
        if (conflicts.some((_, index) => !choices[index])) { setMessage('Scegli una versione per ogni differenza.'); return; }
        const session = captureSession();
        inFlight.current = true; setBusy(true);
        try {
            if (!(await useDialogStore.getState().showConfirm('Applicare le versioni selezionate? Le alternative resteranno nel backup di recupero.'))) return;
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata.');
            const saved = await resolveLocalConflicts(session.owner, snapshot.revision, conflicts, choices as Array<'local' | 'remote'>, () => isCurrentSession(session));
            if (!isCurrentSession(session)) return;
            // The journal is already committed. Keep the device workout separate
            // from a chosen cloud snapshot and avoid starting another hydration.
            useAppStore.setState({ userData: saved.data });
            setSnapshot(null); setOpen(false);
            await useAppStore.getState().flushPendingSyncs();
        } catch (error) {
            if (isCurrentSession(session)) setMessage(error instanceof Error ? error.message : 'Risoluzione non riuscita.');
        } finally { inFlight.current = false; setBusy(false); }
    };
    const backup = async () => {
        const session = captureSession();
        try {
            const latest = await readLocal(session.owner);
            if (latest && isCurrentSession(session)) await Exporter.exportBackupJson(latest.data, session.owner === 'guest' ? null : { uid: session.owner.slice(5) }, { scope: 'device', months: latest.completeMonths }, { envelope: latest });
        } catch (error) { if (isCurrentSession(session)) setMessage(error instanceof Error ? error.message : 'Backup non riuscito.'); }
    };
    return <section className="card" aria-label="Modifiche in conflitto" style={{ padding: '16px', marginBottom: '16px' }}>
        <p role="status">{conflicts.length} modifiche richiedono una scelta. Le versioni sono conservate; la sincronizzazione è sospesa.</p>
        {message && <p role="alert">{message}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button className="btn" style={{ minHeight: '44px' }} onClick={() => { void examine().catch(error => setMessage(String(error))); }} disabled={busy}>Riapri confronto</button>
            <button className="btn" style={{ minHeight: '44px' }} onClick={backup} disabled={busy}>Esporta alternative</button>
        </div>
        {open && <>
            <p>“Dispositivo” è la modifica locale; “Altra versione” è il valore incontrato durante il confronto. Controlla ogni differenza.</p>
            {conflicts.map((conflict, index) => <fieldset key={index} style={{ minWidth: 0, marginBottom: '12px' }}>
                <legend>{userDataConflictPath(conflict.path).map(part => labels[part] ?? part).join(' · ')}</legend>
                {(['local', 'remote'] as const).map(choice => <label key={choice} style={{ display: 'block', minHeight: '44px', overflowWrap: 'anywhere' }}>
                    <input type="radio" name={'conflict-' + index} checked={choices[index] === choice} onChange={() => setChoices(previous => { const next = [...previous]; next[index] = choice; return next; })} disabled={busy} />
                    {choice === 'local' ? 'Dispositivo' : 'Altra versione'}
                    <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '180px', overflow: 'auto' }}>{display(conflict[choice])}</pre>
                </label>)}
            </fieldset>)}
            <button className="btn btn-primary" style={{ minHeight: '44px' }} disabled={busy} onClick={apply}>{busy ? 'Salvataggio…' : 'Applica scelte'}</button>
            <button className="btn" style={{ minHeight: '44px' }} disabled={busy} onClick={() => setOpen(false)}>Più tardi</button>
        </>}
    </section>;
}
