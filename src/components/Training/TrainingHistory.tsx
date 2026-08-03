import { useMemo } from 'react';
import { useTrainingHistory } from '../../hooks/useTrainingHistory';
import type { WorkoutSession } from '../../types';

interface TrainingHistoryProps {
    onEditWorkout?: (workout: WorkoutSession) => void;
}

const TrainingHistory = ({ onEditWorkout }: TrainingHistoryProps) => {
    const { userData, history, deleteWorkout } = useTrainingHistory();

    const libraryMap = useMemo(() => {
        const map = new Map<string, any>();
        if (userData?.library) {
            userData.library.forEach(l => map.set(l.id, l));
        }
        return map;
    }, [userData?.library]);

    return (
        <div className="training-sub-view active">
            <h3 style={{ marginBottom: '20px' }}>Storico Allenamenti ({history.length})</h3>

            {history.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessun allenamento registrato.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {history.map(wo => {
                        const date = new Date(wo.globalStartTime || new Date()).toLocaleDateString('it-IT', { 
                            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' 
                        });
                        const durationDisplay = wo.manualDurationStr 
                            || wo.globalDurationStr 
                            || ((wo.globalEndTime && wo.globalStartTime) 
                                ? `${Math.round((wo.globalEndTime - wo.globalStartTime) / 60000)} min` 
                                : '0 min');
                        
                        // Legacy compatibility: support both moodRating and mood field names
                        const moodVal = wo.moodRating ?? (wo as any).mood;
                        const pumpVal = wo.pumpRating ?? (wo as any).pump;
                        const fatigueVal = wo.fatigueRating ?? (wo as any).fatigue;
                        const hasRatings = moodVal || pumpVal || fatigueVal;
                        
                        return (
                            <div key={wo.id} className="card" style={{ marginBottom: 0, borderLeft: '4px solid var(--primary-dark)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                    <div>
                                        <h4 style={{ margin: 0 }}>{wo.routineName || 'Sessione Personalizzata'}</h4>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{date}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <div className="badge badge-primary">{durationDisplay}</div>
                                        {onEditWorkout && (
                                            <button 
                                                className="btn-icon" 
                                                style={{ color: 'var(--primary-color)' }} 
                                                title="Modifica allenamento"
                                                onClick={() => onEditWorkout(wo)}
                                            >✏️</button>
                                        )}
                                        <button 
                                            className="btn-icon" 
                                            style={{ color: 'var(--danger-color)' }} 
                                            title="Elimina allenamento"
                                            onClick={() => deleteWorkout(wo.id!)}
                                        >🗑️</button>
                                    </div>
                                </div>

                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                                    {wo.exercises?.length || 0} Esercizi completati
                                    {(wo.waterLiters || 0) > 0 && <span style={{ marginLeft: '15px', color: 'var(--primary-color)' }}>💧 {wo.waterLiters}L</span>}
                                </div>

                                {/* Exercise details */}
                                {(wo.exercises || []).length > 0 && (
                                    <div style={{ marginBottom: '10px' }}>
                                        {(wo.exercises || []).map((ex: any, exIdx: number) => {
                                            const libDef = libraryMap.get(ex.exId);
                                            const exName = libDef ? libDef.name : (ex.name || 'Esercizio Rimosso');
                                            
                                            const validSets = (ex.sets || []).filter((s: any) => s.kg || s.reps || s.time);
                                            return (
                                                <div key={exIdx} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                                    <span style={{ color: 'var(--text-main)', fontWeight: '500' }}>{exName}</span>
                                                    {validSets.length > 0 && (
                                                        <span> — {validSets.map((s: any) => libDef?.trackingType === 'time' ? `${s.kg ? s.kg + 'kg ' : ''}⏱️${s.time || '?'}` : `${s.kg || '?'}kg×${s.reps || '?'}`).join(', ')}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                
                                {hasRatings && (
                                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--glass-border)', fontSize: '0.8rem' }}>
                                        {moodVal && <span className="badge badge-primary">Umore: {moodVal}/10</span>}
                                        {pumpVal && <span className="badge badge-primary">Pump: {pumpVal}/10</span>}
                                        {fatigueVal && <span className="badge badge-primary">Stanchezza: {fatigueVal}/10</span>}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    );
};

export default TrainingHistory;
