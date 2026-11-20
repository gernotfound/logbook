import { BarChart2, ChevronRight, Dumbbell, Pencil, Trash2 } from 'lucide-react';
import { ContextMenu } from '../../UI/ContextMenu';
import { getWorkoutDurationSeconds } from '../../../lib/calc/workoutDuration';
import type { WorkoutSession } from '../../../types';
import { formatCompactDuration, workoutStartTime } from './historyWorkoutPresentation';

interface HistoryWorkoutCardProps {
    workout: WorkoutSession;
    onOpen: (workout: WorkoutSession) => void;
    onEditWorkout?: (workout: WorkoutSession) => void;
    onDeleteWorkout: (id: string) => Promise<void> | void;
}

export function HistoryWorkoutCard({ workout, onOpen, onEditWorkout, onDeleteWorkout }: HistoryWorkoutCardProps) {
    const name = workout.routineName || 'Sessione personalizzata';
    const exerciseCount = workout.exercises?.length || 0;
    const info = `${workoutStartTime(workout)} · ${formatCompactDuration(getWorkoutDurationSeconds(workout) ?? 0)} · ${exerciseCount} ${exerciseCount === 1 ? 'esercizio' : 'esercizi'}`;

    return (
        <article className="history-workout-card">
            <button
                className="history-workout-open"
                type="button"
                aria-label={`Apri il dettaglio di ${name}`}
                onClick={() => onOpen(workout)}
            >
                <span className="history-workout-icon">
                    <Dumbbell size={20} aria-hidden="true" />
                </span>
                <span className="history-workout-copy">
                    <span className="history-workout-name" title={name}>{name}</span>
                    <span className="history-workout-info">{info}</span>
                </span>
                <ChevronRight className="history-workout-chevron" size={18} aria-hidden="true" />
            </button>
            <div className="history-workout-menu">
                <ContextMenu
                    items={[
                        {
                            label: 'Vedi report',
                            icon: <BarChart2 size={16} />,
                            onClick: () => onOpen(workout)
                        },
                        {
                            label: 'Modifica allenamento',
                            icon: <Pencil size={16} />,
                            hidden: !onEditWorkout,
                            onClick: () => onEditWorkout?.(workout)
                        },
                        {
                            label: 'Elimina allenamento',
                            icon: <Trash2 size={16} />,
                            variant: 'danger',
                            hidden: !workout.id,
                            onClick: () => workout.id && onDeleteWorkout(workout.id)
                        }
                    ]}
                />
            </div>
        </article>
    );
}
