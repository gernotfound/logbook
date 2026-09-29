import { useMemo, useState } from 'react';
import { CalendarRange, ChevronRight, Dumbbell, Search } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { Logic } from '../../lib/logic';
import type { TrainingCycle, WorkoutRoutine, WorkoutSession } from '../../types';

const EMPTY_CYCLES: TrainingCycle[] = [];

interface PlannedRoutineItem {
    routine: WorkoutRoutine;
    letter: string;
    position: number;
}

export interface TrainingSessionSetupProps {
    onNavigateToPlanning?: () => void;
}

export interface RoutineDurationEstimate {
    minutes: number;
    sampleSize: number;
}

function workoutDurationSeconds(workout: WorkoutSession): number | null {
    if (
        typeof workout.globalStartTime === 'number'
        && typeof workout.globalEndTime === 'number'
        && workout.globalEndTime > workout.globalStartTime
    ) {
        return Math.round((workout.globalEndTime - workout.globalStartTime) / 1000);
    }

    const duration = workout.globalDurationStr || workout.manualDurationStr;
    if (!duration) return null;
    const parts = duration.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
}

export function getRoutineDurationEstimate(
    routineId: string,
    history: WorkoutSession[],
): RoutineDurationEstimate | null {
    const samples = history
        .filter(workout => workout.routineId === routineId)
        .map(workout => ({
            seconds: workoutDurationSeconds(workout),
            timestamp: workout.globalEndTime ?? workout.endTime ?? workout.globalStartTime ?? 0,
        }))
        .filter((sample): sample is { seconds: number; timestamp: number } => (
            sample.seconds !== null && sample.seconds > 0
        ))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);

    if (samples.length < 3) return null;

    const ordered = samples.map(sample => sample.seconds).sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    const medianSeconds = ordered.length % 2 === 0
        ? (ordered[middle - 1] + ordered[middle]) / 2
        : ordered[middle];

    return {
        minutes: Math.max(1, Math.round(medianSeconds / 60)),
        sampleSize: samples.length,
    };
}

function routineExerciseLabel(routine: WorkoutRoutine): string {
    const count = routine.exercises?.length ?? 0;
    return `${count} ${count === 1 ? 'esercizio' : 'esercizi'}`;
}

