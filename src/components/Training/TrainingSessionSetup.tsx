import { useEffect, useMemo, useState } from 'react';
import { Dumbbell, Play, Target } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { Logic } from '../../lib/logic';
import type { TrainingCycle, WorkoutRoutine } from '../../types';

const EMPTY_CYCLES: TrainingCycle[] = [];

interface PlannedRoutineItem {
    cycleItem: any;
    routine: WorkoutRoutine;
    letter: string;
    position: number;
}

export interface TrainingSessionSetupProps {
    onNavigateToPlanning?: () => void;
}

export const TrainingSessionSetup = ({ onNavigateToPlanning }: TrainingSessionSetupProps) => {
    const trainingCycles = useAppStore(state => state.userData?.trainingCycles || EMPTY_CYCLES);
    const activeCycleId = useAppStore(state => state.userData?.activeCycleId ?? null);
    const activeCycle = activeCycleId ? trainingCycles.find(cycle => cycle.id === activeCycleId) : null;
    const { routines, history, startWorkout, selectedRoutine, setSelectedRoutine } = useWorkoutSession();

    const plannedRoutines: PlannedRoutineItem[] = useMemo(() => {
        if (!activeCycle || !activeCycle.routines) return [];
        return activeCycle.routines
            .map((item: any, index: number) => {
                const found = routines.find(routine => routine.id === item.routineId);
                return { cycleItem: item, routine: found, letter: String.fromCharCode(65 + (index % 26)), position: index + 1 };
            })
            .filter((item): item is PlannedRoutineItem => item.routine !== undefined);
    }, [activeCycle, routines]);

    const nextScheduled = useMemo(() => Logic.getNextScheduledRoutine(activeCycle, routines, history), [activeCycle, routines, history]);
    const [selectedPlannedRoutine, setSelectedPlannedRoutine] = useState('');

    useEffect(() => {
        if (nextScheduled?.nextRoutineId) setSelectedPlannedRoutine(nextScheduled.nextRoutineId);
        else if (plannedRoutines.length > 0 && plannedRoutines[0].routine?.id) setSelectedPlannedRoutine(plannedRoutines[0].routine.id);
        else setSelectedPlannedRoutine('');
    }, [activeCycle?.id, nextScheduled?.nextRoutineId, plannedRoutines]);

    return (
        <div className="tab-pane active fade-in workout-start-view" id="train-session">
            <section className="workout-start-card workout-start-card--planned">
                <header className="workout-start-card__header">
                    <div className="workout-start-card__icon"><Target size={19} aria-hidden="true" /></div>
                    <div>
                        <span className="page-header__eyebrow">Programmazione</span>
                        <h2>Avvia sessione pianificata</h2>
                        <p>{activeCycle ? `Ciclo attivo: ${activeCycle.name}` : 'Nessun ciclo di allenamento attivo.'}</p>
                    </div>
                    {activeCycle && <span className="workout-cycle-badge">{activeCycle.name}</span>}
                </header>

                {activeCycle ? (
                    plannedRoutines.length === 0 ? (
                        <div className="workout-start-empty">
                            <p>Nessuna scheda valida trovata nel ciclo attivo “{activeCycle.name}”.</p>
                            {onNavigateToPlanning && <button type="button" className="btn btn-secondary btn-small" onClick={onNavigateToPlanning}>Modifica ciclo in Pianificazione</button>}
                        </div>
                    ) : (
                        <div className="workout-start-card__content">
                            {nextScheduled?.nextRoutine && (
                                <div className="next-workout-card">
                                    <div className="next-workout-card__meta">
                                        <span>Prossima in programma</span>
                                        <small>Seduta #{nextScheduled.nextSessionIndex} di {nextScheduled.totalSessions}</small>
                                    </div>
                                    <h3>{nextScheduled.nextRoutine.name}</h3>
                                    <p>Rotazione {nextScheduled.rotationNumber} · Scheda {nextScheduled.positionInRotation} di {nextScheduled.totalRoutinesInCycle} · {(nextScheduled.nextRoutine.exercises || []).length} esercizi</p>
                                    <button type="button" className="btn btn-primary" onClick={() => startWorkout(nextScheduled.nextRoutine!.id, { cycleId: activeCycle.id, cycleName: activeCycle.name })}>
                                        <Play size={18} aria-hidden="true" /> Avvia {nextScheduled.nextRoutine.name} (Seduta #{nextScheduled.nextSessionIndex})
                                    </button>
                                </div>
                            )}

                            <div className="workout-start-alternative">
                                <label htmlFor="rotation-routine-select">Oppure scegli un'altra scheda della rotazione</label>
                                <select id="rotation-routine-select" aria-label="Seleziona scheda della rotazione" value={selectedPlannedRoutine} onChange={event => setSelectedPlannedRoutine(event.target.value)}>
                                    <option value="">Seleziona scheda della rotazione</option>
                                    {plannedRoutines.map(({ routine, letter, position }) => (
                                        <option key={routine.id} value={routine.id}>{letter}. {routine.name} (Posizione {position}/{plannedRoutines.length} · {(routine.exercises || []).length} es.)</option>
                                    ))}
                                </select>
                                {selectedPlannedRoutine && (
                                    <button type="button" className="btn btn-secondary" onClick={() => startWorkout(selectedPlannedRoutine, { cycleId: activeCycle.id, cycleName: activeCycle.name })}>
                                        <Dumbbell size={18} aria-hidden="true" /> Avvia {plannedRoutines.find(item => item.routine?.id === selectedPlannedRoutine)?.routine?.name || 'scheda selezionata'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                ) : (
                    <div className="workout-start-empty">
                        <p>Nessun ciclo di allenamento attivo al momento.</p>
                        {onNavigateToPlanning && <button type="button" className="btn btn-secondary btn-small" onClick={onNavigateToPlanning}><Target size={16} /> Vai a Pianificazione</button>}
                    </div>
                )}
            </section>

            <section className="workout-start-card">
                <header className="workout-start-card__header">
                    <div className="workout-start-card__icon"><Dumbbell size={19} aria-hidden="true" /></div>
                    <div>
                        <span className="page-header__eyebrow">Archivio schede</span>
                        <h2>Avvia nuova sessione</h2>
                        <p>Seleziona liberamente qualsiasi scheda dal tuo archivio.</p>
                    </div>
                </header>
                {routines.length === 0 ? (
                    <div className="workout-start-empty"><p>Non hai ancora creato nessuna scheda. Vai in “Schede” per crearne una e aggiungerci degli esercizi.</p></div>
                ) : (
                    <div className="workout-start-alternative workout-start-alternative--standalone">
                        <select id="archive-routine-select" aria-label="Seleziona scheda dall'archivio" value={selectedRoutine} onChange={event => setSelectedRoutine(event.target.value)}>
                            <option value="">Seleziona scheda</option>
                            {routines.map(routine => <option key={routine.id} value={routine.id}>{routine.name} ({(routine.exercises || []).length} es.)</option>)}
                        </select>
                        <button type="button" className="btn btn-secondary" onClick={() => startWorkout(selectedRoutine)} disabled={!selectedRoutine}>
                            <Play size={18} aria-hidden="true" /> Inizia allenamento
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
};
