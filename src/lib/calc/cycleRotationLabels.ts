import type { TrainingCycle, WorkoutRoutine } from '../../types';

function rotationLetter(position: number): string {
    let remaining = position;
    let label = '';
    while (remaining > 0) {
        remaining -= 1;
        label = String.fromCharCode(65 + remaining % 26) + label;
        remaining = Math.floor(remaining / 26);
    }
    return label;
}

// Missing routine references remain visible but never consume a rotation position.
export function getCycleRotationItems(cycle: TrainingCycle | null | undefined, routines: WorkoutRoutine[]) {
    if (!cycle) return [];
    const byId = new Map(routines.map(routine => [routine.id, routine]));
    let position = 0;
    return (cycle.routines ?? []).map(item => {
        const routine = byId.get(item.routineId);
        if (!routine) return { routineId: item.routineId, routine: undefined, letter: null, position: null };
        position += 1;
        return { routineId: item.routineId, routine, letter: rotationLetter(position), position };
    });
}
