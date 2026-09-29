import { memo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CycleScheduleResult } from '../../../lib/calc/planning';

interface CycleSchedulePreviewProps {
    schedule: CycleScheduleResult;
    showPreview: boolean;
    onTogglePreview: () => void;
}

export const CycleSchedulePreview = memo(function CycleSchedulePreview({
    schedule,
    showPreview,
    onTogglePreview
}: CycleSchedulePreviewProps) {
    if (!schedule?.weeks) return null;

    return (
        <section className="planning-rotation-preview">
            <button
                type="button"
                className="planning-accordion planning-stateful"
                onClick={onTogglePreview}
                aria-expanded={showPreview}
                aria-label={`Rotazione flessibile, ${schedule.totalSessions} sedute, ${showPreview ? 'ON' : 'OFF'}`}
            >
                <span>Rotazione flessibile · {schedule.totalSessions} sedute</span>
                <span className="planning-accordion-meta">
                    <span className={showPreview ? 'planning-state-badge is-on' : 'planning-state-badge'}>
                        {showPreview ? 'ON' : 'OFF'}
                    </span>
                    <ChevronDown className={showPreview ? 'is-open' : ''} size={20} aria-hidden="true" />
                </span>
            </button>

            {showPreview ? (
                <div className="planning-accordion-panel">
                    <p className="planning-helper">Nessun giorno della settimana è assegnato: conta soltanto l'ordine delle prossime schede.</p>
                    <div className="planning-schedule-weeks">
                        {schedule.weeks.map(week => (
                            <div key={week.weekNumber} className="planning-schedule-week">
                                <div className="planning-schedule-week-head">
                                    <strong>Settimana {week.weekNumber}</strong>
                                    <span>{week.sessions.length} {week.sessions.length === 1 ? 'seduta' : 'sedute'}</span>
                                </div>
                                <div className="planning-schedule-sessions">
                                    {week.sessions.map(session => (
                                        <span key={session.globalSessionIndex}>
                                            <b>#{session.globalSessionIndex}</b> {session.routineName}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </section>
    );
});
