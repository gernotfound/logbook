import MuscleModel from './MuscleModel';
import { useTrainingRoutines } from '../../hooks/useTrainingRoutines';

const TrainingRoutines = () => {
    const {
        routineName, setRoutineName,
        editingRoutineId,
        expandedRoutineId, handleRoutineClick,
        routineExercises,
        routines, library,
        handleSave, handleCancelEdit, handleEditClick, handleDelete,
        handleAddExerciseToRoutine, handleUpdateSetsCount, handleUpdateReps,
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
            <div className={`card ${editingRoutineId ? 'border-primary' : ''}`}>
                <h3 className={editingRoutineId ? 'text-primary' : 'text-white'}>
                    {editingRoutineId ? 'Modifica Scheda' : 'Crea Nuova Scheda'}
                </h3>
                <input 
                    type="text" 
                    placeholder="Nome Scheda (es. Push Day, Full Body)" 
                    value={routineName}
                    onChange={e => setRoutineName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                />

                <div className="mt-15 pt-15 border-t">
                    <div className="mb-15 flex-center w-full">
                        <MuscleModel 
                            selectedMuscles={Array.from(new Set(editMuscles)) as string[]} 
                            secondaryMuscles={Array.from(new Set(editSecMuscles)) as string[]} 
                        />
                    </div>
                    <div className="mb-15">
                        <select 
                            onChange={(e) => {
                                handleAddExerciseToRoutine(e.target.value);
                                e.target.value = '';
                            }}
                            className="w-full p-10 bg-surface text-white border-b rounded-8"
                        >
                            <option value="">+ Aggiungi Esercizio dalla Libreria</option>
                            {library.map(l => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                    </div>

                    {routineExercises.length === 0 ? (
                        <p className="text-muted text-md mb-15">Nessun esercizio presente. Aggiungine uno dalla libreria!</p>
                    ) : (
                        <div className="flex-col gap-8 mb-15">
                            {routineExercises.map((ex: any, index: number) => {
                                const libDef = library.find(l => l.id === ex.exId);
                                return (
                                    <div key={index} className="flex-col bg-card-inner p-10 rounded-8 gap-8">
                                        <div className="flex-between gap-10 items-center">
                                            <div className="text-md font-semibold flex-1">
                                                {index + 1}. {libDef ? libDef.name : 'Esercizio Rimosso'}
                                            </div>
                                            <div className="flex gap-4">
                                                <button className="btn-icon" disabled={index === 0} style={{ opacity: index === 0 ? 0.3 : 1 }} onClick={() => moveExercise(index, -1)}>⬆️</button>
                                                <button className="btn-icon" disabled={index === routineExercises.length - 1} style={{ opacity: index === routineExercises.length - 1 ? 0.3 : 1 }} onClick={() => moveExercise(index, 1)}>⬇️</button>
                                                <button className="btn-icon text-danger" onClick={() => handleRemoveExerciseFromRoutine(index)}>❌</button>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-12 flex-wrap text-sm">
                                            <div className="flex items-center gap-5">
                                                <label className="text-muted white-space-nowrap text-xs font-semibold">Serie:</label>
                                                <input 
                                                    type="number" min="1" max="20"
                                                    value={ex.setsCount || 3}
                                                    onChange={e => handleUpdateSetsCount(index, parseInt(e.target.value) || 3)}
                                                    className="input-compact w-50"
                                                    onClick={e => e.stopPropagation()}
                                                />
                                            </div>
                                            {libDef?.trackingType !== 'time' ? (
                                                <div className="flex items-center gap-8">
                                                    <div className="flex items-center gap-5">
                                                        <label className="text-muted white-space-nowrap text-xs font-semibold">Rep min:</label>
                                                        <input 
                                                            type="number" 
                                                            placeholder="es. 8" 
                                                            value={ex.minReps || ''} 
                                                            onChange={e => handleUpdateReps(index, 'minReps', e.target.value)} 
                                                            className="input-compact w-60" 
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-5">
                                                        <label className="text-muted white-space-nowrap text-xs font-semibold">Rep max:</label>
                                                        <input 
                                                            type="number" 
                                                            placeholder="es. 12" 
                                                            value={ex.maxReps || ''} 
                                                            onChange={e => handleUpdateReps(index, 'maxReps', e.target.value)} 
                                                            className="input-compact w-60" 
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-muted text-xs italic">Tracciamento a tempo</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex gap-10 mt-10">
                    {editingRoutineId && (
                        <button className="btn flex-1" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={handleCancelEdit}>
                            Annulla
                        </button>
                    )}
                    <button className="btn btn-primary flex-2" onClick={handleSave}>
                        {editingRoutineId ? '💾 Salva Modifiche' : '➕ Salva Nuova Scheda'}
                    </button>
                </div>
            </div>

            <h3 className="mt-20">Archivio Schede ({routines.length})</h3>
            <p className="text-muted text-sm">Clicca su una scheda per vederne i dettagli.</p>
            {routines.length === 0 ? (
                <p className="text-muted">Nessuna scheda creata.</p>
            ) : (
                <div className="flex-col gap-10">
                    {routines.map(rtn => {
                        const isExpanded = expandedRoutineId === rtn.id;
                        return (
                            <div 
                                key={rtn.id} 
                                className="card p-15 mb-0"
                            >
                                <div 
                                    className="flex-between cursor-pointer"
                                    onClick={() => handleRoutineClick(rtn.id)}
                                >
                                    <div>
                                        <div className={`font-bold text-lg ${isExpanded ? 'text-primary' : 'text-white'}`}>
                                            {rtn.name}
                                        </div>
                                        <div className="text-muted text-sm mt-4">
                                            {(rtn.exercises || []).length} esercizi
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-10">
                                        <button className="btn-icon text-primary" onClick={(e) => { e.stopPropagation(); handleEditClick(rtn); }}>✏️</button>
                                        <button className="btn-icon text-danger" onClick={(e) => handleDelete(rtn.id, e)}>🗑️</button>
                                    </div>
                                </div>

                                {isExpanded && (() => {
                                    const muscles: string[] = [];
                                    const secMuscles: string[] = [];
                                    (rtn.exercises || []).forEach((ex: any) => {
                                        const libDef = library.find(l => l.id === ex.exId);
                                        if (libDef) {
                                            if (libDef.muscles) {
                                                libDef.muscles.forEach((mId: string) => muscles.push(mId));
                                            }
                                            if (libDef.secondaryMuscles) {
                                                libDef.secondaryMuscles.forEach((mId: string) => secMuscles.push(mId));
                                            }
                                        }
                                    });

                                    return (
                                        <div className="mt-15 pt-15 border-t">
                                            {(rtn.exercises || []).length > 0 && (
                                                <div className="mb-15 flex-center w-full">
                                                    <MuscleModel 
                                                        selectedMuscles={Array.from(new Set(muscles)) as string[]} 
                                                        secondaryMuscles={Array.from(new Set(secMuscles)) as string[]} 
                                                    />
                                                </div>
                                            )}
                                            
                                            {(rtn.exercises || []).length === 0 ? (
                                                <p className="text-muted text-md">Nessun esercizio presente.</p>
                                            ) : (
                                                <div className="flex-col gap-8">
                                                    {(rtn.exercises || []).map((ex: { exId: string, setsCount?: number, minReps?: number | string, maxReps?: number | string }, index: number) => {
                                                        const libDef = library.find(l => l.id === ex.exId);
                                                        return (
                                                            <div key={index} className="flex-col bg-card-inner p-10 rounded-8 gap-10">
                                                                <div className="flex-between gap-10">
                                                                    <div className="text-md flex-1">
                                                                        {index + 1}. {libDef ? libDef.name : 'Esercizio Rimosso'}
                                                                    </div>
                                                                    <div className="flex items-center gap-5 text-sm text-muted">
                                                                        {ex.setsCount || 3} serie
                                                                    </div>
                                                                </div>
                                                                {(ex.minReps || ex.maxReps) && (
                                                                    <div className="text-sm text-muted">
                                                                        Rep min: {ex.minReps || '-'} | Rep max: {ex.maxReps || '-'}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TrainingRoutines;
