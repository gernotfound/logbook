import { useId, useRef, useState, type FormEvent } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import type { ActivitySteps } from '../../lib/activity';
import type { KindeStepsDraft } from '../../lib/auth/kindeCandidateStepsDraft';
import { useDialogStore } from '../../store/useDialogStore';
import type { ActivityEditorAccess } from './KindeCandidateActivity';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;
type Editor = { draft: KindeStepsDraft; isCurrent: () => boolean };
const formatSteps = new Intl.NumberFormat('it-IT');

export function KindeCandidateSteps({ realm, date, access, saved }: {
    realm: Realm;
    date: string;
    access: ActivityEditorAccess;
    saved: ActivitySteps;
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
        if (!witness?.isCurrent() || !access.claim()) return;
        let opened = false;
        try {
            const draft = await realm.openStepsDraft(date);
            if (!witness.isCurrent()) { draft.close(); return; }
            setSteps(draft.initial.steps);
            setBlocked(false);
            setEditor({ draft, isCurrent: witness.isCurrent });
            opened = true;
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile aprire i passi. Verifica la copia di recupero.');
        } finally {
            if (!opened) access.release();
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
        access.release();
    };
    const discard = () => run(async () => {
        if (!editor?.isCurrent()) return;
        try {
            if (!(await showConfirm('Eliminare la bozza dei passi da questo dispositivo?')) || !editor.isCurrent()) return;
            editor.draft.discard();
            setEditor(null);
            access.release();
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
                access.release();
            } catch {
                setBlocked(true);
                if (editor.isCurrent()) await showAlert('Impossibile salvare i passi. La bozza cifrata resta sul dispositivo.');
            }
        });
    };
    const remove = () => run(async () => {
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent() || saved.steps === undefined || !access.claim()) return;
        try {
            if (!(await showConfirm('Rimuovere i passi registrati per questo giorno?')) || !witness.isCurrent()) return;
            await realm.submit({ type: 'activity-steps.clear', date, expected: saved });
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile rimuovere i passi. Verifica il dato corrente.');
        } finally {
            access.release();
        }
    });

    return (
        <section aria-label="Passi account">
            <h2>Passi</h2>
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
                    <button type="button" className="btn btn-primary" disabled={working || access.disabled}
                        onClick={() => { void open(); }}>Modifica o riprendi passi</button>
                    {saved.steps !== undefined && <button type="button" className="btn" disabled={working || access.disabled}
                        onClick={() => { void remove(); }}>Rimuovi passi registrati</button>}
                </div>
            )}
        </section>
    );
}
