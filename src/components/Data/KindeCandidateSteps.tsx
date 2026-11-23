import { useId, useRef, useState, type FormEvent } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useLocalToday } from '../../hooks/useLocalToday';
import { captureActivitySteps } from '../../lib/activity';
import type { KindeStepsDraft } from '../../lib/auth/kindeCandidateStepsDraft';
import { useDialogStore } from '../../store/useDialogStore';
import './data.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;
type Editor = { draft: KindeStepsDraft; isCurrent: () => boolean };
const formatSteps = new Intl.NumberFormat('it-IT');

export function KindeCandidateSteps({ realm }: { realm: Realm }) {
    const today = useLocalToday();
    const [selected, setSelected] = useState<string | null>(null);
    if (realm.state.phase !== 'ready') return null;
    const date = selected ?? today;
    return <StepsEditor key={date} realm={realm} date={date} today={today}
        selectDate={setSelected} saved={captureActivitySteps(realm.state.snapshot.data.nutrition?.[date])} />;
}

function StepsEditor({ realm, date, today, selectDate, saved }: {
    realm: Realm;
    date: string;
    today: string;
    selectDate: (date: string) => void;
    saved: ReturnType<typeof captureActivitySteps>;
}) {
    const id = useId();
    const [editor, setEditor] = useState<Editor | null>(null);
    const [steps, setSteps] = useState('');
    const [working, setWorking] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const busy = useRef(false);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const run = async (action: () => Promise<void>) => {
        if (busy.current) return;
        busy.current = true;
        setWorking(true);
        try { await action(); }
        finally { busy.current = false; setWorking(false); }
    };
    const open = () => run(async () => {
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent() || !date || date > today) return;
        try {
            const draft = await realm.openStepsDraft(date);
            if (!witness.isCurrent()) { draft.close(); return; }
            setSteps(draft.initial.steps);
            setBlocked(false);
            setEditor({ draft, isCurrent: witness.isCurrent });
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile aprire i passi. Verifica la copia di recupero.');
        }
    });
    const edit = (value: string) => {
        if (!editor?.isCurrent() || busy.current || blocked) return;
        try { editor.draft.write(value); setSteps(value); }
        catch { setBlocked(true); }
    };
    const close = () => {
        if (busy.current || !editor) return;
        editor.draft.close();
        setEditor(null);
    };
    const discard = () => run(async () => {
        if (!editor?.isCurrent()) return;
        try {
            if (!(await showConfirm('Eliminare la bozza dei passi da questo dispositivo?')) || !editor.isCurrent()) return;
            editor.draft.discard();
            setEditor(null);
        } catch {
            if (editor.isCurrent()) await showAlert('Impossibile eliminare la bozza. Copia conservata.');
        }
    });
    const save = (event: FormEvent) => {
        event.preventDefault();
        void run(async () => {
            if (!editor?.isCurrent() || blocked || editor.draft.initial.submitted) return;
            const count = Number(steps);
            if (!steps.trim() || !Number.isSafeInteger(count) || count < 0) {
                await showAlert('Inserisci un numero intero di passi uguale o maggiore di zero.');
                return;
            }
            try {
                const saved = await realm.saveStepsDraft(editor.draft);
                if (!saved.draftCleared && editor.isCurrent()) {
                    await showAlert('Passi salvati. Verifica la copia di recupero sul dispositivo.');
                }
                setEditor(null);
            } catch {
                setBlocked(true);
                if (editor.isCurrent()) await showAlert('Impossibile salvare i passi. La bozza cifrata resta sul dispositivo.');
            }
        });
    };
    const remove = () => run(async () => {
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent() || saved.steps === undefined) return;
        try {
            if (!(await showConfirm('Rimuovere i passi registrati per questo giorno?')) || !witness.isCurrent()) return;
            await realm.submit({ type: 'activity-steps.clear', date, expected: saved });
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile rimuovere i passi. Verifica il dato corrente.');
        }
    });

    return (
        <section aria-label="Passi account">
            <h2>Passi</h2>
            <label htmlFor={id + '-date'}>Giorno dei passi</label>
            <input id={id + '-date'} type="date" value={date} max={today}
                disabled={working || editor !== null} onChange={event => selectDate(event.target.value)} />
            {saved.steps === undefined ? <p>Nessun dato per questo giorno.</p> : <p>{formatSteps.format(saved.steps)} passi</p>}
            {editor ? (
                <form onSubmit={save} aria-label="Bozza passi account" aria-busy={working}>
                    {editor.draft.initial.submitted ? (
                        <p role="status">Salvataggio già tentato. Verifica l’archivio prima di eliminare la bozza.</p>
                    ) : (
                        <div className="activity-steps-form">
                            <label htmlFor={id + '-steps'}>Numero di passi</label>
                            <input id={id + '-steps'} type="number" inputMode="numeric" min="0" step="1"
                                required value={steps} disabled={working || blocked} onChange={event => edit(event.target.value)} />
                            <button type="submit" className="btn btn-primary" disabled={working || blocked}>Salva passi</button>
                        </div>
                    )}
                    {blocked && <p role="alert">Bozza da verificare. Chiudi e riapri il giorno per rileggere la copia cifrata.</p>}
                    <div className="data-action-row">
                        <button type="button" className="btn" disabled={working} onClick={close}>Chiudi e conserva bozza</button>
                        <button type="button" className="btn btn-danger" disabled={working}
                            onClick={() => { void discard(); }}>Elimina bozza</button>
                    </div>
                </form>
            ) : (
                <div className="data-action-row">
                    <button type="button" className="btn btn-primary" disabled={working || !date}
                        onClick={() => { void open(); }}>Modifica o riprendi passi</button>
                    {saved.steps !== undefined && <button type="button" className="btn" disabled={working}
                        onClick={() => { void remove(); }}>Rimuovi passi registrati</button>}
                </div>
            )}
        </section>
    );
}
