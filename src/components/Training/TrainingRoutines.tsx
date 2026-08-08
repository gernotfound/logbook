import React from 'react';
import { useTrainingRoutines } from '../../hooks/useTrainingRoutines';
import { RoutineEditor } from './routines/RoutineEditor';
import { RoutineCard } from './routines/RoutineCard';

const TrainingRoutines: React.FC = () => {
    const {
        routineName, setRoutineName,
        editingRoutineId,
        expandedRoutineId, handleRoutineClick,
        routineExercises,
        routines, library,
        handleSave, handleCancelEdit, handleEditClick, handleDelete,
        handleAddExerciseToRoutine, handleUpdateSetsCount, handleUpdateReps,
        handleUpdateTechnique,
        handleRemoveExerciseFromRoutine, moveExercise
    } = useTrainingRoutines();

    const editMuscles: string[] = [];
    const editSecMuscles: string[] = [];
    routineExercises.forEach((ex: any) => {
        const libDef = library.find(l => l.id === ex.exId);
        if (libDef) {
            if (libDef.muscles) {
                libDef.muscles.forEach((mId: string) => editMuscles.push(mId));
            }
            if (libDef.secondaryMuscles) {
                libDef.secondaryMuscles.forEach((mId: string) => editSecMuscles.push(mId));
            }
        }
    });

    return (
        <div className="training-sub-view active">
            <RoutineEditor
                routineName={routineName}
                setRoutineName={setRoutineName}
                editingRoutineId={editingRoutineId}
                routineExercises={routineExercises}
                library={library}
                editMuscles={editMuscles}
                editSecMuscles={editSecMuscles}
                onAddExercise={handleAddExerciseToRoutine}
                onMoveExercise={moveExercise}
                onRemoveExercise={handleRemoveExerciseFromRoutine}
                onUpdateSetsCount={handleUpdateSetsCount}
                onUpdateReps={handleUpdateReps}
                onUpdateTechnique={handleUpdateTechnique}
                onSave={handleSave}
                onCancel={handleCancelEdit}
            />

            <h3 className="mt-20">Archivio schede ({routines.length})</h3>
            <p className="text-muted text-sm">Clicca su una scheda per vederne i dettagli.</p>
            {routines.length === 0 ? (
                <p className="text-muted">Nessuna scheda creata.</p>
            ) : (
                <div className="flex-col gap-8">
                    {routines.map(rtn => (
                        <RoutineCard
                            key={rtn.id}
                            routine={rtn}
                            isExpanded={expandedRoutineId === rtn.id}
                            library={library}
                            onToggleExpand={handleRoutineClick}
                            onEdit={handleEditClick}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrainingRoutines;
