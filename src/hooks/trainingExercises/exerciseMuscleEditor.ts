import { Logic } from '../../lib/logic';
import type { MuscleDef } from '../../lib/constants/muscles';
import { getExpandedMuscleIds, toggleSmartMuscleSelection } from './muscleSelection';

export type MuscleSelectionMode = 'primary' | 'secondary';

interface MuscleSelections {
    selectedMuscles: MuscleDef[];
    secondaryMuscles: MuscleDef[];
}

export function toggleExerciseMuscle(
    selectedMuscles: MuscleDef[],
    secondaryMuscles: MuscleDef[],
    mode: MuscleSelectionMode,
    muscle: MuscleDef,
): MuscleSelections {
    if (!muscle?.id) return { selectedMuscles, secondaryMuscles };

    const toggledIds = getExpandedMuscleIds([muscle]);
    if (mode === 'primary') {
        const nextPrimary = toggleSmartMuscleSelection(selectedMuscles, muscle);
        const remainingSecondary = getExpandedMuscleIds(secondaryMuscles);
        toggledIds.forEach(id => remainingSecondary.delete(id));
        return {
            selectedMuscles: nextPrimary,
            secondaryMuscles: toggleSmartMuscleSelection([...remainingSecondary].map(id => ({ id }))),
        };
    }

    const nextSecondary = toggleSmartMuscleSelection(secondaryMuscles, muscle);
    const remainingPrimary = getExpandedMuscleIds(selectedMuscles);
    toggledIds.forEach(id => remainingPrimary.delete(id));
    return {
        selectedMuscles: toggleSmartMuscleSelection([...remainingPrimary].map(id => ({ id }))),
        secondaryMuscles: nextSecondary,
    };
}

export function removeExerciseMuscle(selection: MuscleDef[], muscle: MuscleDef): MuscleDef[] {
    const removedIds = getExpandedMuscleIds([muscle]);
    const remaining = getExpandedMuscleIds(selection);
    removedIds.forEach(id => remaining.delete(id));
    return toggleSmartMuscleSelection([...remaining].map(id => ({ id })));
}

export function resolveExerciseMuscles(ids: readonly string[] | undefined): MuscleDef[] {
    const resolved: MuscleDef[] = [];
    for (const id of ids || []) {
        const muscle = Logic.MUSCLES.find(candidate => candidate.id === id);
        if (muscle) resolved.push(muscle);
    }
    return resolved;
}
