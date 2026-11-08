import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, Pencil, Repeat2, Trash2 } from 'lucide-react';
import { Logic } from '../../../lib/logic';
import type { TrainingCycle, WorkoutRoutine } from '../../../types';
import { isBoundedCycleCount, MAX_CALCULATED_CYCLE_WEEKS } from '../../../lib/calc/cycleLimits';
import { ContextMenu, type ContextMenuItem } from '../../UI/ContextMenu';
import { CycleStrategySummary } from './CycleStrategySummary';
import { CycleSchedulePreview } from './CycleSchedulePreview';

interface CycleCardProps {
    cycle: TrainingCycle;
    isActive: boolean;
    routines: WorkoutRoutine[];
    onSetActive: (cycleId: string) => void | Promise<void>;
    onDeactivate: (cycleId: string) => void | Promise<void>;
    onEdit: (cycle: TrainingCycle) => void | Promise<void>;
    onDuplicate: (cycle: TrainingCycle) => void | Promise<void>;
    onDelete: (cycle: TrainingCycle) => void | Promise<void>;
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
    const [isExpanded, setIsExpanded] = useState(false);
    const [showSchedule, setShowSchedule] = useState(false);
    const [actionPending, setActionPending] = useState(false);
    const actionPendingRef = useRef(false);

    const runAction = async (action: () => void | Promise<void>) => {
        // Guard before React re-renders: two taps must not dispatch the same
        // cycle mutation or open overlapping confirmations.
        if (actionPendingRef.current) return;
        actionPendingRef.current = true;
        setActionPending(true);
        try {
            await action();
        } catch (error) {
            console.error('Operazione sul ciclo non completata:', error);
        } finally {
            actionPendingRef.current = false;
            setActionPending(false);
        }
    };
    const timeline = Logic.calculateCycleTimeline(cycle);
    const routineNames = useMemo(() => new Map(routines.map(routine => [routine.id, routine.name])), [routines]);
    // Inactive cards only compute the bounded summary. The compiler can
    // memoize this pure calculation without an explicit useMemo dependency list.
    const schedule = Logic.calculateCycleSchedule(cycle, routines, isExpanded && showSchedule);

    const isInvalidSchedule = schedule.summaryText === 'Parametri del ciclo da correggere';
    const sessionsPerWeek = isInvalidSchedule ? null : schedule.sessionsPerWeek;
    const weeksLabel = isBoundedCycleCount(timeline.totalWeeks, MAX_CALCULATED_CYCLE_WEEKS)
        ? String(timeline.totalWeeks) : '—';

    const menuItems: ContextMenuItem[] = [
        { id: 'edit-cycle', label: 'Modifica', icon: <Pencil size={16} />, disabled: actionPending, onClick: () => { void runAction(() => onEdit(cycle)); } },
        { id: 'duplicate-cycle', label: 'Duplica', icon: <Copy size={16} />, disabled: actionPending, onClick: () => { void runAction(() => onDuplicate(cycle)); } },
        { id: 'delete-cycle', label: 'Elimina', icon: <Trash2 size={16} />, variant: 'danger', disabled: actionPending, onClick: () => { void runAction(() => onDelete(cycle)); } }
    ];

    return (
        <article className={isActive ? 'planning-cycle-item is-active' : 'planning-cycle-item'} aria-busy={actionPending}>
            <div className="planning-cycle-row">
                <button
                    type="button"
                    className="planning-cycle-toggle"
                    onClick={() => setIsExpanded(expanded => !expanded)}
                    aria-expanded={isExpanded}
                >
                    <span className="planning-cycle-icon" aria-hidden="true"><Repeat2 size={22} /></span>
                    <span className="planning-cycle-copy">
                        <strong>{cycle.name}</strong>
                        <span>{weeksLabel} settimane · {sessionsPerWeek ?? '—'} {sessionsPerWeek === 1 ? 'seduta' : 'sedute'} / sett. (stima)</span>
                    </span>
                    <ChevronDown className={isExpanded ? 'is-open' : ''} size={20} aria-hidden="true" />
                </button>
                <ContextMenu items={menuItems} />
            </div>

            <div className="planning-cycle-expanded" hidden={!isExpanded}>
                {cycle.startDate ? <p className="planning-cycle-period">{timeline.formattedRange}</p> : null}
                {isInvalidSchedule ? <p className="planning-helper" role="status">Parametri del ciclo da correggere.</p> : null}
                <CycleStrategySummary strategy={cycle.strategy} />
                {cycle.notes ? <p className="planning-cycle-notes">“{cycle.notes}”</p> : null}

                <div className="planning-routine-chips" aria-label="Sequenza schede del ciclo">
                    {(cycle.routines ?? []).map((item, index) => {
                        const routineName = routineNames.get(item.routineId);
                        return (
                            <span key={`${item.routineId}-${index}`}>
                                <b>{String.fromCharCode(65 + (index % 26))}</b> {routineName ?? 'Scheda non disponibile'}
                            </span>
                        );
                    })}
                </div>

                {cycle.routines?.length ? (
                    <CycleSchedulePreview
                        schedule={schedule}
                        showPreview={showSchedule}
                        onTogglePreview={() => setShowSchedule(open => !open)}
                    />
                ) : null}

                <div className="planning-cycle-actions">
                    <button type="button" className="btn" disabled={actionPending} onClick={() => { void runAction(() => onEdit(cycle)); }}>Modifica</button>
                    {isActive ? (
                        <button type="button" className="btn" disabled={actionPending} onClick={() => { void runAction(() => onDeactivate(cycle.id)); }}>Disattiva ciclo</button>
                    ) : (
                        <button type="button" className="btn btn-primary" disabled={actionPending} onClick={() => { void runAction(() => onSetActive(cycle.id)); }}>Imposta come ciclo attivo</button>
                    )}
                </div>
            </div>
        </article>
    );
};
