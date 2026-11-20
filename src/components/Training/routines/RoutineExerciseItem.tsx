import React, { useId } from 'react';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { useDialogStore } from '../../../store/useDialogStore';
import { RoutineExerciseTargets } from './RoutineExerciseTargets';
import { RoutineExerciseTechnique } from './RoutineExerciseTechnique';
import type { RoutineExerciseItemProps } from './routineExerciseEditorTypes';

export const RoutineExerciseItem: React.FC<RoutineExerciseItemProps> = ({
    exercise,
    index,
    totalExercises,
    libDef,
    onMove,
    onRemove,
    onUpdateSetsCount,
    onUpdateReps,
    onUpdateSetPlan,
    onUpdateSetPlanField,
    onUpdateExerciseMetadata
}) => {
    const isCardio = libDef?.trackingType === 'cardio';
    const fieldId = useId();
    const showConfirm = useDialogStore(state => state.showConfirm);
    const requestRemove = async () => {
        const exerciseName = libDef?.name || 'questo esercizio';
        const confirmed = await showConfirm(
            `Vuoi rimuovere “${exerciseName}” da questa scheda? L’esercizio resterà disponibile nella libreria.`,
            'Rimuovi esercizio',
        );
        if (confirmed) onRemove(index, exercise);
    };

    return (
        <div className="flex-col bg-card-inner p-12 rounded-8 gap-10" style={{ border: '1px solid var(--glass-border)' }}>
            <div className="flex-between gap-10 items-center">
                <div className="text-md font-semibold flex-1">
                    {index + 1}. {libDef ? libDef.name : 'Esercizio rimosso'}
                </div>
                <div className="flex gap-4">
                    <button
                        type="button"
                        className="btn-icon"
                        disabled={index === 0}
                        style={{ opacity: index === 0 ? 0.3 : 1 }}
                        onClick={() => onMove(index, -1)}
                        aria-label="Sposta in alto"
                    >
                        <ArrowUp size={18} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="btn-icon"
                        disabled={index === totalExercises - 1}
                        style={{ opacity: index === totalExercises - 1 ? 0.3 : 1 }}
                        onClick={() => onMove(index, 1)}
                        aria-label="Sposta in basso"
                    >
                        <ArrowDown size={18} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="btn-icon text-danger"
                        onClick={() => void requestRemove()}
                        aria-label="Rimuovi esercizio"
                    >
                        <Trash2 size={18} aria-hidden="true" />
                    </button>
                </div>
            </div>

            <RoutineExerciseTargets exercise={exercise} index={index} fieldId={fieldId} trackingType={libDef?.trackingType}
                onUpdateSetsCount={onUpdateSetsCount} onUpdateReps={onUpdateReps} />
            <RoutineExerciseTechnique exercise={exercise} index={index} fieldId={fieldId} isCardio={isCardio}
                onUpdateSetPlan={onUpdateSetPlan} onUpdateSetPlanField={onUpdateSetPlanField}
                onUpdateExerciseMetadata={onUpdateExerciseMetadata} />
        </div>
    );
};
