import React from 'react';
import { Plus } from 'lucide-react';
import { useTrainingRoutines } from '../../hooks/useTrainingRoutines';
import { RoutineEditor } from './routines/RoutineEditor';
import { RoutineLibraryList } from './routines/RoutineLibraryList';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { ownerUiPreferenceKey } from '../../lib/uiPreferenceKeys';
import { storageOwner } from '../../lib/sync/session';
import { z } from '../../lib/zod';
import type { WorkoutRoutine } from '../../types';
import './routines/routines.css';

const TrainingRoutines: React.FC = () => {
    const [isCreating, setIsCreating] = useLocalStorage<boolean>(ownerUiPreferenceKey(storageOwner(), 'creating-routine'), false, z.boolean());
    const [isSaving, setIsSaving] = React.useState(false);
    // A second click can enter before React renders the disabled save button.
    const saveInFlight = React.useRef(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const {
        routineName, setRoutineName,
        editingRoutineId,
        expandedRoutineId, handleRoutineClick,
        routineExercises,
        routines, library,
        handleSave, handleCancelEdit, handleEditClick, handleDelete, handleDuplicate,
        handleAddExerciseToRoutine, handleUpdateSetsCount, handleUpdateReps,
        handleUpdateSetPlan, handleUpdateSetPlanField, handleUpdateExerciseMetadata,
        handleRemoveExerciseFromRoutine, moveExercise
    } = useTrainingRoutines();

    const libraryById = React.useMemo(
        () => new Map(library.map(exercise => [exercise.id, exercise] as const)),
        [library],
    );
    const editorOpen = isCreating || Boolean(editingRoutineId);
    const { editMuscles, editSecMuscles } = React.useMemo(() => {
        const editMuscles: string[] = [];
        const editSecMuscles: string[] = [];
        if (editorOpen) {
            for (const exercise of routineExercises) {
                const definition = libraryById.get(exercise.exId);
                if (!definition) continue;
                editMuscles.push(...(definition.muscles ?? []));
                editSecMuscles.push(...(definition.secondaryMuscles ?? []));
            }
        }
        return { editMuscles, editSecMuscles };
    }, [editorOpen, routineExercises, libraryById]);

    const handleEditItem = (rtn: WorkoutRoutine) => {
        setIsCreating(false);
        handleEditClick(rtn);
    };

    return (
        <div className="training-sub-view active training-routines-page">
            <header className="routine-library-header">
                <h2>Schede</h2>
                {!editorOpen && (
                    <button
                        type="button"
                        className="btn btn-primary routine-create-button"
                        onClick={() => setIsCreating(true)}
                        aria-label="Crea scheda"
                        disabled={isSaving}
                    >
                        <Plus size={18} aria-hidden="true" />
                        <span>Crea</span>
                    </button>
                )}
            </header>

            {editorOpen ? (
                <section id="routine-creation-form" className="routine-editor-shell">
                    <RoutineEditor
                        routineName={routineName}
                        setRoutineName={setRoutineName}
                        editingRoutineId={editingRoutineId}
                        routineExercises={routineExercises}
                        library={library}
                        libraryById={libraryById}
                        editMuscles={editMuscles}
                        editSecMuscles={editSecMuscles}
                        onAddExercise={handleAddExerciseToRoutine}
                        onMoveExercise={moveExercise}
                        onRemoveExercise={handleRemoveExerciseFromRoutine}
                        onUpdateSetsCount={handleUpdateSetsCount}
                        onUpdateReps={handleUpdateReps}
                        onUpdateSetPlan={handleUpdateSetPlan}
                        onUpdateSetPlanField={handleUpdateSetPlanField}
                        onUpdateExerciseMetadata={handleUpdateExerciseMetadata}
                        isSaving={isSaving}
                        onSave={async () => {
                            if (saveInFlight.current) return;
                            saveInFlight.current = true;
                            setIsSaving(true);
                            try {
                                const success = await handleSave();
                                if (success) setIsCreating(false);
                            } finally {
                                saveInFlight.current = false;
                                setIsSaving(false);
                            }
                        }}
                        onCancel={() => {
                            if (saveInFlight.current) return;
                            if (handleCancelEdit()) setIsCreating(false);
                        }}
                    />
                </section>
            ) : (
                <>
                    <RoutineLibraryList
                        routines={routines}
                        library={library}
                        libraryById={libraryById}
                        expandedRoutineId={expandedRoutineId}
                        onToggleExpand={handleRoutineClick}
                        searchQuery={searchQuery}
                        onSearchQueryChange={setSearchQuery}
                        onEdit={handleEditItem}
                        onDuplicate={handleDuplicate}
                        onDelete={handleDelete}
                    />
                </>
            )}
        </div>
    );
};

export default TrainingRoutines;
