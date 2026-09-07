import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useWorkoutSession } from '../../hooks/useWorkoutSession';
import { Logic } from '../../lib/logic';
import type { TrainingCycle, WorkoutRoutine } from '../../types';

// Responsabilità: renderizzare la UI per la configurazione e l'avvio di una nuova sessione di allenamento.
// Props: onNavigateToPlanning (callback per navigare alla pianificazione).
// Effetti: Invia il comando di avvio sessione tramite useWorkoutSession.

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
    const activeCycle = activeCycleId ? trainingCycles.find(c => c.id === activeCycleId) : null;
    
    const { routines, history, startWorkout, selectedRoutine, setSelectedRoutine } = useWorkoutSession();

    const plannedRoutines: PlannedRoutineItem[] = useMemo(() => {
        if (!activeCycle || !activeCycle.routines) return [];
        return activeCycle.routines
            .map((item: any, idx: number) => {
                const found = routines.find(r => r.id === item.routineId);
                const letter = String.fromCharCode(65 + (idx % 26));
                return {
                    cycleItem: item,
                    routine: found,
                    letter,
                    position: idx + 1
                };
            })
            .filter((item): item is PlannedRoutineItem => item.routine !== undefined);
    }, [activeCycle, routines]);

    const nextScheduled = useMemo(() => {
        return Logic.getNextScheduledRoutine(activeCycle, routines, history);
    }, [activeCycle, routines, history]);

    const [selectedPlannedRoutine, setSelectedPlannedRoutine] = useState('');

    useEffect(() => {
        if (nextScheduled?.nextRoutineId) {
            setSelectedPlannedRoutine(nextScheduled.nextRoutineId);
        } else if (plannedRoutines.length > 0 && plannedRoutines[0].routine?.id) {
            setSelectedPlannedRoutine(plannedRoutines[0].routine.id);
        } else {
            setSelectedPlannedRoutine('');
        }
    }, [activeCycle?.id, nextScheduled?.nextRoutineId, plannedRoutines]);

    return (
        <div className="tab-pane active fade-in" id="train-session">
            {/* 1. Sezione Avvia sessione pianificata */}
            <div className="section-divider">
                <div className="flex-between items-center mb-10 pb-8 border-b">
                    <div>
                        <span className="text-xs text-primary font-bold uppercase tracking-wider block">
                            Programmazione
                        </span>
                        <h2 className="m-0 text-white">
                            🎯 Avvia sessione pianificata
                        </h2>
                    </div>
                    {activeCycle && (
                        <span
                            style={{
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                background: 'var(--primary-color)',
                                color: '#000'
                            }}
                        >
                            {activeCycle.name}
                        </span>
                    )}
                </div>

                {activeCycle ? (
                    plannedRoutines.length === 0 ? (
                        <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            <p className="m-0 mb-8">Nessuna scheda valida trovata nel ciclo attivo "{activeCycle.name}".</p>
                            {onNavigateToPlanning && (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-small"
                                    style={{ fontSize: '0.85rem', marginBottom: 0 }}
                                    onClick={onNavigateToPlanning}
                                >
                                    Modifica ciclo in Pianificazione
                                </button>
                            )}
                        </div>
                    ) : (
                        <div>
                            {nextScheduled?.nextRoutine && (
                                <div
                                    style={{
                                        padding: '12px',
                                        background: 'rgba(14, 165, 233, 0.1)',
                                        border: '1px solid rgba(14, 165, 233, 0.3)',
                                        borderRadius: '8px',
                                        marginBottom: '15px'
                                    }}
                                >
                                    <div className="flex-between items-center mb-6">
                                        <span style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                            Prossima in programma
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            Seduta #{nextScheduled.nextSessionIndex} di {nextScheduled.totalSessions}
                                        </span>
                                    </div>

                                    <div className="flex-between items-center mb-10">
                                        <div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#fff' }}>
                                                {nextScheduled.nextRoutine.name}
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                Rotazione {nextScheduled.rotationNumber} • Scheda {nextScheduled.positionInRotation} di {nextScheduled.totalRoutinesInCycle} • {(nextScheduled.nextRoutine.exercises || []).length} esercizi
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        style={{ width: '100%', marginBottom: 0, fontWeight: 'bold' }}
                                        onClick={() => startWorkout(nextScheduled.nextRoutine!.id, { cycleId: activeCycle.id, cycleName: activeCycle.name })}
                                    >
                                        <span aria-hidden="true">🏋️</span> Avvia {nextScheduled.nextRoutine.name} (Seduta #{nextScheduled.nextSessionIndex})
                                    </button>
                                </div>
                            )}

                            <div className="border-t pt-10">
                                <label htmlFor="rotation-routine-select" className="text-xs text-muted font-bold block mb-6">
                                    Oppure scegli un'altra scheda della rotazione:
                                </label>
                                <div className="form-group mb-10">
                                    <select
                                        id="rotation-routine-select"
                                        aria-label="Seleziona scheda della rotazione"
                                        value={selectedPlannedRoutine}
                                        onChange={e => setSelectedPlannedRoutine(e.target.value)}
                                        className="w-full p-10 bg-surface text-white border-b rounded-8"
                                        style={{ fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block', appearance: 'none' }}
                                    >
                                        <option value="">+ Seleziona scheda della rotazione</option>
                                        {plannedRoutines.map(({ routine, letter, position }) => (
                                            <option key={routine!.id} value={routine!.id}>
                                                {letter}. {routine!.name} (Posizione {position}/{plannedRoutines.length} • {(routine!.exercises || []).length} es.)
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {selectedPlannedRoutine && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ width: '100%', marginBottom: 0 }}
                                        onClick={() => startWorkout(selectedPlannedRoutine, { cycleId: activeCycle.id, cycleName: activeCycle.name })}
                                    >
                                        <span aria-hidden="true">🏋️</span> Avvia {plannedRoutines.find(p => p.routine?.id === selectedPlannedRoutine)?.routine?.name || 'scheda selezionata'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                ) : (
                    <div style={{ padding: '8px 0', color: 'var(--text-muted)' }}>
                        <p className="text-xs m-0 mb-10">
                            Nessun ciclo di allenamento attivo al momento.
                        </p>
                        {onNavigateToPlanning && (
                            <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                style={{ fontSize: '0.85rem', marginBottom: 0 }}
                                onClick={onNavigateToPlanning}
                            >
                                <span aria-hidden="true">🎯</span> Vai a Pianificazione
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* 2. Sezione Avvia nuova sessione (Tutte le schede / Libera) */}
            <div className="section-divider-last">
                <div className="flex-between items-center mb-10 pb-8 border-b">
                    <div>
                        <h2 className="m-0">
                            Avvia nuova sessione
                        </h2>
                        <label htmlFor="archive-routine-select" className="text-muted text-xs m-0 mt-4 block">
                            Seleziona liberamente qualsiasi scheda dal tuo archivio
                        </label>
                    </div>
                </div>
                {routines.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Non hai ancora creato nessuna scheda. Vai in 'Schede' per crearne una e aggiungerci degli esercizi.
                    </p>
                ) : (
                    <div>
                        <div className="form-group mb-12">
                            <select 
                                id="archive-routine-select"
                                aria-label="Seleziona scheda dall'archivio"
                                value={selectedRoutine} 
                                onChange={e => setSelectedRoutine(e.target.value)}
                                className="w-full p-10 bg-surface text-white border-b rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block', appearance: 'none' }}
                            >
                                <option value="">+ Seleziona scheda</option>
                                {routines.map(r => (
                                    <option key={r.id} value={r.id}>
                                        {r.name} ({(r.exercises || []).length} es.)
                                    </option>
                                ))}
                            </select>
                        </div>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ width: '100%', marginBottom: 0 }}
                            onClick={() => startWorkout(selectedRoutine)}
                        >
                            <span aria-hidden="true">🏋️</span> Inizia allenamento
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
