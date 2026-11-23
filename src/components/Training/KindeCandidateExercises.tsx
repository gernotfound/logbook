import { useMemo, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { buildExerciseDuplicateOperation } from '../../lib/exerciseDuplicateIntent';
import { generateId } from '../../lib/utils/date';
import { useDialogStore } from '../../store/useDialogStore';
import type { Exercise, WorkoutRoutine } from '../../types';
import { ExerciseArchive } from './exercises/ExerciseArchive';
import './training-exercises.css';

const EMPTY_LIBRARY: readonly Exercise[] = [];
const EMPTY_ROUTINES: readonly WorkoutRoutine[] = [];

export function KindeCandidateExercises({ realm }: { realm: ReturnType<typeof useKindeCandidateFitnessLifecycle> }) {
    const [selectedExId, setSelectedExId] = useState<string | null>(null);
    const showAlert = useDialogStore(state => state.showAlert);
    const data = realm.state.phase === 'ready' ? realm.state.snapshot.data : null;
    const library = data?.library ?? EMPTY_LIBRARY;
    const personalExercises = useMemo(() => library.filter(exercise => !exercise.isDefault), [library]);
    if (!data) return null;

    const duplicate = async (exercise: Exercise) => {
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        try {
            await realm.submit(buildExerciseDuplicateOperation(exercise, library, generateId('ex')));
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile duplicare l’esercizio.');
        }
    };

    return (
        <section className="training-sub-view active exercise-library" aria-label="Esercizi personali account">
            <header className="exercise-library-header"><h2>Esercizi</h2></header>
            <ExerciseArchive
                library={personalExercises}
                routines={data.routines ?? EMPTY_ROUTINES}
                selectedExId={selectedExId}
                onSelectedExIdChange={setSelectedExId}
                onDuplicate={duplicate}
            />
        </section>
    );
}
