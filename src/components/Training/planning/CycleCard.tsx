import React from 'react';
import type { TrainingCycle, WorkoutRoutine } from '../../../types';

interface CycleCardProps {
    cycle: TrainingCycle;
    isActive: boolean;
    routines: WorkoutRoutine[];
    onSetActive: (cycleId: string) => void;
    onDeactivate: (cycleId: string) => void;
    onEdit: (cycle: TrainingCycle) => void;
    onDuplicate: (cycle: TrainingCycle) => void;
    onDelete: (cycle: TrainingCycle) => void;
}

export const CycleCard: React.FC<CycleCardProps> = ({
    cycle,
    isActive,
    routines,
    onSetActive,
    onDeactivate,
    onEdit,
    onDuplicate,
    onDelete
}) => {
    const totalWorkouts = (cycle.routines || []).reduce((sum, r) => sum + (r.frequencyPerWeek || 1), 0);

    return (
        <div
            className="card mb-15"
            style={{
                border: isActive ? '1px solid var(--primary-color)' : '1px solid var(--glass-border)',
                background: isActive ? 'rgba(14, 165, 233, 0.05)' : 'var(--glass-bg)'
            }}
        >
            <div className="flex-between items-start mb-8 gap-10">
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <h4 className="m-0" style={{ color: 'var(--text-main)', fontSize: '1.05rem' }}>
                            {cycle.name}
                        </h4>
                        {isActive && (
                            <span
                                style={{
                                    fontSize: '0.7rem',
                                    fontWeight: 'bold',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    background: 'var(--primary-color)',
                                    color: '#000'
                                }}
                            >
                                Attivo
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Durata: <strong>{cycle.durationWeeks} settimane</strong> • {totalWorkouts} {totalWorkouts === 1 ? 'sessione' : 'sessioni'} / sett.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button
                        type="button"
                        className="btn btn-small"
                        style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', marginBottom: 0 }}
                        onClick={() => onEdit(cycle)}
                        title="Modifica ciclo"
                    >
                        ✏️ Modifica
                    </button>
                    <button
                        type="button"
                        className="btn btn-small"
                        style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', marginBottom: 0 }}
                        onClick={() => onDuplicate(cycle)}
                        title="Duplica ciclo"
                    >
                        📋 Duplica
                    </button>
                    <button
                        type="button"
                        className="btn-icon"
                        style={{ color: 'var(--danger-color)', fontSize: '0.9rem' }}
                        onClick={() => onDelete(cycle)}
                        title="Elimina ciclo"
                    >
                        🗑️
                    </button>
                </div>
            </div>

            {cycle.notes && (
                <p className="text-xs text-muted mb-10" style={{ fontStyle: 'italic' }}>
                    "{cycle.notes}"
                </p>
            )}

            {/* Schede nel ciclo */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                {(cycle.routines || []).map(item => {
                    const routine = routines.find(r => r.id === item.routineId);
                    return (
                        <span
                            key={item.routineId}
                            style={{
                                fontSize: '0.75rem',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid var(--glass-border)',
                                color: 'var(--text-main)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            <span>{routine?.name || 'Scheda'}</span>
                            <strong style={{ color: 'var(--primary-color)' }}>({item.frequencyPerWeek}x)</strong>
                        </span>
                    );
                })}
            </div>

            <div style={{ paddingTop: '8px', borderTop: '1px solid var(--glass-border)' }}>
                {isActive ? (
                    <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        style={{ width: '100%', marginBottom: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}
                        onClick={() => onDeactivate(cycle.id)}
                    >
                        ⏸️ Disattiva ciclo
                    </button>
                ) : (
                    <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        style={{ width: '100%', marginBottom: 0, fontSize: '0.8rem' }}
                        onClick={() => onSetActive(cycle.id)}
                    >
                        ⭐ Imposta come ciclo attivo
                    </button>
                )}
            </div>
        </div>
    );
};
