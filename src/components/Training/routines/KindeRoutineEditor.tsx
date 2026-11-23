import { useMemo, useRef, useState } from 'react';
import type { KindeRoutineDraft } from '../../../lib/auth/kindeCandidateRoutineDraft';
import { routineExerciseEditorActions } from '../../../hooks/trainingRoutines/routineExerciseEditorActions';
import { routineDraftValidationError } from '../../../lib/routineSaveIntent';
import { useDialogStore } from '../../../store/useDialogStore';
import type { Exercise } from '../../../types';
import { RoutineEditor } from './RoutineEditor';

export function KindeRoutineEditor({ draft, library, isCurrent, onClose, onSave }: {
    draft: KindeRoutineDraft;
    library: Exercise[];
    isCurrent: () => boolean;
    onClose: () => void;
    onSave: () => Promise<void>;
}) {
    const [values, setValues] = useState(() => ({ name: draft.initial.name, exercises: draft.initial.exercises }));
    const current = useRef(values);
    const busy = useRef(false);
    const blocked = useRef(false);
    const [waiting, setWaiting] = useState(false);
    const [failed, setFailed] = useState(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    const libraryById = useMemo(() => new Map(library.map(exercise => [exercise.id, exercise])), [library]);
    const definitions = values.exercises.map(exercise => libraryById.get(exercise.exId));
    const editingRoutineId = draft.initial.editing ? draft.initial.routineId : null;

    const update = (next: typeof values) => {
        if (busy.current || blocked.current || !isCurrent()) return;
        try {
            // A displayed keystroke is already encrypted and durable, including
            // when the page is suspended before effects or timers can run.
            draft.write(next);
            current.current = next;
            setValues(next);
        } catch {
            blocked.current = true;
            setFailed(true);
        }
    };
    const exerciseActions = () => routineExerciseEditorActions(updateExercises => {
        const previous = current.current;
        const exercises = updateExercises(previous.exercises);
        if (exercises !== previous.exercises) update({ ...previous, exercises });
    });

    const discard = async () => {
        if (busy.current || !isCurrent()) return;
        busy.current = true;
        setWaiting(true);
        try {
            if (!(await showConfirm('Eliminare la bozza da questo dispositivo?')) || !isCurrent()) return;
            draft.discard();
            onClose();
        } catch {
            if (isCurrent()) setFailed(true);
        } finally {
            busy.current = false;
            setWaiting(false);
        }
    };

    const save = async () => {
        if (busy.current || blocked.current || !isCurrent()) return;
        busy.current = true;
        setWaiting(true);
        try {
            const { name, exercises } = current.current;
            const problem = routineDraftValidationError(name, exercises);
            if (problem) { await showAlert(problem); return; }
            await onSave();
        } catch {
            if (isCurrent()) setFailed(true);
        } finally {
            busy.current = false;
            setWaiting(false);
        }
    };
    const close = () => {
        if (!busy.current) onClose();
    };

    const form = <RoutineEditor
        routineName={values.name}
        preview={draft.initial.submitted}
        setRoutineName={name => update({ ...current.current, name })}
        editingRoutineId={editingRoutineId}
        routineExercises={values.exercises}
        library={library}
        libraryById={libraryById}
        editMuscles={definitions.flatMap(definition => definition?.muscles ?? [])}
        editSecMuscles={definitions.flatMap(definition => definition?.secondaryMuscles ?? [])}
        onAddExercise={(...args) => exerciseActions().handleAddExerciseToRoutine(...args)}
        onMoveExercise={(...args) => exerciseActions().moveExercise(...args)}
        onRemoveExercise={(...args) => exerciseActions().handleRemoveExerciseFromRoutine(...args)}
        onUpdateSetsCount={(...args) => exerciseActions().handleUpdateSetsCount(...args)}
        onUpdateReps={(...args) => exerciseActions().handleUpdateReps(...args)}
        onUpdateSetPlan={(...args) => exerciseActions().handleUpdateSetPlan(...args)}
        onUpdateSetPlanField={(...args) => exerciseActions().handleUpdateSetPlanField(...args)}
        onUpdateExerciseMetadata={(...args) => exerciseActions().handleUpdateExerciseMetadata(...args)}
        isSaving={waiting}
        onClose={close}
        includeExerciseNameInRemovalConfirmation={false}
        onCancel={() => { void discard(); }}
        onSave={() => { void save(); }}
    />;

    return (
        <section aria-label="Bozza scheda account" className="routine-editor-shell">
            {draft.initial.submitted ? (
                <>
                    <p role="status">Verifica la scheda nell’archivio. Questa bozza contiene un salvataggio già tentato.</p>
                    <fieldset disabled className="routine-draft-preview" aria-label="Valori della bozza">{form}</fieldset>
                    <button type="button" className="btn" disabled={waiting} onClick={close}>Chiudi</button>
                    <button type="button" className="btn" disabled={waiting} onClick={() => { void discard(); }}>Elimina bozza</button>
                </>
            ) : form}
            {failed && <p role="alert">Impossibile confermare la bozza. L’ultima copia verificata è conservata. Chiudi e riapri la bozza.</p>}
        </section>
    );
}
