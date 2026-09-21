import React from 'react';
import { Play, CheckCircle2, Dumbbell } from 'lucide-react';
import type { WorkoutSession } from '../../../types';

interface HomeWorkoutWidgetProps {
    isRestDay?: boolean;
    todaysWorkout?: WorkoutSession | null;
    activeWorkout?: WorkoutSession | null;
    onNavigate: (view: string) => void;
}

export const HomeWorkoutWidget: React.FC<HomeWorkoutWidgetProps> = ({
    isRestDay = false,
    todaysWorkout, activeWorkout,
    onNavigate
}) => {
    const inProgress = !!activeWorkout;
    const completed = !isRestDay && !!todaysWorkout && !inProgress;
    return (
        <section className="home-workout">
            <div className="home-section-heading">
                <h2>Allenamento</h2>
                {completed ? <CheckCircle2 className="home-success" size={24} aria-hidden="true" /> : <Dumbbell size={24} aria-hidden="true" />}
            </div>
            <div>
                <h3>{inProgress ? activeWorkout.routineName || 'Allenamento libero' : completed ? 'Allenamento completato' : 'Pronto ad allenarti?'}</h3>
                <p className="text-sm home-muted">{inProgress ? `Sessione in corso · ${activeWorkout.exercises.length} esercizi` : completed ? `${todaysWorkout.routineName || 'Sessione'} · ${todaysWorkout.exercises.length} esercizi` : 'Nessun allenamento registrato oggi.'}</p>
            </div>
            <button className={completed ? 'btn btn-secondary' : 'btn btn-primary'} type="button" onClick={() => onNavigate('training')}
                aria-label={inProgress ? 'Riprendi allenamento' : completed ? 'Apri allenamento' : 'Inizia allenamento di oggi'}>
                <Play size={20} aria-hidden="true" />{inProgress ? 'Riprendi allenamento' : completed ? 'Apri allenamento' : 'Inizia allenamento'}
            </button>
        </section>
    );
};

export default HomeWorkoutWidget;
