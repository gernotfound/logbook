import React from 'react';
import { CheckCircle2, Play } from 'lucide-react';

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
            <div className="home-workout-widget home-workout-widget--rest">
                <div>
                    <h2>Pronto ad allenarti?</h2>
                    <p>Nessun allenamento registrato oggi.</p>
                </div>
                <button
                    className="btn btn-primary home-workout-cta"
                    onClick={() => onNavigate('training')}
                    aria-label="Inizia allenamento di oggi"
                >
                    <Play size={19} aria-hidden="true" />
                    Inizia allenamento
                </button>
            </div>
        );
    }

    return (
        <div className="home-workout-widget home-workout-widget--complete">
            <div className="home-workout-widget__icon">
                <CheckCircle2 size={28} aria-hidden="true" />
            </div>
            <div>
                <h2>Allenamento completato</h2>
                <p>
                    {todaysWorkout?.routineName || 'Sessione'}<br />
                    <span>{todaysWorkout?.exercises?.length || 0} esercizi</span>
                </p>
            </div>
        </div>
    );
};

export default HomeWorkoutWidget;
