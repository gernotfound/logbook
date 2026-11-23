import { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { buildExerciseDuplicateOperation } from '../../lib/exerciseDuplicateIntent';
import { exerciseRoutineReferences } from '../../lib/exerciseRoutineReferences';
import type { KindeExerciseDraft } from '../../lib/auth/kindeCandidateExerciseDraft';
import { generateId } from '../../lib/utils/date';
import { useDialogStore } from '../../store/useDialogStore';
import type { Exercise, WorkoutRoutine } from '../../types';
import { ExerciseArchive } from './exercises/ExerciseArchive';
import { KindeExerciseEditor } from './exercises/KindeExerciseEditor';
import './training-exercises.css';

const EMPTY_LIBRARY: readonly Exercise[] = [];
const EMPTY_ROUTINES: readonly WorkoutRoutine[] = [];

export function KindeCandidateExercises({ realm }: { realm: ReturnType<typeof useKindeCandidateFitnessLifecycle> }) {
    const [selectedExId, setSelectedExId] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ draft: KindeExerciseDraft; isCurrent: () => boolean } | null>(null);
    const [opening, setOpening] = useState(false);
    const openingRef = useRef(false);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const data = realm.state.phase === 'ready' ? realm.state.snapshot.data : null;
    const library = data?.library ?? EMPTY_LIBRARY;
    const personalExercises = useMemo(() => library.filter(exercise => !exercise.isDefault), [library]);
    if (!data) return null;
    const routines = data.routines ?? EMPTY_ROUTINES;

    const openEditor = async (id?: string) => {
        if (openingRef.current) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        openingRef.current = true;
        setOpening(true);
        try {
            const draft = await realm.openExerciseDraft(id);
            if (!witness.isCurrent()) { draft.close(); return; }
            setEditing({ draft, isCurrent: witness.isCurrent });
        } catch {
            if (witness.isCurrent()) await showAlert(id === undefined
                ? 'Impossibile aprire la bozza dell’esercizio. Le copie sul dispositivo sono conservate.'
                : 'Impossibile aprire l’esercizio. Usa «Crea o riprendi esercizio» per verificare la bozza in corso.');
        } finally {
            openingRef.current = false;
            setOpening(false);
        }
    };

    const duplicate = async (exercise: Exercise) => {
        if (openingRef.current) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        try {
            await realm.submit(buildExerciseDuplicateOperation(exercise, library, generateId('ex')));
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile duplicare l’esercizio.');
        }
    };

    const remove = async (id: string) => {
        if (openingRef.current) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        const expectedRoutineIds = exerciseRoutineReferences(routines, id);
        const count = expectedRoutineIds.length;
        const message = count === 0 ? 'Eliminare questo esercizio dall’archivio personale?'
            : count === 1 ? 'Eliminare questo esercizio dall’archivio e dalla scheda che lo usa?'
                : `Eliminare questo esercizio dall’archivio e dalle ${count} schede che lo usano?`;
        if (!(await showConfirm(message)) || !witness.isCurrent()) return;
        try { await realm.submit({ type: 'exercise.delete', id, expectedRoutineIds }); }
        catch { if (witness.isCurrent()) await showAlert('Impossibile eliminare l’esercizio.'); }
    };

    return (
        <section className="training-sub-view active exercise-library" aria-label="Esercizi personali account">
            <header className="exercise-library-header">
                <h2>Esercizi</h2>
                {!editing && <button type="button" className="btn btn-primary exercise-create-button"
                    disabled={opening} onClick={() => { void openEditor(); }}>
                    <Plus size={18} aria-hidden="true" /> Crea o riprendi esercizio
                </button>}
            </header>
            {editing ? <KindeExerciseEditor
                draft={editing.draft}
                library={library}
                isCurrent={editing.isCurrent}
                onClose={() => { editing.draft.close(); setEditing(null); }}
                onSave={async () => {
                    const saved = await realm.saveExerciseDraft(editing.draft);
                    if (!saved.draftCleared && editing.isCurrent()) {
                        await showAlert('Esercizio salvato. La bozza sul dispositivo richiede una verifica.');
                    }
                }}
            /> : <ExerciseArchive
                library={personalExercises}
                routines={routines}
                selectedExId={selectedExId}
                onSelectedExIdChange={setSelectedExId}
                onDuplicate={duplicate}
                onEditItem={exercise => { void openEditor(exercise.id); }}
                onDelete={remove}
            />}
        </section>
    );
}
