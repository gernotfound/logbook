import React from 'react';
import { useTrainingRoutines } from '../../hooks/useTrainingRoutines';
import { RoutineEditor } from './routines/RoutineEditor';
import { RoutineCard } from './routines/RoutineCard';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { z } from '../../lib/zod';
import { Plus, Minus } from 'lucide-react';

const TrainingRoutines: React.FC = () => {
    const [isCreating, setIsCreating] = useLocalStorage<boolean>('logbook_creating_routine', false, z.boolean());
    const [isSaving, setIsSaving] = React.useState(false);
    const {
        routineName, setRoutineName,
        editingRoutineId,
        expandedRoutineId, handleRoutineClick,
        routineExercises,
        routines, library,
        handleSave, handleCancelEdit, handleEditClick, handleDelete, handleDuplicate,
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

    const handleEditItem = (rtn: any) => {
        setIsCreating(false);
        handleEditClick(rtn);
    };

    return (
        <div className="training-sub-view active">
            {!editingRoutineId && (
                <div className="mb-20">
                    <button 
                        type="button" 
                        className="btn btn-primary w-full flex-center"
                        style={{ gap: '8px' }}
                        onClick={() => {
                            if (isCreating) {
                                handleCancelEdit();
                                setIsCreating(false);
                            } else {
                                setIsCreating(true);
                            }
                        }}
                        aria-expanded={isCreating}
                        aria-controls="routine-creation-form"
                        disabled={isSaving}
                    >
                        {isCreating ? <Minus size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
                        Crea scheda
                    </button>
                </div>
            )}

            {(isCreating || editingRoutineId) && (
                <div id="routine-creation-form" className={editingRoutineId ? 'border-primary' : 'border-glass p-15 rounded-12 mb-20'}>
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
                        onSave={async () => {
                            if (isSaving) return;
                            setIsSaving(true);
                            try {
                                const success = await handleSave();
                                if (success) setIsCreating(false);
                            } finally {
                                setIsSaving(false);
                            }
                        }}
                        onCancel={() => {
                            handleCancelEdit();
                            setIsCreating(false);
                        }}
                    />
                </div>
            )}

            <h2 className="mt-20">Archivio schede ({routines.length})</h2>
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
                            isCreating={isCreating}
                            onToggleExpand={handleRoutineClick}
                            onEdit={handleEditItem}
                            onDuplicate={handleDuplicate}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrainingRoutines;