export const TrainingSessionSetup = ({ onNavigateToPlanning }: TrainingSessionSetupProps) => {
    const trainingCycles = useAppStore(state => state.userData?.trainingCycles || EMPTY_CYCLES);
    const activeCycleId = useAppStore(state => state.userData?.activeCycleId ?? null);
    const activeCycle = activeCycleId ? trainingCycles.find(cycle => cycle.id === activeCycleId) : null;
    const { routines, history, startWorkout, startFreeWorkout } = useWorkoutSession();

    const [searchQuery, setSearchQuery] = useState('');
    const [showRotation, setShowRotation] = useState(false);

    const plannedRoutines: PlannedRoutineItem[] = useMemo(() => {
        if (!activeCycle?.routines) return [];
        return activeCycle.routines
            .map((item, index) => {
                const routine = routines.find(candidate => candidate.id === item.routineId);
                if (!routine) return null;
                return {
                    routine,
                    letter: String.fromCharCode(65 + (index % 26)),
                    position: index + 1,
                };
            })
            .filter((item): item is PlannedRoutineItem => item !== null);
    }, [activeCycle, routines]);

    const nextScheduled = useMemo(
        () => Logic.getNextScheduledRoutine(activeCycle, routines, history),
        [activeCycle, routines, history],
    );

    const durationEstimates = useMemo(() => {
        const estimates = new Map<string, RoutineDurationEstimate>();
        for (const routine of routines) {
            const estimate = getRoutineDurationEstimate(routine.id, history);
            if (estimate) estimates.set(routine.id, estimate);
        }
        return estimates;
    }, [routines, history]);

    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('it');
    const filteredRoutines = useMemo(() => (
        normalizedQuery
            ? routines.filter(routine => routine.name.toLocaleLowerCase('it').includes(normalizedQuery))
            : routines
    ), [normalizedQuery, routines]);

    const startPlannedRoutine = (routineId: string) => {
        if (!activeCycle) return;
        void startWorkout(routineId, { cycleId: activeCycle.id, cycleName: activeCycle.name });
    };

    const renderRoutineRow = (
        routine: WorkoutRoutine,
        options?: { letter?: string; planned?: boolean },
    ) => {
        const estimate = durationEstimates.get(routine.id);
        return (
            <button
                key={routine.id}
                type="button"
                className="session-routine-row"
                onClick={() => options?.planned ? startPlannedRoutine(routine.id) : void startWorkout(routine.id)}
            >
                <span className="session-routine-mark" aria-hidden="true">
                    {options?.letter || routine.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="session-routine-copy">
                    <strong>{routine.name}</strong>
                    <span>
                        {routineExerciseLabel(routine)}
                        {estimate ? ` · ≈ ${estimate.minutes} min` : ''}
                    </span>
                    {estimate && (
                        <small>Stima: mediana ultime {estimate.sampleSize} sessioni</small>
                    )}
                </span>
                <ChevronRight size={20} aria-hidden="true" />
            </button>
        );
    };

    const nextRoutine = nextScheduled?.nextRoutine;
    const nextEstimate = nextRoutine ? durationEstimates.get(nextRoutine.id) : undefined;
    const nextPlannedItem = nextRoutine
        ? plannedRoutines.find(item => item.routine.id === nextRoutine.id)
        : undefined;

    return (
        <div className="session-setup-page" id="train-session">
            <header className="session-setup-header">
                <p>Scegli l’allenamento</p>
                <h1>Sessione</h1>
            </header>

            {activeCycle && nextRoutine && (
                <section className="session-next-card" aria-labelledby="session-next-title">
                    <div className="session-next-top">
                        <div>
                            <p className="session-eyebrow">Prossima nel ciclo</p>
                            <h2 id="session-next-title">{nextRoutine.name}</h2>
                            <span>
                                {activeCycle.name}
                                {nextScheduled?.nextSessionIndex ? ` · Seduta ${nextScheduled.nextSessionIndex} di ${nextScheduled.totalSessions}` : ''}
                            </span>
                        </div>
                        <span className="session-next-icon" aria-hidden="true">
                            <Dumbbell size={24} />
                        </span>
                    </div>

                    <div className="session-setup-stats">
                        <div>
                            <strong>{nextRoutine.exercises?.length ?? 0}</strong>
                            <span>Esercizi</span>
                        </div>
                        {nextEstimate && (
                            <div>
                                <strong>≈ {nextEstimate.minutes} min</strong>
                                <span>Mediana {nextEstimate.sampleSize} sedute</span>
                            </div>
                        )}
                        {nextPlannedItem && (
                            <div>
                                <strong>{nextPlannedItem.letter} di {plannedRoutines.length}</strong>
                                <span>Rotazione</span>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        className="btn btn-primary session-primary-action"
                        onClick={() => startPlannedRoutine(nextRoutine.id)}
                    >
                        Continua con {nextRoutine.name}
                    </button>

                    {plannedRoutines.length > 1 && (
                        <>
                            <button
                                type="button"
                                className="btn btn-secondary session-secondary-action"
                                onClick={() => setShowRotation(open => !open)}
                                aria-expanded={showRotation}
                            >
                                {showRotation ? 'Nascondi altre schede' : 'Cambia scheda della rotazione'}
                            </button>
                            <div
                                className="session-rotation-list"
                                style={{ display: showRotation ? 'grid' : 'none' }}
                            >
                                {plannedRoutines.map(item => renderRoutineRow(item.routine, {
                                    letter: item.letter,
                                    planned: true,
                                }))}
                            </div>
                        </>
                    )}
                </section>
            )}

            {activeCycle && !nextRoutine && (
                <section className="session-setup-message">
                    <strong>{activeCycle.name}</strong>
                    <span>Il ciclo attivo non contiene una scheda disponibile per l’avvio.</span>
                </section>
            )}

            <section className="session-archive-section" aria-labelledby="session-archive-title">
                <div className="session-section-heading">
                    <div>
                        <h2 id="session-archive-title">Scegli dall’archivio</h2>
                        <p>{routines.length} {routines.length === 1 ? 'scheda' : 'schede'}</p>
                    </div>
                </div>

                <label className="session-search-field">
                    <Search size={20} aria-hidden="true" />
                    <span className="sr-only">Cerca scheda per nome</span>
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={event => setSearchQuery(event.target.value)}
                        placeholder="Cerca scheda per nome"
                    />
                </label>

                {filteredRoutines.length > 0 ? (
                    <div className="session-routine-list">
                        {filteredRoutines.map(routine => renderRoutineRow(routine))}
                    </div>
                ) : (
                    <div className="session-setup-message">Nessuna scheda trovata.</div>
                )}
            </section>

            <div className="session-free-row">
                <button
                    type="button"
                    className="btn btn-secondary session-free-button"
                    onClick={() => void startFreeWorkout()}
                >
                    Allenamento libero
                </button>
                {onNavigateToPlanning && (
                    <button
                        type="button"
                        className="session-planning-button"
                        onClick={onNavigateToPlanning}
                        aria-label="Vai a Pianificazione"
                        title="Vai a Pianificazione"
                    >
                        <CalendarRange size={20} aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
};
