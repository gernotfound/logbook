import { memo, useId } from 'react';
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
    const panelId = useId();
    if (!schedule?.weeks) return null;
    const isInvalidSchedule = schedule.summaryText === 'Parametri del ciclo da correggere';
    const noPreview = isInvalidSchedule || schedule.weeks.length === 0;

    return (
        <section className="planning-rotation-preview">
            <button
                type="button"
                className="planning-accordion planning-stateful"
                id={`${panelId}-trigger`}
                onClick={onTogglePreview}
                aria-expanded={showPreview}
                aria-controls={showPreview ? panelId : undefined}
                aria-label={`Anteprima della rotazione flessibile, ${isInvalidSchedule ? 'parametri da correggere' : `${schedule.totalSessions} sedute indicative`}, ${showPreview ? 'aperta' : 'chiusa'}`}
            >
                <span>Anteprima della rotazione flessibile · {isInvalidSchedule ? 'parametri da correggere' : `${schedule.totalSessions} sedute indicative`}</span>
                <span className="planning-accordion-meta">
                    <span className={showPreview ? 'planning-state-badge is-open' : 'planning-state-badge'}>
                        {showPreview ? 'Aperta' : 'Chiusa'}
                    </span>
                    <ChevronDown className={showPreview ? 'is-open' : ''} size={20} aria-hidden="true" />
                </span>
            </button>

            {showPreview ? (
                <div
                    id={panelId}
                    className="planning-accordion-panel"
                    role="region"
                    aria-labelledby={`${panelId}-trigger`}
                >
                    {noPreview ? (
                        <p className="planning-helper" role="status">
                            {isInvalidSchedule
                                ? 'Correggi i parametri del ciclo per visualizzare la rotazione.'
                                : schedule.totalSessions === 0
                                    ? 'Nessuna seduta da visualizzare.'
                                    : 'Il dettaglio della rotazione non è disponibile.'}
                        </p>
                    ) : (
                        <>
                            <p className="planning-helper">Anteprima indicativa: puoi svolgere anche una sola seduta delle programmate. Nessun giorno è obbligatorio e puoi scegliere liberamente la scheda.</p>
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
                        </>
                    )}
                </div>
            ) : null}
        </section>
    );
});
