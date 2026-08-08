import React, { useState, useMemo } from 'react';
import { Logic } from '../../../lib/logic';
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
    const [showSchedule, setShowSchedule] = useState(false);
    const sessionsPerWeek = cycle.sessionsPerWeek || (cycle.routines ? cycle.routines.length : 4);
    const timeline = Logic.calculateCycleTimeline(cycle);
    const schedule = useMemo(() => {
        return Logic.calculateCycleSchedule(cycle, routines);
    }, [cycle, routines]);

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
                        {cycle.startDate ? (
                            <>
                                <span>📅 {timeline.formattedRange} ({cycle.durationWeeks} sett.)</span> • <span>{sessionsPerWeek} {sessionsPerWeek === 1 ? 'seduta' : 'sedute'} / sett.</span>
                            </>
                        ) : (
                            <>
                                Durata: <strong>{cycle.durationWeeks} settimane</strong> • {sessionsPerWeek} {sessionsPerWeek === 1 ? 'seduta' : 'sedute'} / sett.
                            </>
                        )}
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

            {/* Sequenza ordinata delle schede nel ciclo */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {(cycle.routines || []).map((item, idx) => {
                    const routine = routines.find(r => r.id === item.routineId);
                    const letterIndex = String.fromCharCode(65 + (idx % 26));
                    return (
                        <span
                            key={`${item.routineId}-${idx}`}
                            style={{
                                fontSize: '0.75rem',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid var(--glass-border)',
                                color: 'var(--text-main)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px'
                            }}
                        >
                            <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{letterIndex}.</span>
                            <span>{routine?.name || 'Scheda'}</span>
                        </span>
                    );
                })}
            </div>

            {/* Pulsante per mostrare/nascondere la programmazione settimanale */}
            {schedule.weeks.length > 0 && (
                <div style={{ marginBottom: '10px' }}>
                    <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        style={{
                            width: '100%',
                            fontSize: '0.75rem',
                            padding: '4px 8px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px dashed var(--glass-border)',
                            color: 'var(--text-muted)',
                            marginBottom: 0
                        }}
                        onClick={() => setShowSchedule(!showSchedule)}
                    >
                        {showSchedule ? '▲ Nascondi programmazione' : `🔄 Vedi programmazione (${schedule.totalSessions} sedute su ${cycle.durationWeeks} sett.)`}
                    </button>

                    {showSchedule && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                            {schedule.weeks.map(week => (
                                <div
                                    key={week.weekNumber}
                                    style={{
                                        padding: '6px 8px',
                                        background: 'rgba(255, 255, 255, 0.03)',
                                        borderRadius: '6px',
                                        fontSize: '0.75rem'
                                    }}
                                >
                                    <div className="flex-between mb-4">
                                        <strong style={{ color: 'var(--primary-color)' }}>
                                            Settimana {week.weekNumber} {week.formattedRange ? `(${week.formattedRange})` : ''}
                                        </strong>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {week.sessions.map((sess) => (
                                            <span
                                                key={sess.globalSessionIndex}
                                                style={{
                                                    padding: '2px 6px',
                                                    background: 'rgba(14, 165, 233, 0.1)',
                                                    border: '1px solid rgba(14, 165, 233, 0.25)',
                                                    borderRadius: '4px',
                                                    color: '#fff',
                                                    fontSize: '0.7rem'
                                                }}
                                            >
                                                #{sess.globalSessionIndex} {sess.routineName}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {isActive && cycle.startDate && (
                <div style={{ marginBottom: '10px' }}>
                    <div className="flex-between text-xs mb-4">
                        <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>
                            {timeline.statusLabel}
                        </span>
                        <span className="text-muted">
                            {timeline.progressPercent}% completato
                        </span>
                    </div>
                    <div style={{ height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                            style={{
                                height: '100%',
                                width: `${timeline.progressPercent}%`,
                                background: 'var(--primary-color)',
                                transition: 'width 0.3s ease'
                            }}
                        />
                    </div>
                </div>
            )}

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
