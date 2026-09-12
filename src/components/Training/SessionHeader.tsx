import React from 'react';
import { Pencil } from 'lucide-react';
import WorkoutTimer from './WorkoutTimer';

export interface SessionHeaderProps {
    isEditingHistory?: boolean;
    routineName?: string;
    date?: string;
    onCancelHistory: () => void;
}

export const SessionHeader: React.FC<SessionHeaderProps> = ({
    isEditingHistory,
    routineName,
    date,
    onCancelHistory
}) => {
    return (
        <>
            <div className="workout-timer-sticky">
                <WorkoutTimer />
            </div>

            {isEditingHistory && (
                <div className="workout-history-banner">
                    <div>
                        <div className="workout-history-banner__title">
                            <Pencil size={15} aria-hidden="true" /> Modifica allenamento dello storico
                        </div>
                        <div className="workout-history-banner__meta">
                            {routineName || 'Sessione'} • {date || ''}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={onCancelHistory}
                    >
                        Annulla
                    </button>
                </div>
            )}

            {routineName && <h1 className="workout-title">{routineName}</h1>}
        </>
    );
};

export default SessionHeader;
