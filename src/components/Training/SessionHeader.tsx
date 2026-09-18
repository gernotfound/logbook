import React from 'react';
import { Pencil } from 'lucide-react';
import WorkoutTimer from './WorkoutTimer';

// Responsabilità: renderizzare l'header e il timer di una sessione attiva o in modifica.
// Props: isEditingHistory, routineName, date, onCancelHistory.
// Effetti: nessuno diretto sul DB; chiama callback o renderizza timer globale.

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
            {/* Sticky Timer */}
            <div className="workout-sticky-timer">
                <WorkoutTimer />
            </div>

            {isEditingHistory && (
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--warning-soft)',
                    border: '1px solid var(--warning-color, #eab308)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    marginBottom: '15px'
                }}>
                    <div>
                        <div style={{ fontWeight: 'bold', color: 'var(--warning-color, #eab308)' }} className="text-base">
                            <Pencil size={16} aria-hidden="true" style={{marginRight: '8px'}} /> Modifica allenamento dello storico
                        </div>
                        <div style={{  color: 'var(--text-muted)' }} className="text-sm">
                            {routineName || 'Sessione'} • {date || ''}
                        </div>
                    </div>
                    <button
                        className="btn btn-small text-sm"
                        style={{ width: 'auto', padding: '5px 12px',  background: 'var(--surface-light)' }}
                        onClick={onCancelHistory}
                    >
                        Annulla
                    </button>
                </div>
            )}

            {routineName && <h1 style={{marginTop: 0}}>{routineName}</h1>}
        </React.Fragment>
    );
};

export default SessionHeader;
