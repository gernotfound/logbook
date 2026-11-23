import { useRef, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import type { KindeSleepDraft } from '../../lib/auth/kindeCandidateSleepDraft';
import { useLocalToday } from '../../hooks/useLocalToday';
import { useDialogStore } from '../../store/useDialogStore';
import type { SleepDraftValues } from '../../lib/sleepForm';
import DataSleep from './DataSleep';
import './data.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;
type ActiveEditor = { draft: KindeSleepDraft; isCurrent: () => boolean };
const SLEEP_FIELDS = ['sleepHours', 'sleepDeep', 'sleepLight', 'sleepRem', 'sleepAwake'] as const;

function SleepDraftEditor({ editor, realm, onClose }: {
    editor: ActiveEditor;
    realm: Realm;
    onClose: () => void;
}) {
    const { draft, isCurrent } = editor;
    const { date, hasExisting, submitted } = draft.initial;
    const [values, setValues] = useState<SleepDraftValues>(draft.initial.values);
    const latest = useRef(values);
    const busy = useRef(false);
    const blocked = useRef(false);
    const [blockedUi, setBlockedUi] = useState(false);
    const [working, setWorking] = useState(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);

    const update = (field: 'sleepHours' | 'sleepDeep' | 'sleepLight' | 'sleepRem' | 'sleepAwake', value: string) => {
        if (busy.current || blocked.current || submitted || !isCurrent()) return;
        const next: SleepDraftValues = { ...latest.current, [field]: value };
        try {
            draft.write(next);
            latest.current = next;
            setValues(next);
        } catch {
            blocked.current = true;
            setBlockedUi(true);
        }
    };
    const close = () => {
        if (busy.current) return;
        draft.close();
        onClose();
    };
    const discard = async () => {
        if (busy.current || !isCurrent()) return;
        busy.current = true;
        setWorking(true);
        try {
            if (!(await showConfirm('Eliminare la bozza del sonno da questo dispositivo?'))
                || !isCurrent()) return;
            draft.discard();
            onClose();
        } catch {
            if (isCurrent()) await showAlert('Impossibile eliminare la bozza. Copia originale conservata.');
        } finally {
            busy.current = false;
            setWorking(false);
        }
    };
    const save = async (event?: { preventDefault(): void }) => {
        event?.preventDefault();
        if (busy.current || blocked.current || submitted || !isCurrent()) return false;
        busy.current = true;
        setWorking(true);
        try {
            const saved = await realm.saveSleepDraft(draft);
            if (!saved.draftCleared && isCurrent()) {
                await showAlert('Dati salvati, ma la copia di recupero richiede una verifica.');
            }
            onClose();
            return true;
        } catch {
            if (isCurrent()) await showAlert('Impossibile salvare il sonno. La bozza cifrata resta sul dispositivo.');
            return false;
        } finally {
            busy.current = false;
            setWorking(false);
        }
    };

    return (
        <section aria-label="Bozza sonno account">
            <p>Bozza del {date}. I valori inseriti restano cifrati sul dispositivo.</p>
            {submitted && (
                <p role="status">Salvataggio già tentato: verifica l’archivio prima di eliminare la bozza.</p>
            )}
            <div className="data-action-row">
                <button type="button" className="btn" disabled={working} onClick={close}>Chiudi e conserva bozza</button>
                <button type="button" className="btn btn-danger" disabled={working}
                    onClick={() => { void discard(); }}>Elimina bozza</button>
            </div>
            {!submitted && !blockedUi && (
                <DataSleep
                    selectedDate={date}
                    sleepHook={{
                        editingDate: hasExisting ? date : null,
                        setEditingDate: () => {},
                        cancelEdit: () => { close(); return true; },
                        saveSleep: save,
                        sleepHours: values.sleepHours, setSleepHours: value => update('sleepHours', value),
                        sleepDeep: values.sleepDeep, setSleepDeep: value => update('sleepDeep', value),
                        sleepLight: values.sleepLight, setSleepLight: value => update('sleepLight', value),
                        sleepRem: values.sleepRem, setSleepRem: value => update('sleepRem', value),
                        sleepAwake: values.sleepAwake, setSleepAwake: value => update('sleepAwake', value),
                    }}
                />
            )}
            {working && <p role="status">Verifica salvataggio in corso…</p>}
            {blockedUi && (
                <p role="alert">Bozza non confermata. Chiudi e riapri l’archivio per verificare la copia cifrata.</p>
            )}
        </section>
    );
}

export function KindeCandidateSleep({ realm }: { realm: Realm }) {
    const today = useLocalToday();
    const [chosenDate, setChosenDate] = useState<string | null>(null);
    const [editor, setEditor] = useState<ActiveEditor | null>(null);
    const opening = useRef(false);
    const [isOpening, setIsOpening] = useState(false);
    const showAlert = useDialogStore(state => state.showAlert);
    const ready = realm.state.phase === 'ready' ? realm.state : null;
    if (!ready) return null;
    const date = chosenDate ?? today;
    const day = ready.snapshot.data.nutrition?.[date];
    const hasExisting = SLEEP_FIELDS.some(field => day?.[field] !== undefined
        && day?.[field] !== null && day?.[field] !== '');
    const open = async () => {
        if (opening.current || editor) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        opening.current = true;
        setIsOpening(true);
        try {
            const draft = await realm.openSleepDraft(date);
            if (!witness.isCurrent()) { draft.close(); return; }
            setEditor({ draft, isCurrent: witness.isCurrent });
        } catch {
            if (witness.isCurrent()) {
                await showAlert('Impossibile aprire il sonno. Verifica la sessione o una bozza precedente.');
            }
        } finally {
            opening.current = false;
            setIsOpening(false);
        }
    };

    return (
        <section aria-label="Sonno account">
            <h2>Sonno</h2>
            {editor ? (
                <SleepDraftEditor key={editor.draft.initial.date} editor={editor} realm={realm}
                    onClose={() => setEditor(null)} />
            ) : (
                <>
                    <label htmlFor="kinde-sleep-date">Data della notte</label>
                    <input id="kinde-sleep-date" type="date" value={date} max={today}
                        disabled={isOpening} onChange={event => setChosenDate(event.target.value)} />
                    <button type="button" className="btn btn-primary" disabled={isOpening}
                        onClick={() => { void open(); }}>
                        {hasExisting ? 'Modifica o riprendi sonno' : 'Inserisci o riprendi sonno'}
                    </button>
                    <p>Una bozza già presente viene ripresa con la sua data originale.</p>
                </>
            )}
        </section>
    );
}
