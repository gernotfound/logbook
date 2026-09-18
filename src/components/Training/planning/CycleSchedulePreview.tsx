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
                background: 'var(--surface-light)',
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
                    <span style={{  fontWeight: 'bold', color: 'var(--text-main)' }} className="text-base">
                        🔄 Calendario rotazione schede ({schedule.totalSessions} sedute)
                    </span>
                </div>
                <button
                    type="button"
                    className="btn btn-secondary btn-small text-sm"
                    style={{ padding: '2px 8px',  marginBottom: 0 }}
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
                                background: 'var(--surface-light)',
                                borderRadius: '6px',
                                border: '1px solid var(--glass-border)'
                            }}
                        >
                            <div className="flex-between items-center mb-6">
                                <span style={{ fontWeight: 'bold',  color: 'var(--primary-color)' }} className="text-sm">
                                    Settimana {week.weekNumber} {week.formattedRange ? `(${week.formattedRange})` : ''}
                                </span>
                                <span style={{  color: 'var(--text-muted)' }} className="text-sm">
                                    {week.sessions.length} {week.sessions.length === 1 ? 'seduta' : 'sedute'}
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {week.sessions.map((sess) => (
                                    <div
                                        key={sess.globalSessionIndex}
                                        style={{
                                            padding: '4px 8px',
                                            background: 'var(--primary-soft)',
                                            border: '1px solid var(--primary-color)',
                                            borderRadius: '4px',

                                            color: 'var(--text-main)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '5px'
                                        }}
                                     className="text-sm">
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
