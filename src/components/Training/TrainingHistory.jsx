import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const TrainingHistory = () => {
    const { userData, saveUserData } = useAuth();
    
    const history = [...(userData?.history || [])].sort((a,b) => (b.globalStartTime || 0) - (a.globalStartTime || 0));

    const deleteWorkout = (id) => {
        if (confirm("Eliminare definitivamente questo allenamento dallo storico?")) {
            const updatedHistory = (userData.history || []).filter(w => w.id !== id);
            saveUserData({ ...userData, history: updatedHistory });
        }
    };

    return (
        <div className="training-sub-view active">
            <h3 style={{ marginBottom: '20px' }}>Storico Allenamenti</h3>

            {history.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessun allenamento registrato.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {history.map(wo => {
                        const date = new Date(wo.globalStartTime).toLocaleDateString('it-IT', { 
                            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' 
                        });
                        const duration = (wo.globalEndTime && wo.globalStartTime) 
                            ? Math.round((wo.globalEndTime - wo.globalStartTime) / 60000) 
                            : 0;
                        
                        // Legacy compatibility: support both moodRating and mood field names
                        const moodVal = wo.moodRating ?? wo.mood;
                        const pumpVal = wo.pumpRating ?? wo.pump;
                        const fatigueVal = wo.fatigueRating ?? wo.fatigue;
                        const hasRatings = moodVal || pumpVal || fatigueVal;
                        
                        return (
                            <div key={wo.id} className="card" style={{ marginBottom: 0, borderLeft: '4px solid var(--primary-dark)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                    <div>
                                        <h4 style={{ margin: 0 }}>{wo.routineName || 'Sessione Personalizzata'}</h4>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{date}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <div className="badge badge-primary">{duration} min</div>
                                        <button 
                                            className="btn-icon" 
                                            style={{ color: 'var(--danger-color)' }} 
                                            onClick={() => deleteWorkout(wo.id)}
                                        >🗑️</button>
                                    </div>
                                </div>

                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                                    {wo.exercises?.length || 0} Esercizi completati
                                    {wo.waterLiters > 0 && <span style={{ marginLeft: '15px', color: 'var(--primary-color)' }}>💧 {wo.waterLiters}L</span>}
                                </div>

                                {/* Exercise details */}
                                {(wo.exercises || []).length > 0 && (
                                    <div style={{ marginBottom: '10px' }}>
                                        {(wo.exercises || []).map((ex, exIdx) => {
                                            const libDef = (userData?.library || []).find(l => l.id === ex.exId);
                                            const exName = libDef ? libDef.name : (ex.name || 'Esercizio Rimosso');
                                            const totalSets = (ex.sets || []).length;
                                            const validSets = (ex.sets || []).filter(s => s.kg || s.reps);
                                            return (
                                                <div key={exIdx} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                                    <span style={{ color: 'var(--text-main)', fontWeight: '500' }}>{exName}</span>
                                                    {validSets.length > 0 && (
                                                        <span> — {validSets.map((s, si) => `${s.kg || '?'}kg×${s.reps || '?'}`).join(', ')}</span>
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
