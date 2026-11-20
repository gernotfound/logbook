import { useMemo, useState } from 'react';
import { Dumbbell } from 'lucide-react';
import { useLocalToday } from '../../../hooks/useLocalToday';
import { Logic } from '../../../lib/logic';
import { isBoundedCycleCount, MAX_CALCULATED_CYCLE_WEEKS } from '../../../lib/calc/cycleLimits';
import { getCycleRotationItems } from '../../../lib/calc/cycleRotationLabels';
import { ContextMenu, type ContextMenuItem } from '../../UI/ContextMenu';
import { CycleMuscleMap } from './CycleMuscleMap';
import { CycleStrategySummary } from './CycleStrategySummary';
import { CycleVolumeAccordion } from './CycleVolumeAccordion';
import { calculateCycleMacroVolume } from './cycleMacroVolume';
import type { Exercise, TrainingCycle, WorkoutRoutine, WorkoutSession } from '../../../types';

interface ActiveCycleCardProps {
    activeCycle: TrainingCycle;
    routines: WorkoutRoutine[];
    library: Exercise[];
    history: WorkoutSession[];
    activeMenuItems: ContextMenuItem[];
    activeMutationPending: boolean;
    onOpenSession?: () => void;
    onDeactivate: () => void;
}

export function ActiveCycleCard({
    activeCycle, routines, library, history, activeMenuItems,
    activeMutationPending, onOpenSession, onDeactivate,
}: ActiveCycleCardProps) {
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const cycleVolumeData = useMemo(
        () => Logic.calculateCycleVolume(activeCycle, routines, library),
        [activeCycle, library, routines]
    );
    const macroVolume = useMemo(
        () => calculateCycleMacroVolume(activeCycle, routines, library),
        [activeCycle, library, routines]
    );
    const today = useLocalToday();
    const activeCycleTimeline = useMemo(() => Logic.calculateCycleTimeline(activeCycle, today), [activeCycle, today]);
    const missingRoutineCount = useMemo(() => {
        if (!activeCycle) return 0;
        const availableIds = new Set(routines.map(routine => routine.id));
        return activeCycle.routines.filter(item => !availableIds.has(item.routineId)).length;
    }, [activeCycle, routines]);
    const nextScheduled = useMemo(
        () => Logic.getNextScheduledRoutine(activeCycle, routines, history),
        [activeCycle, history, routines]
    );

    // Read-only summary shares the bounded cycle calculation; historical invalid input stays unchanged.
    const plannedSchedule = useMemo(
        () => Logic.calculateCycleSchedule(activeCycle, routines, false),
        [activeCycle, routines],
    );
    const isInvalidSchedule = plannedSchedule.summaryText === 'Parametri del ciclo da correggere';
    const totalSessions = isInvalidSchedule ? '—' : plannedSchedule.totalSessions;

    return (
        <article className="planning-active-card" aria-busy={activeMutationPending}>
            <header className="planning-active-head">
                <div className="planning-active-title">
                    <span className="planning-active-badge">Ciclo attivo</span>
                    <h2>{activeCycle.name}</h2>
                    <p>{activeCycleTimeline.formattedRange}{isBoundedCycleCount(activeCycleTimeline.totalWeeks, MAX_CALCULATED_CYCLE_WEEKS) ? ` · ${activeCycleTimeline.totalWeeks} settimane` : ''}</p>
                    <CycleStrategySummary strategy={activeCycle.strategy} />
                    {activeCycle.notes ? <p className="planning-active-notes">{activeCycle.notes}</p> : null}
                </div>
                <ContextMenu items={activeMenuItems} />
            </header>

            {nextScheduled?.nextRoutine && !nextScheduled.isCycleCompleted && !activeCycleTimeline.isEnded ? (
                <div className="planning-next-session">
                    <span className="planning-next-icon" aria-hidden="true"><Dumbbell size={24} /></span>
                    <div>
                        <span>Scheda suggerita nella rotazione</span>
                        <strong>{nextScheduled.nextRoutineName}</strong>
                        <span>Seduta #{nextScheduled.nextSessionIndex} · scheda {nextScheduled.positionInRotation} di {nextScheduled.totalRoutinesInCycle}</span>
                    </div>
                </div>
            ) : null}

            {activeCycleTimeline.isEnded ? (
                <p className="planning-helper" role="status">
                    Periodo del ciclo concluso. Le sedute non svolte restano facoltative.
                </p>
            ) : null}
            {missingRoutineCount > 0 ? (
                <p className="planning-helper" role="status">
                    {missingRoutineCount} {missingRoutineCount === 1 ? 'scheda del ciclo non è più disponibile' : 'schede del ciclo non sono più disponibili'}:
                    la rotazione suggerisce soltanto quelle esistenti. Puoi correggere il ciclo da Modifica.
                </p>
            ) : null}

            <div className="planning-kpis" aria-label="Metriche ciclo attivo">
                <div><strong>{cycleVolumeData.totalWorkoutsPerWeek}×</strong><span>Sedute / sett. (stima)</span></div>
                <div><strong>{cycleVolumeData.totalSetsPerWeek}</strong><span>Serie / sett.</span></div>
                <div><strong>{totalSessions}</strong><span>Sedute previste</span></div>
            </div>

            {isInvalidSchedule ? (
                <p className="planning-helper" role="status">Parametri del ciclo da correggere: le sedute previste non sono calcolabili.</p>
            ) : null}

            <div className="planning-progress-copy">
                <span><strong>{activeCycleTimeline.isEnded ? 'Periodo concluso' : activeCycleTimeline.statusLabel}</strong></span>
                <span>{activeCycleTimeline.progressPercent}% del periodo trascorso</span>
            </div>
            <div
                className="planning-progress"
                role="progressbar"
                aria-label="Avanzamento del periodo del ciclo"
                aria-valuenow={activeCycleTimeline.progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <span style={{ width: `${activeCycleTimeline.progressPercent}%` }} />
            </div>

            <div className="planning-active-actions">
                <button
                    type="button"
                    className="btn"
                    onClick={() => setIsDetailsOpen(open => !open)}
                    aria-expanded={isDetailsOpen}
                >
                    Dettagli ciclo
                </button>
                <button type="button" className="btn btn-primary" onClick={onOpenSession} disabled={!onOpenSession || activeMutationPending}>
                    Apri sessione
                </button>
                <button type="button" className="btn" disabled={activeMutationPending} onClick={onDeactivate}>
                    Disattiva ciclo
                </button>
            </div>

            <div className="planning-active-details" hidden={!isDetailsOpen}>
                <div className="planning-routine-chips" aria-label="Sequenza schede del ciclo attivo">
                    {getCycleRotationItems(activeCycle, routines).map(({ routineId, routine, letter }, index) => (
                        <span key={`${routineId}-${index}`}>
                            <b>{letter ?? '—'}</b> {routine?.name ?? 'Scheda non disponibile'}
                        </span>
                    ))}
                </div>
                <CycleMuscleMap
                    title="Mappa muscolare del ciclo"
                    highlightedMuscles={cycleVolumeData.highlightedMuscles}
                    emptyMessage="Le schede di questo ciclo non contengono ancora muscoli associati."
                />
                <CycleVolumeAccordion items={macroVolume} />
            </div>
        </article>
    );
}
