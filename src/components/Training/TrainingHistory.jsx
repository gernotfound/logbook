import React from 'react';
import { useAuth } from '../../contexts/AuthContext';

const TrainingHistory = () => {
    const { userData } = useAuth();
    
    const history = [...(userData?.history || [])].sort((a,b) => (b.globalStartTime || 0) - (a.globalStartTime || 0));

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
                        const duration = Math.round((wo.globalEndTime - wo.globalStartTime) / 60000); // minutes
                        
                        return (
                            <div key={wo.id} className="card" style={{ marginBottom: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                    <div>
                                        <h4 style={{ margin: 0 }}>{wo.routineName || 'Sessione Personalizzata'}</h4>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{date}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div className="badge badge-primary">{duration} min</div>
                                    </div>
                                </div>

                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    {wo.exercises?.length || 0} Esercizi completati
                                </div>
                                
                                {(wo.mood || wo.pump || wo.fatigue) && (
                                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--glass-border)', fontSize: '0.8rem' }}>
                                        {wo.mood && <span>Umore: {wo.mood}/10</span>}
                                        {wo.pump && <span>Pump: {wo.pump}/10</span>}
                                        {wo.fatigue && <span>Stanchezza: {wo.fatigue}/10</span>}
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
