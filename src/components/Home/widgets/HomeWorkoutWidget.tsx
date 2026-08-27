import React from 'react';
import { Play, CheckCircle2 } from 'lucide-react';

interface HomeWorkoutWidgetProps {
    isRestDay?: boolean;
    todaysWorkout?: any;
    onNavigate: (view: string) => void;
}

export const HomeWorkoutWidget: React.FC<HomeWorkoutWidgetProps> = ({
    isRestDay = false,
    todaysWorkout,
    onNavigate
}) => {
    if (isRestDay) {
        return (
            <div style={{
                background: 'linear-gradient(135deg, rgba(0, 229, 255, 0.1), rgba(0, 229, 255, 0.02))',
                border: '1px solid rgba(0, 229, 255, 0.2)',
                borderRadius: '16px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: '15px'
            }}>
                <div>
                    <h2 style={{ margin: '0 0 8px 0', fontSize: '1.4rem', color: 'var(--text-main)' }}>Pronto ad allenarti?</h2>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Nessun allenamento registrato oggi.</p>
                </div>
                <button 
                    className="btn btn-primary" 
                    style={{ width: '100%', maxWidth: '280px', padding: '16px', fontSize: '1.1rem', borderRadius: '12px' }}
                    onClick={() => onNavigate('training')}
                    aria-label="Inizia allenamento di oggi"
                >
                    <Play fill="currentColor" size={20} />
                    Inizia allenamento
                </button>
            </div>
        );
    }

    return (
        <div style={{
            background: 'linear-gradient(135deg, rgba(46, 204, 113, 0.1), rgba(46, 204, 113, 0.02))',
            border: '1px solid rgba(46, 204, 113, 0.2)',
            borderRadius: '16px',
            padding: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '20px'
        }}>
            <div style={{ flexShrink: 0, color: 'var(--success-color)' }}>
                <CheckCircle2 size={48} />
            </div>
            <div>
                <h2 style={{ margin: '0 0 4px 0', fontSize: '1.2rem', color: 'var(--text-main)' }}>Allenamento completato</h2>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    {todaysWorkout?.routineName || 'Sessione'} <br/> 
                    <span style={{ opacity: 0.8 }}>{todaysWorkout?.exercises?.length || 0} esercizi</span>
                </p>
            </div>
        </div>
    );
};

export default HomeWorkoutWidget;
