// Responsabilità: renderizzare la preview delle rotazioni delle schede del ciclo di allenamento.
// Props: schedule (oggetto calcolato da Logic.calculateCycleSchedule), showPreview (boolean), onTogglePreview (funzione).
// Effetti: nessuno, puro componente visuale memoizzato.

import React, { memo } from 'react';

import type { CycleScheduleResult } from '../../../lib/calc/planning';

interface CycleSchedulePreviewProps {
    schedule: CycleScheduleResult;
    showPreview: boolean;
    onTogglePreview: () => void;
}

export const CycleSchedulePreview: React.FC<CycleSchedulePreviewProps> = memo(({
    schedule,
    showPreview,
    onTogglePreview
}) => {
    if (!schedule || !schedule.weeks) return null;

    return (
        <div
            style={{
                padding: '12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                marginBottom: '15px'
            }}
        >
            <div
                className="flex-between items-center"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={onTogglePreview}
            >
                <div>
                    <span className="text-xs text-primary font-bold uppercase tracking-wider block">
                        Programmazione rotazione
                    </span>
                    <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                        🔄 Calendario rotazione schede ({schedule.totalSessions} sedute)
                    </span>
                </div>
                <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    style={{ padding: '2px 8px', fontSize: '0.75rem', marginBottom: 0 }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onTogglePreview();
                    }}
                >
                    {showPreview ? 'Nascondi' : 'Mostra'}
                </button>
            </div>

            <div className="text-xs text-muted mt-6">
                {schedule.summaryText}
            </div>

            {showPreview && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                    {schedule.weeks.map((week) => (
                        <div
                            key={week.weekNumber}
                            style={{
                                padding: '8px 10px',
                                background: 'rgba(255, 255, 255, 0.04)',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.05)'
                            }}
                        >
                            <div className="flex-between items-center mb-6">
                                <span style={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--primary-color)' }}>
                                    Settimana {week.weekNumber} {week.formattedRange ? `(${week.formattedRange})` : ''}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    {week.sessions.length} {week.sessions.length === 1 ? 'seduta' : 'sedute'}
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {week.sessions.map((sess) => (
                                    <div
                                        key={sess.globalSessionIndex}
                                        style={{
                                            padding: '4px 8px',
                                            background: 'rgba(14, 165, 233, 0.1)',
                                            border: '1px solid rgba(14, 165, 233, 0.3)',
                                            borderRadius: '4px',
                                            fontSize: '0.75rem',
                                            color: 'var(--text-main)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '5px'
                                        }}
                                    >
                                        <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>
                                            #{sess.globalSessionIndex}
                                        </span>
                                        <span>{sess.routineName}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});
CycleSchedulePreview.displayName = 'CycleSchedulePreview';
