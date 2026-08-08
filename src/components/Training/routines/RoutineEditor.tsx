import React from 'react';
import MuscleModel from '../MuscleModel';
import { RoutineExerciseItem } from './RoutineExerciseItem';
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
    onCancel
}) => {
    return (
        <div className="card">
            <h3>{editingRoutineId ? '✏️ Modifica scheda' : '➕ Crea nuova scheda'}</h3>
            <p className="text-muted text-sm mb-15">Crea o modifica la tua scheda di allenamento.</p>

            <div className="mb-15">
                <label className="text-muted text-xs block mb-4">Nome scheda</label>
                <input 
                    type="text" 
                    placeholder="es. Spinta (Push), Gambe (Legs)..." 
                    value={routineName} 
                    onChange={e => setRoutineName(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ fontSize: '16px' }}
                />
            </div>

            {/* MuscleModel rimane sempre visibile anche con lista esercizi vuota */}
            <div className="mb-15 flex-center w-full">
                <MuscleModel 
                    selectedMuscles={Array.from(new Set(editMuscles)) as string[]} 
                    secondaryMuscles={Array.from(new Set(editSecMuscles)) as string[]} 
                />
            </div>

            <div className="mb-15">
                <div className="flex-between items-center mb-10">
                    <label className="text-muted text-xs block">Esercizi nella scheda ({routineExercises.length})</label>
                </div>
                <div className="mb-15">
                    <select 
                        onChange={(e) => {
                            onAddExercise(e.target.value);
                            e.target.value = '';
                        }}
                        className="w-full p-10 bg-surface text-white border-b rounded-8"
                        style={{ fontSize: '16px' }}
                    >
                        <option value="">+ Aggiungi esercizio dalla libreria</option>
                        {library.map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                    </select>
                </div>

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
                {editingRoutineId && (
                    <button 
                        type="button" 
                        className="btn flex-1 mb-0" 
                        style={{ background: 'rgba(255,255,255,0.1)', whiteSpace: 'nowrap', margin: 0 }} 
                        onClick={onCancel}
                    >
                        Annulla
                    </button>
                )}
                <button 
                    type="button" 
                    className={`btn btn-primary ${editingRoutineId ? 'flex-2' : 'w-full'} mb-0`} 
                    style={{ whiteSpace: 'nowrap', margin: 0 }} 
                    onClick={onSave}
                >
                    {editingRoutineId ? '💾 Salva modifiche' : '➕ Salva nuova scheda'}
                </button>
            </div>
        </div>
    );
};
