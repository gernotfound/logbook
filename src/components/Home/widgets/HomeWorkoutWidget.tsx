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
            <div className="workout-hero workout-hero--ready">
                <div className="workout-hero__copy">
                    <h2>Pronto ad allenarti?</h2>
                    <p>Nessun allenamento registrato oggi.</p>
                </div>
                <button
                    type="button"
                    className="btn btn-primary workout-hero__cta"
                    onClick={() => onNavigate('training')}
                    aria-label="Inizia allenamento di oggi"
                >
                    <Play size={19} fill="currentColor" aria-hidden="true" />
                    Inizia allenamento
                </button>
            </div>
        );
    }

    return (
        <div className="workout-hero workout-hero--complete">
            <div className="workout-hero__icon" aria-hidden="true">
                <CheckCircle2 size={28} />
            </div>
            <div className="workout-hero__copy">
                <h2>Allenamento completato</h2>
                <p>
                    {todaysWorkout?.routineName || 'Sessione'} · {todaysWorkout?.exercises?.length || 0} esercizi
                </p>
            </div>
        </div>
    );
};

export default HomeWorkoutWidget;
