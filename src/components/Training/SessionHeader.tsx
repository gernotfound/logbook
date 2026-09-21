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
                    background: 'rgba(234, 179, 8, 0.15)',
                    border: '1px solid var(--warning-color, #eab308)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    marginBottom: '15px'
                }}>
                    <div>
                        <div style={{ fontWeight: 'bold', color: 'var(--warning-color, #eab308)', fontSize: '0.95rem' }}>
                            <Pencil size={16} aria-hidden="true" style={{marginRight: '8px'}} /> Modifica allenamento dello storico
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {routineName || 'Sessione'} • {date || ''}
                        </div>
                    </div>
                    <button 
                        className="btn btn-small" 
                        style={{ width: 'auto', padding: '5px 12px', fontSize: '0.85rem', background: 'rgba(255,255,255,0.1)' }}
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
