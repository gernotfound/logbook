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
            <div className="card" style={editingRoutineId ? { border: '2px solid var(--primary-color)' } : undefined}>
                <h3 style={{ color: editingRoutineId ? 'var(--primary-color)' : 'white' }}>
                    {editingRoutineId ? 'Modifica Scheda' : 'Crea Nuova Scheda'}
                </h3>
                <input 
                    type="text" 
                    placeholder="Nome Scheda (es. Push Day, Full Body)" 
                    value={routineName}
                    onChange={e => setRoutineName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                />

                <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
                    {routineExercises.length > 0 && (
                        <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'center', width: '100%' }}>
                            <MuscleModel 
                                selectedMuscles={Array.from(new Set(editMuscles)) as string[]} 
                                secondaryMuscles={Array.from(new Set(editSecMuscles)) as string[]} 
                            />
                        </div>
                    )}
                    <div style={{ marginBottom: '15px' }}>
                        <select 
                            onChange={(e) => {
                                handleAddExerciseToRoutine(e.target.value);
                                e.target.value = '';
                            }}
                            style={{ width: '100%', padding: '10px', background: 'var(--surface-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px' }}
                        >
                            <option value="">+ Aggiungi Esercizio dalla Libreria</option>
                            {library.map(l => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                    </div>

                    {routineExercises.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '15px' }}>Nessun esercizio presente. Aggiungine uno dalla libreria!</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '15px' }}>
                            {routineExercises.map((ex: any, index: number) => {
                                const libDef = library.find(l => l.id === ex.exId);
                                return (
                                    <div key={index} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', gap: '10px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                            <div style={{ fontSize: '0.95rem', flex: 1 }}>
                                                {index + 1}. {libDef ? libDef.name : 'Esercizio Rimosso'}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem' }}>
                                                <label style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Serie:</label>
                                                <input 
                                                    type="number" min="1" max="20"
                                                    value={ex.setsCount || 3}
                                                    onChange={e => handleUpdateSetsCount(index, parseInt(e.target.value) || 3)}
                                                    style={{ width: '50px', margin: 0, padding: '4px', textAlign: 'center' }}
                                                    onClick={e => e.stopPropagation()}
                                                />
                                            </div>
                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                <button className="btn-icon" disabled={index === 0} style={{ opacity: index === 0 ? 0.3 : 1 }} onClick={() => moveExercise(index, -1)}>⬆️</button>
                                                <button className="btn-icon" disabled={index === routineExercises.length - 1} style={{ opacity: index === routineExercises.length - 1 ? 0.3 : 1 }} onClick={() => moveExercise(index, 1)}>⬇️</button>
                                                <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => handleRemoveExerciseFromRoutine(index)}>❌</button>
                                            </div>
                                        </div>
                                        {libDef?.trackingType !== 'time' && (
                                            <div style={{ display: 'flex', gap: '10px', fontSize: '0.8rem', alignItems: 'center' }}>
                                                <label style={{ color: 'var(--text-muted)' }}>Rep min:</label>
                                                <input type="number" placeholder="es. 8" value={ex.minReps || ''} onChange={e => handleUpdateReps(index, 'minReps', e.target.value)} style={{ width: '60px', margin: 0, padding: '4px', textAlign: 'center' }} />
                                                <label style={{ color: 'var(--text-muted)', marginLeft: '10px' }}>Rep max:</label>
                                                <input type="number" placeholder="es. 12" value={ex.maxReps || ''} onChange={e => handleUpdateReps(index, 'maxReps', e.target.value)} style={{ width: '60px', margin: 0, padding: '4px', textAlign: 'center' }} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    {editingRoutineId && (
                        <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={handleCancelEdit}>
                            Annulla
                        </button>
                    )}
                    <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave}>
                        {editingRoutineId ? '💾 Salva Modifiche' : '➕ Salva Nuova Scheda'}
                    </button>
                </div>
            </div>

            <h3 style={{ marginTop: '20px' }}>Archivio Schede ({routines.length})</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Clicca su una scheda per vederne i dettagli.</p>
            {routines.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessuna scheda creata.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {routines.map(rtn => {
                        const isExpanded = expandedRoutineId === rtn.id;
                        return (
                            <div 
                                key={rtn.id} 
                                className="card" 
                                style={{ padding: '15px', marginBottom: 0 }}
                            >
                                <div 
                                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                                    onClick={() => handleRoutineClick(rtn.id)}
                                >
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: isExpanded ? 'var(--primary-color)' : 'white' }}>
                                            {rtn.name}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                            {(rtn.exercises || []).length} esercizi
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <button className="btn-icon" style={{ color: 'var(--primary-color)' }} onClick={(e) => { e.stopPropagation(); handleEditClick(rtn); }}>✏️</button>
                                        <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={(e) => handleDelete(rtn.id, e)}>🗑️</button>
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
                                        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
                                            {(rtn.exercises || []).length > 0 && (
                                                <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'center', width: '100%' }}>
                                                    <MuscleModel 
                                                        selectedMuscles={Array.from(new Set(muscles)) as string[]} 
                                                        secondaryMuscles={Array.from(new Set(secMuscles)) as string[]} 
                                                    />
                                                </div>
                                            )}
                                            
                                            {(rtn.exercises || []).length === 0 ? (
                                                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Nessun esercizio presente.</p>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {(rtn.exercises || []).map((ex: { exId: string, setsCount?: number, minReps?: number | string, maxReps?: number | string }, index: number) => {
                                                        const libDef = library.find(l => l.id === ex.exId);
                                                        return (
                                                            <div key={index} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', gap: '10px' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                                                    <div style={{ fontSize: '0.95rem', flex: 1 }}>
                                                                        {index + 1}. {libDef ? libDef.name : 'Esercizio Rimosso'}
                                                                    </div>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                                        {ex.setsCount || 3} serie
                                                                    </div>
                                                                </div>
                                                                {(ex.minReps || ex.maxReps) && (
                                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
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
