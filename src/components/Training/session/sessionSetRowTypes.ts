import type { SessionExerciseSet } from '../../../types';

export interface SessionSetRowProps {
    set: SessionExerciseSet;
    sIndex: number;
    exIndex: number;
    exerciseInstanceId?: string;
    trackingType?: string;
    isOpenMenu: boolean;
    onToggleMenu: (setId: string) => void;
    onRemoveSet: (exIndex: number, sIndex: number, setId: string, exerciseId?: string, workoutId?: string | null, expectedSet?: SessionExerciseSet) => void;
    onUpdateSet: (exIndex: number, setId: string, field: string, value: unknown) => void;
    onAddSpecialSet: (exIndex: number, type: string, setId: string) => void;
    onUpdateSpecialSet: (exIndex: number, setId: string, type: 'segments', segmentId: string, field: string, value: unknown) => void;
    onRemoveSpecialSet: (exIndex: number, setId: string, type: 'segments', segmentId: string) => void;
    onUpdateSetTarget: (exIndex: number, setId: string, reps: number | undefined) => void;
}
