import React from 'react';

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
            <div className="card" id="home-workout-widget" style={{ display: 'flex', alignItems: 'center', gap: '15px', borderLeft: '4px solid var(--primary-color)' }}>
                <div style={{ fontSize: '2.5rem' }}>😴</div>
                <div>
                    <h3 style={{ margin: 0 }}>Riposo</h3>
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>Nessun allenamento oggi.</p>
                </div>
                <button className="btn btn-small btn-primary" style={{ marginLeft: 'auto', marginBottom: 0 }} onClick={() => onNavigate('training')}>Vai</button>
            </div>
        );
    }

    return (
        <div className="card" id="home-workout-widget" style={{ display: 'flex', alignItems: 'center', gap: '15px', borderLeft: '4px solid var(--success-color)' }}>
            <div style={{ fontSize: '2.5rem' }}>💪</div>
            <div>
                <h3 style={{ margin: 0 }}>Allenamento completato</h3>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>{todaysWorkout?.routineName || 'Sessione'} — {todaysWorkout?.exercises?.length || 0} esercizi</p>
            </div>
        </div>
    );
};

export default HomeWorkoutWidget;
