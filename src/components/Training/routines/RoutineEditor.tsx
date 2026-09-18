import React from 'react';
import { Pencil, Save, Plus } from 'lucide-react';
import MuscleModel from '../MuscleModel';
import { RoutineExerciseItem } from './RoutineExerciseItem';
import { ExerciseSearchDropdown } from './ExerciseSearchDropdown';
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
    onUpdateTechnique: (index: number, tech: 'dropset' | 'isometrics') => void;
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
    onUpdateTechnique,
    onSave,
    onCancel,
    isSaving
}) => {
    return (
        <div className="section-divider">
            <h2 style={{marginTop: 0}}>{editingRoutineId ? <><Pencil size={20} aria-hidden="true" /> Modifica scheda</> : <><Plus size={20} aria-hidden="true" /> Crea scheda</>}</h2>

            <div className="mb-15">
                <input
                    type="text"
                    placeholder="Nome scheda"
                    value={routineName}
                    onChange={e => setRoutineName(e.target.value)}
                    onFocus={e => e.target.select()}

                 className="text-base"/>
            </div>

            <div className="mb-15">
                <ExerciseSearchDropdown
                    library={library}
                    onSelectExercise={onAddExercise}
                    placeholder="Cerca esercizi da aggiungere"
                />
            </div>

            <div className="flex-between items-center mb-10">
                <label className="text-muted text-xs block">Esercizi nella scheda ({routineExercises.length})</label>
            </div>

            {/* MuscleModel rimane sempre visibile anche con lista esercizi vuota */}
            <div className="mb-15 flex-center w-full">
                <MuscleModel
                    selectedMuscles={Array.from(new Set(editMuscles)) as string[]}
                    secondaryMuscles={Array.from(new Set(editSecMuscles)) as string[]}
                />
            </div>

            <div className="mb-15">
                {routineExercises.length === 0 ? (
                    <p className="text-muted text-md mb-15">Nessun esercizio presente. Aggiungine uno dalla libreria!</p>
                ) : (
                    <div className="flex-col gap-10 mb-15">
                        {routineExercises.map((ex: any, index: number) => {
                            const libDef = library.find(l => l.id === ex.exId);
                            return (
                                <RoutineExerciseItem
                                    key={index}
                                    exercise={ex}
                                    index={index}
                                    totalExercises={routineExercises.length}
                                    libDef={libDef}
                                    onMove={onMoveExercise}
                                    onRemove={onRemoveExercise}
                                    onUpdateSetsCount={onUpdateSetsCount}
                                    onUpdateReps={onUpdateReps}
                                    onUpdateTechnique={onUpdateTechnique}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex gap-10 mt-10" style={{ width: '100%', minWidth: 0 }}>
                <button
                    type="button"
                    className="btn flex-1 mb-0"
                    style={{ background: 'var(--surface-light)', whiteSpace: 'nowrap', margin: 0 }}
                    onClick={onCancel}
                    disabled={isSaving}
                >
                    Annulla
                </button>
                <button
                    type="button"
                    className="btn btn-primary flex-1 mb-0"
                    style={{ whiteSpace: 'nowrap', margin: 0 }}
                    onClick={onSave}
                    disabled={isSaving}
                >
                    {isSaving ? 'Salvataggio...' : (editingRoutineId ? <><Save size={16} aria-hidden="true" /> Salva modifiche</> : 'Crea scheda')}
                </button>
            </div>
        </div>
    );
};
