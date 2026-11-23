import { useMemo, useRef, useState } from 'react';
import { filterMuscles } from '../../../hooks/trainingExercises/muscleSelection';
import { removeExerciseMuscle, toggleExerciseMuscle, type MuscleSelectionMode } from '../../../hooks/trainingExercises/exerciseMuscleEditor';
import type { KindeExerciseDraft } from '../../../lib/auth/kindeCandidateExerciseDraft';
import { MUSCLES, type MuscleDef } from '../../../lib/constants/muscles';
import type { ExerciseDraft } from '../../../lib/exerciseEditorDraft';
import { exerciseDraftProblem, hasDuplicateExerciseName } from '../../../lib/exerciseEditorModel';
import { useDialogStore } from '../../../store/useDialogStore';
import type { Exercise } from '../../../types';
import { ExerciseEditorForm } from './ExerciseEditorForm';

const musclesById = new Map(MUSCLES.map(muscle => [muscle.id, muscle]));
const keepUnknown = (updated: MuscleDef[], previous: MuscleDef[]) =>
    [...updated, ...previous.filter(muscle => !musclesById.has(muscle.id))];

export function KindeExerciseEditor({ draft, library, isCurrent, onClose, onSave }: {
    draft: KindeExerciseDraft;
    library: readonly Exercise[];
    isCurrent: () => boolean;
    onClose: () => void;
    onSave: () => Promise<void>;
}) {
    const [values, setValues] = useState(draft.initial.values);
    const current = useRef(values);
    const busy = useRef(false);
    const blocked = useRef(false);
    const [waiting, setWaiting] = useState(false);
    const [failed, setFailed] = useState(false);
    const [muscleSearch, setMuscleSearch] = useState('');
    const [selectionMode, setSelectionMode] = useState<MuscleSelectionMode>('primary');
    const filteredMuscles = useMemo(() => filterMuscles(muscleSearch), [muscleSearch]);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const { editingId, submitted } = draft.initial;
    const isDuplicateName = hasDuplicateExerciseName(library, editingId, values.name);

    const update = (patch: Partial<ExerciseDraft>) => {
        if (busy.current || blocked.current || submitted || !isCurrent()) return;
        const next = { ...current.current, ...patch };
        try {
            draft.write(next);
            current.current = next;
            setValues(next);
        } catch {
            blocked.current = true;
            setFailed(true);
        }
    };
    const toggleMuscle = (muscle: MuscleDef) => {
        const { selectedMuscles, secondaryMuscles } = current.current;
        const toggled = toggleExerciseMuscle(selectedMuscles, secondaryMuscles, selectionMode, muscle);
        update({
            selectedMuscles: keepUnknown(toggled.selectedMuscles, selectedMuscles),
            secondaryMuscles: keepUnknown(toggled.secondaryMuscles, secondaryMuscles),
        });
    };
    const removeById = (id: string) => {
        const muscle = musclesById.get(id);
        const remove = (selection: MuscleDef[]) => muscle
            ? keepUnknown(removeExerciseMuscle(selection, muscle), selection)
            : selection.filter(item => item.id !== id);
        update({
            selectedMuscles: remove(current.current.selectedMuscles),
            secondaryMuscles: remove(current.current.secondaryMuscles),
        });
    };

    const run = async (action: () => Promise<void>) => {
        if (busy.current || !isCurrent()) return;
        busy.current = true;
        setWaiting(true);
        try { await action(); }
        catch { if (isCurrent()) setFailed(true); }
        finally { busy.current = false; setWaiting(false); }
    };
    const close = () => {
        if (!busy.current) onClose();
    };
    const discard = () => run(async () => {
        if (!(await showConfirm('Eliminare la bozza da questo dispositivo?')) || !isCurrent()) return;
        draft.discard();
        onClose();
    });
    const save = () => run(async () => {
        if (blocked.current || submitted) return;
        const problem = exerciseDraftProblem(library, editingId, current.current);
        if (problem) { await showAlert(problem); return; }
        await onSave();
    });

    return (
        <section aria-label="Bozza esercizio account">
            {submitted && <p role="status">Verifica l’esercizio nell’archivio. Questa bozza contiene un salvataggio già tentato.</p>}
            <ExerciseEditorForm
                hook={{
                    editingExId: editingId,
                    exName: values.name, setExName: name => update({ name }),
                    exNotes: values.notes, setExNotes: notes => update({ notes }),
                    trackingType: values.trackingType, setTrackingType: trackingType => update({ trackingType }),
                    isBodyweight: values.isBodyweight, setIsBodyweight: isBodyweight => update({ isBodyweight }),
                    equipmentWeight: values.equipmentWeight, setEquipmentWeight: equipmentWeight => update({ equipmentWeight }),
                    selectedMuscles: values.selectedMuscles, secondaryMuscles: values.secondaryMuscles,
                    muscleSearch, setMuscleSearch, filteredMuscles, selectionMode, setSelectionMode, isDuplicateName,
                    toggleMuscle,
                    handleToggleMuscleById: id => { const muscle = musclesById.get(id); if (muscle) toggleMuscle(muscle); },
                    removeMuscleById: removeById,
                }}
                isSaving={waiting || submitted}
                preview={submitted}
                onClose={close}
                onCancel={() => { void discard(); }}
                onSave={save}
            />
            {submitted && <>
                <button type="button" className="btn" disabled={waiting} onClick={close}>Chiudi</button>
                <button type="button" className="btn" disabled={waiting} onClick={() => { void discard(); }}>Elimina bozza</button>
            </>}
            {failed && <p role="alert">Impossibile confermare la bozza. Chiudi e riapri per verificare la copia sul dispositivo.</p>}
        </section>
    );
}
