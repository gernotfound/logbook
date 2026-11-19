import type { ExerciseLibraryItem, ProgressionContract, RoutineExercise, SetTechnique } from '../../../types';

export interface RoutineExerciseItemProps {
    exercise: RoutineExercise;
    index: number;
    totalExercises: number;
    libDef?: ExerciseLibraryItem;
    onMove: (index: number, direction: number) => void;
    onRemove: (index: number) => void;
    onUpdateSetsCount: (index: number, value: string) => void;
    onUpdateReps: (index: number, field: 'minReps' | 'maxReps', value: string) => void;
    onUpdateSetPlan: (exerciseIndex: number, setIndex: number, tech: SetTechnique) => void;
    onUpdateSetPlanField: (exerciseIndex: number, setIndex: number, field: 'restSeconds' | 'segmentCount' | 'targetReps', value: string) => void;
    onUpdateExerciseMetadata: (exerciseIndex: number, field: 'technicalStandard' | keyof ProgressionContract, value: string) => void;
}
