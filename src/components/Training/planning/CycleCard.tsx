import React, { useMemo, useState } from 'react';
import { ChevronDown, Copy, Pencil, Repeat2, Trash2 } from 'lucide-react';
import { Logic } from '../../../lib/logic';
import type { TrainingCycle, WorkoutRoutine } from '../../../types';
import { ContextMenu, type ContextMenuItem } from '../../UI/ContextMenu';
import { CycleStrategySummary } from './CycleStrategySummary';
import { CycleSchedulePreview } from './CycleSchedulePreview';

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
    const [isExpanded, setIsExpanded] = useState(false);
    const [showSchedule, setShowSchedule] = useState(false);
    const sessionsPerWeek = cycle.sessionsPerWeek || cycle.routines?.length || 1;
    const timeline = Logic.calculateCycleTimeline(cycle);
    const schedule = useMemo(() => Logic.calculateCycleSchedule(cycle, routines), [cycle, routines]);

    const menuItems: ContextMenuItem[] = [
        { id: 'edit-cycle', label: 'Modifica', icon: <Pencil size={16} />, onClick: () => onEdit(cycle) },
        { id: 'duplicate-cycle', label: 'Duplica', icon: <Copy size={16} />, onClick: () => onDuplicate(cycle) },
        { id: 'delete-cycle', label: 'Elimina', icon: <Trash2 size={16} />, variant: 'danger', onClick: () => onDelete(cycle) }
    ];

    return (
        <article className={isActive ? 'planning-cycle-item is-active' : 'planning-cycle-item'}>
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
                        <span>{cycle.durationWeeks} settimane · {sessionsPerWeek} {sessionsPerWeek === 1 ? 'seduta' : 'sedute'} / sett.</span>
                    </span>
                    <ChevronDown className={isExpanded ? 'is-open' : ''} size={20} aria-hidden="true" />
                </button>
                <ContextMenu items={menuItems} />
            </div>

            <div className="planning-cycle-expanded" hidden={!isExpanded}>
                {cycle.startDate ? <p className="planning-cycle-period">{timeline.formattedRange}</p> : null}
                <CycleStrategySummary strategy={cycle.strategy} />
                {cycle.notes ? <p className="planning-cycle-notes">“{cycle.notes}”</p> : null}

                <div className="planning-routine-chips" aria-label="Sequenza schede del ciclo">
                    {(cycle.routines ?? []).map((item, index) => {
                        const routine = routines.find(candidate => candidate.id === item.routineId);
                        return (
                            <span key={`${item.routineId}-${index}`}>
                                <b>{String.fromCharCode(65 + (index % 26))}</b> {routine?.name ?? 'Scheda'}
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
                    <button type="button" className="btn" onClick={() => onEdit(cycle)}>Modifica</button>
                    {isActive ? (
                        <button type="button" className="btn" onClick={() => onDeactivate(cycle.id)}>Disattiva ciclo</button>
                    ) : (
                        <button type="button" className="btn btn-primary" onClick={() => onSetActive(cycle.id)}>Imposta come ciclo attivo</button>
                    )}
                </div>
            </div>
        </article>
    );
};
