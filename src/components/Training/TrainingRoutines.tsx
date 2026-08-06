import MuscleModel from './MuscleModel';
import { useTrainingRoutines } from '../../hooks/useTrainingRoutines';
import { RoutineExercise } from '../../types';

const TrainingRoutines = () => {
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
            <div className="card">
                <h3>{editingRoutineId ? '✏️ Modifica Scheda' : '➕ Crea Nuova Scheda'}</h3>
                <p className="text-muted text-sm mb-15">Crea o modifica la tua scheda di allenamento.</p>

                <div className="mb-15">
                    <label className="text-muted text-xs block mb-4">Nome Scheda</label>
                    <input 
                        type="text" 
                        placeholder="es. Spinta (Push), Gambe (Legs)..." 
                        value={routineName} 
                        onChange={e => setRoutineName(e.target.value)}
                        onFocus={e => e.target.select()}
                    />
                </div>

                {routineExercises.length > 0 && (
                    <div className="mb-15 flex-center w-full">
                        <MuscleModel 
                            selectedMuscles={Array.from(new Set(editMuscles)) as string[]} 
                            secondaryMuscles={Array.from(new Set(editSecMuscles)) as string[]} 
                        />
                    </div>
                )}

                <div className="mb-15">
                    <div className="flex-between items-center mb-10">
                        <label className="text-muted text-xs block">Esercizi nella scheda ({routineExercises.length})</label>
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
                        <div className="flex-col gap-10 mb-15">
                            {routineExercises.map((ex: any, index: number) => {
                                const libDef = library.find(l => l.id === ex.exId);
                                return (
                                    <div key={index} className="flex-col bg-card-inner p-12 rounded-8 gap-10" style={{ border: '1px solid var(--glass-border)' }}>
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

                                        {/* Riga 1: Serie */}
                                        <div className="flex items-center gap-8">
                                            <label className="text-muted text-xs font-semibold" style={{ minWidth: '70px' }}>Serie:</label>
                                            <input 
                                                type="number" min="1" max="20"
                                                placeholder="3"
                                                value={ex.setsCount !== undefined && ex.setsCount !== null ? ex.setsCount : ''}
                                                onChange={e => handleUpdateSetsCount(index, e.target.value)}
                                                onFocus={e => e.target.select()}
                                                className="input-compact"
                                                style={{ width: '80px', margin: 0 }}
                                                onClick={e => e.stopPropagation()}
                                            />
                                        </div>

                                        {/* Riga 2: Rep min e Rep max */}
                                        {libDef?.trackingType !== 'time' ? (
                                            <div className="flex items-center gap-12 flex-wrap">
                                                <div className="flex items-center gap-8">
                                                    <label className="text-muted text-xs font-semibold" style={{ minWidth: '70px' }}>Rep min:</label>
                                                    <input 
                                                        type="number" 
                                                        placeholder="es. 8" 
                                                        value={ex.minReps || ''} 
                                                        onChange={e => handleUpdateReps(index, 'minReps', e.target.value)} 
                                                        onFocus={e => e.target.select()}
                                                        className="input-compact"
                                                        style={{ width: '80px', margin: 0 }}
                                                    />
                                                </div>
                                                <div className="flex items-center gap-8">
                                                    <label className="text-muted text-xs font-semibold">Rep max:</label>
                                                    <input 
                                                        type="number" 
                                                        placeholder="es. 12" 
                                                        value={ex.maxReps || ''} 
                                                        onChange={e => handleUpdateReps(index, 'maxReps', e.target.value)} 
                                                        onFocus={e => e.target.select()}
                                                        className="input-compact"
                                                        style={{ width: '80px', margin: 0 }}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-muted text-xs italic">Tracciamento a tempo</div>
                                        )}

                                        {/* Riga 3: Tecniche speciali pre-attivate */}
                                        <div className="flex items-center gap-8 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                                            <span className="text-muted text-xs font-semibold" style={{ minWidth: '70px' }}>Tecnica:</span>
                                            <div className="flex gap-6 flex-wrap">
                                                <button
                                                    type="button"
                                                    className={`btn btn-small ${ex.defaultTechnique === 'dropset' ? 'btn-primary' : ''}`}
                                                    style={{ 
                                                        margin: 0, 
                                                        padding: '4px 10px', 
                                                        fontSize: '0.75rem',
                                                        background: ex.defaultTechnique === 'dropset' ? 'var(--warning-color)' : 'rgba(255,255,255,0.08)',
                                                        color: ex.defaultTechnique === 'dropset' ? '#000' : 'var(--text-main)',
                                                        fontWeight: ex.defaultTechnique === 'dropset' ? 700 : 500,
                                                        border: '1px solid rgba(255,255,255,0.1)'
                                                    }}
                                                    onClick={() => handleUpdateTechnique(index, 'dropset')}
                                                >
                                                    🔻 Dropset {ex.defaultTechnique === 'dropset' ? '✓' : ''}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`btn btn-small ${ex.defaultTechnique === 'isometrics' ? 'btn-primary' : ''}`}
                                                    style={{ 
                                                        margin: 0, 
                                                        padding: '4px 10px', 
                                                        fontSize: '0.75rem',
                                                        background: ex.defaultTechnique === 'isometrics' ? 'var(--accent-color)' : 'rgba(255,255,255,0.08)',
                                                        color: ex.defaultTechnique === 'isometrics' ? '#fff' : 'var(--text-main)',
                                                        fontWeight: ex.defaultTechnique === 'isometrics' ? 700 : 500,
                                                        border: '1px solid rgba(255,255,255,0.1)'
                                                    }}
                                                    onClick={() => handleUpdateTechnique(index, 'isometrics')}
                                                >
                                                    ⏱️ Isometria {ex.defaultTechnique === 'isometrics' ? '✓' : ''}
                                                </button>
                                            </div>
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
                                                    {(rtn.exercises || []).map((ex: RoutineExercise, index: number) => {
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
                                                                <div className="flex items-center gap-10 flex-wrap text-sm text-muted">
                                                                    {(ex.minReps || ex.maxReps) && (
                                                                        <span>Rep min: {ex.minReps || '-'} | Rep max: {ex.maxReps || '-'}</span>
                                                                    )}
                                                                    {ex.defaultTechnique === 'dropset' && (
                                                                        <span className="badge" style={{ background: 'var(--warning-color)', color: '#000', fontWeight: 600 }}>🔻 Dropset</span>
                                                                    )}
                                                                    {ex.defaultTechnique === 'isometrics' && (
                                                                        <span className="badge" style={{ background: 'var(--accent-color)', color: '#fff', fontWeight: 600 }}>⏱️ Isometria</span>
                                                                    )}
                                                                </div>
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
