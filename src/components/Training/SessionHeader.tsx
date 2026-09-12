import React from 'react';
import { Pencil } from 'lucide-react';
import WorkoutTimer from './WorkoutTimer';

// Responsabilità: renderizzare l'header e il timer di una sessione attiva o in modifica.
// Il timer resta sticky e i suoi tre controlli restano sempre immediatamente accessibili.

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
            <div className="session-sticky-header">
                <WorkoutTimer />
            </div>

            {isEditingHistory && (
                <div className="session-edit-banner">
                    <div>
                        <div className="session-edit-banner__title">
                            <Pencil size={15} aria-hidden="true" /> Modifica allenamento dello storico
                        </div>
                        <div className="session-edit-banner__meta">
                            {routineName || 'Sessione'} · {date || ''}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn-small session-edit-banner__cancel"
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
