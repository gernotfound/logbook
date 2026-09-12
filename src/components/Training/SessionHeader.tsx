import React from 'react';
import WorkoutTimer from './WorkoutTimer';

// Responsabilità: renderizzare l'header e il timer di una sessione attiva o in modifica.
// Il timer sticky e i suoi tre controlli sono un invariante UX della sessione.
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
        <React.Fragment>
            <div className="session-timer-bar">
                <WorkoutTimer />
            </div>

            {isEditingHistory && (
                <div className="session-history-banner">
                    <div>
                        <div className="session-history-banner__title">
                            Modifica allenamento dello storico
                        </div>
                        <div className="session-history-banner__meta">
                            {routineName || 'Sessione'} • {date || ''}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn btn-small session-history-banner__action"
                        onClick={onCancelHistory}
                    >
                        Annulla
                    </button>
                </div>
            )}

            {routineName && <h1 className="session-routine-title">{routineName}</h1>}
        </React.Fragment>
    );
};

export default SessionHeader;
