import React from 'react';
import { Plus, Search, X } from 'lucide-react';
import { useTrainingRoutines } from '../../hooks/useTrainingRoutines';
import { RoutineEditor } from './routines/RoutineEditor';
import { RoutineCard } from './routines/RoutineCard';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { ownerUiPreferenceKey } from '../../lib/uiPreferenceKeys';
import { storageOwner } from '../../lib/sync/session';
import { z } from '../../lib/zod';
import type { WorkoutRoutine } from '../../types';
import './routines/routines.css';

const TrainingRoutines: React.FC = () => {
    const [isCreating, setIsCreating] = useLocalStorage<boolean>(ownerUiPreferenceKey(storageOwner(), 'creating-routine'), false, z.boolean());
    const [isSaving, setIsSaving] = React.useState(false);
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

    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('it');
    const filteredRoutines = React.useMemo(
        () => routines.filter(routine => (
            !normalizedQuery || routine.name.toLocaleLowerCase('it').includes(normalizedQuery)
        )),
        [normalizedQuery, routines],
    );

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
                            if (handleCancelEdit()) setIsCreating(false);
                        }}
                    />
                </section>
            ) : (
                <>
                    <div className="routine-library-search">
                        <Search size={18} aria-hidden="true" />
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={event => setSearchQuery(event.target.value)}
                            placeholder="Cerca scheda per nome"
                            aria-label="Cerca scheda per nome"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                className="routine-search-clear"
                                onClick={() => setSearchQuery('')}
                                aria-label="Cancella ricerca"
                            >
                                <X size={18} aria-hidden="true" />
                            </button>
                        )}
                    </div>

                    <div className="routine-section-head">
                        <h3>Libreria schede</h3>
                        <span>{filteredRoutines.length} {filteredRoutines.length === 1 ? 'scheda' : 'schede'}</span>
                    </div>

                    {routines.length === 0 ? (
                        <div className="routine-empty-state">Nessuna scheda creata.</div>
                    ) : filteredRoutines.length === 0 ? (
                        <div className="routine-empty-state">Nessuna scheda trovata.</div>
                    ) : (
                        <div className="routine-library-list" aria-live="polite">
                            {filteredRoutines.map(rtn => (
                                <RoutineCard
                                    key={rtn.id}
                                    routine={rtn}
                                    isExpanded={expandedRoutineId === rtn.id}
                                    library={library}
                                    libraryById={libraryById}
                                    isCreating={isCreating}
                                    onToggleExpand={handleRoutineClick}
                                    onEdit={handleEditItem}
                                    onDuplicate={handleDuplicate}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default TrainingRoutines;
