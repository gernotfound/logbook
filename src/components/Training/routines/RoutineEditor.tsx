import React from 'react';
import { Pencil, Save, Plus } from 'lucide-react';
import MuscleModel from '../MuscleModel';
import { RoutineExerciseItem } from './RoutineExerciseItem';
import { ExerciseSearchDropdown } from '../ExerciseSearchDropdown';
import { ExerciseLibraryItem } from '../../../types';

interface RoutineEditorProps {
    routineName: string;
    setRoutineName: (name: string) => void;
    editingRoutineId: string | null;
    routineExercises: any[];
    library: ExerciseLibraryItem[];
    editMuscles: string[];
    editSecMuscles: string[];
    onAddExercise: (exId: string) => void;
    onMoveExercise: (index: number, direction: number) => void;
    onRemoveExercise: (index: number) => void;
    onUpdateSetsCount: (index: number, value: string) => void;
    onUpdateReps: (index: number, field: 'minReps' | 'maxReps', value: string) => void;
    onUpdateSetPlan: (exerciseIndex: number, setIndex: number, tech: import('../../../types').SetTechnique) => void;
    onUpdateSetPlanField: (exerciseIndex: number, setIndex: number, field: 'restSeconds' | 'segmentCount' | 'targetReps', value: string) => void;
    onUpdateExerciseMetadata: (exerciseIndex: number, field: 'technicalStandard' | keyof import('../../../types').ProgressionContract, value: string) => void;
    onSave: () => void;
    onCancel: () => void;
    isSaving?: boolean;
}

export const RoutineEditor: React.FC<RoutineEditorProps> = ({
    routineName,
    setRoutineName,
    editingRoutineId,
    routineExercises,
    library,
    editMuscles,
    editSecMuscles,
    onAddExercise,
    onMoveExercise,
    onRemoveExercise,
    onUpdateSetsCount,
    onUpdateReps,
    onUpdateSetPlan,
    onUpdateSetPlanField,
    onUpdateExerciseMetadata,
    onSave,
    onCancel,
    isSaving
}) => {
    return (
        <div>
            <div className="routine-editor-head">
                <h2 className="routine-editor-title">{editingRoutineId ? <><Pencil size={20} aria-hidden="true" /> Modifica scheda</> : <><Plus size={20} aria-hidden="true" /> Crea scheda</>}</h2>
                <button
                    type="button"
                    className="btn routine-editor-close"
                    onClick={onCancel}
                    disabled={isSaving}
                >
                    Chiudi
                </button>
            </div>

            <div className="routine-editor-field">
                <label htmlFor="routine-name">Nome scheda</label>
                <input
                    id="routine-name"
                    className="routine-name-input"
                    type="text"
                    placeholder="Nome scheda"
                    value={routineName}
                    onChange={event => setRoutineName(event.target.value)}
                    onFocus={event => event.target.select()}
                />
            </div>

            <div className="routine-editor-field">
                <label>Aggiungi esercizio</label>
                <div className="routine-editor-search">
                    <ExerciseSearchDropdown
                        library={library}
                        onSelectExercise={onAddExercise}
                        placeholder="Cerca esercizi da aggiungere"
                    />
                </div>
            </div>

            <div className="routine-editor-section-head">
                <h3>Esercizi nella scheda</h3>
                <span>{routineExercises.length}</span>
                <span className="routine-editor-count-assistive" aria-hidden="true">
                    Esercizi nella scheda ({routineExercises.length})
                </span>
            </div>

            <div className="routine-editor-muscle-map">
                <MuscleModel
                    selectedMuscles={Array.from(new Set(editMuscles)) as string[]}
                    secondaryMuscles={Array.from(new Set(editSecMuscles)) as string[]}
                />
            </div>

            <div className="routine-editor-list">
                {routineExercises.length === 0 ? (
                    <div className="routine-empty-state">Nessun esercizio presente.</div>
                ) : (
                    routineExercises.map((exercise: any, index: number) => {
                        const libraryItem = library.find(item => item.id === exercise.exId);
                        return (
                            <RoutineExerciseItem
                                key={index}
                                exercise={exercise}
                                index={index}
                                totalExercises={routineExercises.length}
                                libDef={libraryItem}
                                onMove={onMoveExercise}
                                onRemove={onRemoveExercise}
                                onUpdateSetsCount={onUpdateSetsCount}
                                onUpdateReps={onUpdateReps}
                                onUpdateSetPlan={onUpdateSetPlan}
                                onUpdateSetPlanField={onUpdateSetPlanField}
                                onUpdateExerciseMetadata={onUpdateExerciseMetadata}
                            />
                        );
                    })
                )}
            </div>

            <div className="routine-editor-actions">
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onCancel}
                    disabled={isSaving}
                >
                    Annulla
                </button>
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onSave}
                    disabled={isSaving}
                >
                    {isSaving ? 'Salvataggio...' : (editingRoutineId ? <><Save size={16} aria-hidden="true" /> Salva modifiche</> : 'Salva')}
                </button>
            </div>
        </div>
    );
};
