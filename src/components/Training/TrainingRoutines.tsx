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
                    />
                </div>

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
                                handleAddExerciseToRoutine(e.target.value);
                                e.target.value = '';
                            }}
                            className="w-full p-10 bg-surface text-white border-b rounded-8"
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
                                    <div key={index} className="flex-col bg-card-inner p-12 rounded-8 gap-10" style={{ border: '1px solid var(--glass-border)' }}>
                                        <div className="flex-between gap-10 items-center">
                                            <div className="text-md font-semibold flex-1">
                                                {index + 1}. {libDef ? libDef.name : 'Esercizio rimosso'}
                                            </div>
                                            <div className="flex gap-4">
                                                <button className="btn-icon" disabled={index === 0} style={{ opacity: index === 0 ? 0.3 : 1 }} onClick={() => moveExercise(index, -1)}>⬆️</button>
                                                <button className="btn-icon" disabled={index === routineExercises.length - 1} style={{ opacity: index === routineExercises.length - 1 ? 0.3 : 1 }} onClick={() => moveExercise(index, 1)}>⬇️</button>
                                                <button className="btn-icon text-danger" onClick={() => handleRemoveExerciseFromRoutine(index)}>❌</button>
                                            </div>
                                        </div>

                                        {/* Riga 1: Serie */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                                                Serie:
                                            </label>
                                            <input 
                                                type="number" min="1" max="20"
                                                placeholder="3"
                                                value={ex.setsCount !== undefined && ex.setsCount !== null ? ex.setsCount : ''}
                                                onChange={e => handleUpdateSetsCount(index, e.target.value)}
                                                onFocus={e => e.target.select()}
                                                style={{ 
                                                    width: '90px', 
                                                    height: '42px', 
                                                    minHeight: '42px', 
                                                    margin: 0, 
                                                    padding: '8px 12px',
                                                    fontSize: '1rem',
                                                    textAlign: 'center',
                                                    borderRadius: '8px',
                                                    background: 'rgba(0,0,0,0.3)',
                                                    border: '1px solid var(--glass-border)',
                                                    color: 'var(--text-main)',
                                                    boxSizing: 'border-box'
                                                }}
                                                onClick={e => e.stopPropagation()}
                                            />
                                        </div>

                                        {/* Riga 2: Rep min e Rep max */}
                                        {libDef?.trackingType !== 'time' ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                                                    Ripetizioni:
                                                </label>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                                    <input 
                                                        type="number" 
                                                        placeholder="Min (es. 8)" 
                                                        value={ex.minReps || ''} 
                                                        onChange={e => handleUpdateReps(index, 'minReps', e.target.value)} 
                                                        onFocus={e => e.target.select()}
                                                        style={{ 
                                                            flex: 1, 
                                                            minWidth: 0, 
                                                            height: '42px', 
                                                            minHeight: '42px', 
                                                            margin: 0, 
                                                            padding: '8px 8px',
                                                            fontSize: '0.95rem',
                                                            textAlign: 'center',
                                                            borderRadius: '8px',
                                                            background: 'rgba(0,0,0,0.3)',
                                                            border: '1px solid var(--glass-border)',
                                                            color: 'var(--text-main)',
                                                            boxSizing: 'border-box'
                                                        }}
                                                    />
                                                    <span style={{ color: 'var(--text-muted)', fontWeight: 'bold', fontSize: '1rem' }}>-</span>
                                                    <input 
                                                        type="number" 
                                                        placeholder="Max (es. 12)" 
                                                        value={ex.maxReps || ''} 
                                                        onChange={e => handleUpdateReps(index, 'maxReps', e.target.value)} 
                                                        onFocus={e => e.target.select()}
                                                        style={{ 
                                                            flex: 1, 
                                                            minWidth: 0, 
                                                            height: '42px', 
                                                            minHeight: '42px', 
                                                            margin: 0, 
                                                            padding: '8px 8px',
                                                            fontSize: '0.95rem',
                                                            textAlign: 'center',
                                                            borderRadius: '8px',
                                                            background: 'rgba(0,0,0,0.3)',
                                                            border: '1px solid var(--glass-border)',
                                                            color: 'var(--text-main)',
                                                            boxSizing: 'border-box'
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                                                    Tipo:
                                                </label>
                                                <span className="text-muted text-xs italic">Tracciamento a tempo</span>
                                            </div>
                                        )}

                                        {/* Riga 3: Tecniche speciali pre-attivate */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                                                Tecnica:
                                            </span>
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
                                                <button
                                                    type="button"
                                                    className={`btn btn-small ${ex.defaultTechnique === 'dropset' ? 'btn-primary' : ''}`}
                                                    style={{ 
                                                        margin: 0, 
                                                        padding: '6px 12px', 
                                                        fontSize: '0.8rem',
                                                        background: ex.defaultTechnique === 'dropset' ? 'var(--warning-color)' : 'rgba(255,255,255,0.08)',
                                                        color: ex.defaultTechnique === 'dropset' ? '#000' : 'var(--text-main)',
                                                        fontWeight: ex.defaultTechnique === 'dropset' ? 700 : 500,
                                                        border: '1px solid rgba(255,255,255,0.1)',
                                                        borderRadius: '8px'
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
                                                        padding: '6px 12px', 
                                                        fontSize: '0.8rem',
                                                        background: ex.defaultTechnique === 'isometrics' ? 'var(--accent-color)' : 'rgba(255,255,255,0.08)',
                                                        color: ex.defaultTechnique === 'isometrics' ? '#fff' : 'var(--text-main)',
                                                        fontWeight: ex.defaultTechnique === 'isometrics' ? 700 : 500,
                                                        border: '1px solid rgba(255,255,255,0.1)',
                                                        borderRadius: '8px'
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
                        {editingRoutineId ? '💾 Salva modifiche' : '➕ Salva nuova scheda'}
                    </button>
                </div>
            </div>

            <h3 className="mt-20">Archivio schede ({routines.length})</h3>
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
                                            <div className="mb-15 flex-center w-full">
                                                <MuscleModel 
                                                    selectedMuscles={Array.from(new Set(muscles)) as string[]} 
                                                    secondaryMuscles={Array.from(new Set(secMuscles)) as string[]} 
                                                />
                                            </div>
                                            
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
                                                                        {index + 1}. {libDef ? libDef.name : 'Esercizio rimosso'}
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
