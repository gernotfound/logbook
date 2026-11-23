import { useRef, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import type { KindeMeasurementDraft, KindeMeasurementValues } from '../../lib/auth/kindeCandidateMeasurementDraft';
import { useLocalToday } from '../../hooks/useLocalToday';
import { hasMeasurementData } from '../../lib/nutrition/measurementPresence';
import { useDialogStore } from '../../store/useDialogStore';
import type { UserProfile } from '../../types';
import DataMeasurements from './DataMeasurements';
import './data.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;
type ActiveEditor = { draft: KindeMeasurementDraft; isCurrent: () => boolean };

function MeasurementDraftEditor({ editor, profile, realm, onClose }: {
    editor: ActiveEditor;
    profile: UserProfile;
    realm: Realm;
    onClose: () => void;
}) {
    const { draft, isCurrent } = editor;
    const { date, hasExisting, submitted } = draft.initial;
    const [values, setValues] = useState<KindeMeasurementValues>(draft.initial.values);
    const latest = useRef(values);
    const busy = useRef(false);
    const blocked = useRef(false);
    const [blockedUi, setBlockedUi] = useState(false);
    const [failed, setFailed] = useState(false);
    const [working, setWorking] = useState(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);

    const update = (patch: Partial<KindeMeasurementValues>) => {
        if (busy.current || blocked.current || submitted || !isCurrent()) return;
        const next = { ...latest.current, ...patch };
        try {
            // Each keystroke gets an authenticated device record before it can
            // appear as a saved draft. Never display an unpersisted success.
            draft.write(next);
            latest.current = next;
            setValues(next);
        } catch {
            blocked.current = true;
            setBlockedUi(true);
            setFailed(true);
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
            if (!(await showConfirm('Eliminare la bozza di misurazione da questo dispositivo?'))
                || !isCurrent()) return;
            draft.discard();
            onClose();
        } catch {
            if (isCurrent()) setFailed(true);
        } finally {
            busy.current = false;
            setWorking(false);
        }
    };
    const save = async (event?: { preventDefault(): void }, calculateBf = false) => {
        event?.preventDefault();
        if (busy.current || blocked.current || submitted || !isCurrent()) return false;
        // The controlled BF toggle is persisted with the other form fields.
        if (latest.current.calculateBf !== calculateBf) return false;
        busy.current = true;
        setWorking(true);
        try {
            const saved = await realm.saveMeasurementDraft(draft);
            if (!saved.draftCleared && isCurrent()) {
                await showAlert('Misurazione salvata, ma la copia di recupero richiede una verifica.');
            }
            onClose();
            return true;
        } catch {
            if (isCurrent()) await showAlert('Impossibile salvare la misurazione. La bozza cifrata è conservata.');
            return false;
        } finally {
            busy.current = false;
            setWorking(false);
        }
    };

    return (
        <section aria-label="Bozza misurazione account">
            <p>Bozza del {date}. Chiudendo l’editor, i dati già inseriti restano cifrati sul dispositivo.</p>
            {submitted && (
                <p role="status">Un salvataggio è già stato tentato. Verifica l’archivio prima di eliminare questa bozza.</p>
            )}
            <div className="data-action-row">
                <button type="button" className="btn" disabled={working} onClick={close}>Chiudi e conserva bozza</button>
                <button type="button" className="btn btn-danger" disabled={working}
                    onClick={() => { void discard(); }}>Elimina bozza</button>
            </div>
            {!submitted && !blockedUi && (
                <DataMeasurements
                    profile={profile}
                    targetDateStr={date}
                    hasExistingData={hasExisting}
                    measureTime={values.measureTime} setMeasureTime={measureTime => update({ measureTime })}
                    weight={values.weight} setWeight={weight => update({ weight })}
                    waist={values.waist} setWaist={waist => update({ waist })}
                    neck={values.neck} setNeck={neck => update({ neck })}
                    hip={values.hip} setHip={hip => update({ hip })}
                    chest={values.chest} setChest={chest => update({ chest })}
                    shoulders={values.shoulders} setShoulders={shoulders => update({ shoulders })}
                    biceps={values.biceps} setBiceps={biceps => update({ biceps })}
                    thighs={values.thighs} setThighs={thighs => update({ thighs })}
                    calves={values.calves} setCalves={calves => update({ calves })}
                    calculateBfChoice={values.calculateBf}
                    onCalculateBfChoiceChange={calculateBf => update({ calculateBf })}
                    handleCancelEdit={close}
                    calculateAndSave={save}
                />
            )}
            {working && <p role="status">Verifica del salvataggio…</p>}
            {failed && <p role="alert">La bozza non è stata confermata. Chiudi e riapri l’archivio per verificare la copia cifrata.</p>}
        </section>
    );
}

export function KindeCandidateMeasurements({ realm }: { realm: Realm }) {
    const today = useLocalToday();
    const [chosenDate, setChosenDate] = useState<string | null>(null);
    const [editor, setEditor] = useState<ActiveEditor | null>(null);
    const opening = useRef(false);
    const [isOpening, setIsOpening] = useState(false);
    const showAlert = useDialogStore(state => state.showAlert);
    const ready = realm.state.phase === 'ready' ? realm.state : null;
    if (!ready) return null;
    const date = chosenDate ?? today;
    const hasData = hasMeasurementData(ready.snapshot.data.nutrition?.[date]);
    const open = async () => {
        if (opening.current || editor) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        opening.current = true;
        setIsOpening(true);
        try {
            const draft = await realm.openMeasurementDraft(date);
            if (!witness.isCurrent()) { draft.close(); return; }
            setEditor({ draft, isCurrent: witness.isCurrent });
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile aprire la misurazione. Una bozza precedente o il suo archivio potrebbe richiedere verifica.');
        } finally {
            opening.current = false;
            setIsOpening(false);
        }
    };

    return (
        <section aria-label="Misurazioni corporee account">
            <h2>Misurazioni</h2>
            {editor ? (
                <MeasurementDraftEditor key={editor.draft.initial.date} editor={editor}
                    profile={ready.snapshot.data.profile ?? {}} realm={realm}
                    onClose={() => setEditor(null)} />
            ) : (
                <>
                    <label htmlFor="kinde-measurement-date">Data della misurazione</label>
                    <input id="kinde-measurement-date" type="date" value={date} max={today}
                        disabled={isOpening} onChange={event => setChosenDate(event.target.value)} />
                    <button type="button" className="btn btn-primary" disabled={isOpening}
                        onClick={() => { void open(); }}>
                        {hasData ? 'Modifica o riprendi misurazione' : 'Inserisci o riprendi misurazione'}
                    </button>
                    <p>Una bozza già presente viene ripresa nella sua data originale, senza sovrascrivere altre giornate.</p>
                </>
            )}
        </section>
    );
}
