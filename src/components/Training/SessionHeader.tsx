import React from 'react';
import { Pencil } from 'lucide-react';
import WorkoutTimer from './WorkoutTimer';

interface SessionHeaderProps {
    isEditingHistory?: boolean;
    routineName?: string;
    date?: string;
    onCancelHistory: () => void;
    historySaving?: boolean;
    currentExerciseIndex?: number;
    totalExercises?: number;
}

const SessionHeader: React.FC<SessionHeaderProps> = ({
    isEditingHistory,
    routineName,
    date,
    onCancelHistory,
    historySaving = false,
    currentExerciseIndex = 0,
    totalExercises = 0,
}) => {
    const safeIndex = totalExercises > 0
        ? Math.min(Math.max(currentExerciseIndex, 0), totalExercises - 1)
        : 0;
    const progress = totalExercises <= 1
        ? (totalExercises === 1 ? 100 : 0)
        : Math.round((safeIndex / (totalExercises - 1)) * 100);

    return (
        <>
            {isEditingHistory ? (
                <div className="session-history-edit-banner">
                    <div>
                        <div className="session-history-edit-title">
                            <Pencil size={18} aria-hidden="true" />
                            Modifica allenamento dello storico
                        </div>
                        <div className="session-history-edit-meta">
                            {routineName || 'Sessione'}{date ? ` · ${date}` : ''}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn btn-small"
                        onClick={onCancelHistory}
                        disabled={historySaving}
                    >
                        Annulla
                    </button>
                </div>
            ) : (
                <div className="session-active-heading">
                    <p>Sessione in corso</p>
                    <h1>{routineName || 'Allenamento libero'}</h1>
                </div>
            )}

            {!isEditingHistory && (
                <div className="workout-sticky-timer">
                    <WorkoutTimer />
                    <div
                        className="workout-exercise-progress"
                        role="progressbar"
                        aria-label="Avanzamento nella sequenza degli esercizi"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                    >
                        <span style={{ width: `${progress}%` }} />
                    </div>
                </div>
            )}
        </>
    );
};

export default SessionHeader;
