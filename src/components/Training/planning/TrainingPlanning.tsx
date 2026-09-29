import { useEffect, useMemo, useState } from 'react';
import { Copy, Dumbbell, Pencil, Trash2 } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useDialogStore } from '../../../store/useDialogStore';
import { Logic } from '../../../lib/logic';
import { CycleEditor } from './CycleEditor';
import { CycleCard } from './CycleCard';
import { CycleMuscleMap } from './CycleMuscleMap';
import { CycleStrategySummary } from './CycleStrategySummary';
import { CycleVolumeAccordion } from './CycleVolumeAccordion';
import { calculateCycleMacroVolume } from './cycleMacroVolume';
import { ContextMenu, type ContextMenuItem } from '../../UI/ContextMenu';
import type { DomainOperation } from '../../../lib/sync/domainOperations';
import type { Exercise, TrainingCycle, WorkoutRoutine, WorkoutSession } from '../../../types';
import './planning-redesign.css';

const EMPTY_ROUTINES: WorkoutRoutine[] = [];
const EMPTY_LIBRARY: Exercise[] = [];
const EMPTY_CYCLES: TrainingCycle[] = [];
const EMPTY_HISTORY: WorkoutSession[] = [];

interface TrainingPlanningProps {
    onOpenSession?: () => void;
}

export default function TrainingPlanning({ onOpenSession }: TrainingPlanningProps = {}) {
    const routines = useAppStore(state => state.userData?.routines || EMPTY_ROUTINES);
    const library = useAppStore(state => state.userData?.library || EMPTY_LIBRARY);
    const trainingCycles = useAppStore(state => state.userData?.trainingCycles || EMPTY_CYCLES);
    const history = useAppStore(state => state.userData?.history || EMPTY_HISTORY);
    const activeWorkout = useAppStore(state => state.userData?.activeWorkout ?? null);
    const localWorkout = useAppStore(state => state.localWorkout);
    const activeCycleId = useAppStore(state => state.userData?.activeCycleId ?? null);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

    const [isEditing, setIsEditing] = useState(false);
    const [editingCycle, setEditingCycle] = useState<TrainingCycle | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const activeCycle = useMemo(
        () => activeCycleId ? trainingCycles.find(cycle => cycle.id === activeCycleId) ?? null : null,
        [activeCycleId, trainingCycles]
    );
    const inactiveCycles = useMemo(
        () => trainingCycles.filter(cycle => cycle.id !== activeCycleId),
        [activeCycleId, trainingCycles]
    );

    useEffect(() => setIsDetailsOpen(false), [activeCycleId]);

    const editingCycleHasRecordedSessions = useMemo(() => {
        if (!editingCycle) return false;
        const cycleId = editingCycle.id;
        return history.some(workout => workout.cycleId === cycleId)
            || localWorkout?.cycleId === cycleId
            || activeWorkout?.cycleId === cycleId;
    }, [activeWorkout, editingCycle, history, localWorkout]);

    const cycleVolumeData = useMemo(
        () => Logic.calculateCycleVolume(activeCycle, routines, library),
        [activeCycle, library, routines]
    );
    const macroVolume = useMemo(
        () => calculateCycleMacroVolume(activeCycle, routines, library),
        [activeCycle, library, routines]
    );
    const activeCycleTimeline = useMemo(() => Logic.calculateCycleTimeline(activeCycle), [activeCycle]);
    const nextScheduled = useMemo(
        () => Logic.getNextScheduledRoutine(activeCycle, routines, history),
        [activeCycle, history, routines]
    );

    const openEditorAtTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('view-training')?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCreateNew = () => {
        if (routines.length === 0) {
            void showAlert('Crea almeno una scheda prima di pianificare un ciclo di allenamento.');
            return;
        }
        setEditingCycle(null);
        setIsEditing(true);
        openEditorAtTop();
    };

    const handleCancelEditor = () => {
        setIsEditing(false);
        setEditingCycle(null);
    };

    const handleToggleCreate = () => {
        if (isEditing && editingCycle === null) {
            handleCancelEditor();
            return;
        }
        handleCreateNew();
    };

    const handleEditCycle = (cycle: TrainingCycle) => {
        setEditingCycle(cycle);
        setIsEditing(true);
        openEditorAtTop();
    };

    const handleSaveCycle = async (savedCycle: TrainingCycle) => {
        try {
            const isUpdate = trainingCycles.some(cycle => cycle.id === savedCycle.id);
            const operations: DomainOperation[] = [{ type: 'training-cycle.upsert', cycle: savedCycle }];
            if (activeCycleId === null && !isUpdate && trainingCycles.length === 0) {
                operations.push({ type: 'active-cycle.set', id: savedCycle.id });
            }
            await dispatchDomainOperation(operations);
            handleCancelEditor();
        } catch (error) {
            console.error('Errore salvataggio ciclo:', error);
            await showAlert('Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.');
        }
    };

    const handleSetActiveCycle = async (cycleId: string) => {
        try {
            await dispatchDomainOperation({ type: 'active-cycle.set', id: cycleId });
        } catch (error) {
            console.error('Errore attivazione ciclo:', error);
            await showAlert('Impossibile attivare il ciclo. Riprova.');
        }
    };

    const handleDeactivateCycle = async (_cycleId?: string) => {
        const confirmed = await showConfirm('Sei sicuro di voler disattivare il ciclo corrente?');
        if (!confirmed) return;
        try {
            await dispatchDomainOperation({ type: 'active-cycle.set', id: null });
        } catch (error) {
            console.error('Errore disattivazione ciclo:', error);
            await showAlert('Impossibile disattivare il ciclo. Riprova.');
        }
    };

    const handleDuplicateCycle = async (cycle: TrainingCycle) => {
        const duplicated: TrainingCycle = {
            ...cycle,
            id: Logic.generateId('cycle'),
            name: Logic.generateUniqueName(cycle.name, trainingCycles.map(item => item.name)),
            createdAt: Date.now(),
            isActive: false
        };
        try {
            await dispatchDomainOperation({ type: 'training-cycle.upsert', cycle: duplicated });
        } catch (error) {
            console.error('Errore duplicazione ciclo:', error);
            await showAlert('Impossibile duplicare il ciclo. Riprova.');
        }
    };

    const handleDeleteCycle = async (cycle: TrainingCycle) => {
        const confirmed = await showConfirm(`Eliminare il ciclo “${cycle.name}”?`);
        if (!confirmed) return;
        try {
            const remaining = trainingCycles.filter(item => item.id !== cycle.id);
            const operations: DomainOperation[] = [{ type: 'training-cycle.delete', id: cycle.id }];
            if (activeCycleId === cycle.id) operations.push({ type: 'active-cycle.set', id: remaining[0]?.id ?? null });
            await dispatchDomainOperation(operations);
        } catch (error) {
            console.error('Errore eliminazione ciclo:', error);
            await showAlert('Impossibile eliminare il ciclo. Riprova.');
        }
    };

    const activeMenuItems: ContextMenuItem[] = activeCycle ? [
        { id: 'edit-active-cycle', label: 'Modifica', icon: <Pencil size={16} />, onClick: () => handleEditCycle(activeCycle) },
        { id: 'duplicate-active-cycle', label: 'Duplica', icon: <Copy size={16} />, onClick: () => void handleDuplicateCycle(activeCycle) },
        { id: 'delete-active-cycle', label: 'Elimina', icon: <Trash2 size={16} />, variant: 'danger', onClick: () => void handleDeleteCycle(activeCycle) }
    ] : [];

    const totalSessions = activeCycle
        ? activeCycle.durationWeeks * (activeCycle.sessionsPerWeek || activeCycle.routines?.length || 1)
        : 0;

    return (
        <div className="planning-page">
            <header className="planning-page-header">
                <h1>Pianificazione</h1>
                <button
                    type="button"
                    className="planning-create-button"
                    onClick={handleToggleCreate}
                    aria-label="Crea ciclo"
                    aria-expanded={isEditing}
                    aria-controls="cycle-editor-form"
                    hidden={isEditing}
                >
                    + Crea
                </button>
            </header>

            {isEditing ? (
                <CycleEditor
                    initialCycle={editingCycle}
                    routines={routines}
                    library={library}
                    onSave={handleSaveCycle}
                    onCancel={handleCancelEditor}
                    hasRecordedSessions={editingCycleHasRecordedSessions}
                />
            ) : null}

            {activeCycle ? (
                <article className="planning-active-card">
                    <header className="planning-active-head">
                        <div className="planning-active-title">
                            <span className="planning-active-badge">Ciclo attivo</span>
                            <h2>{activeCycle.name}</h2>
                            <p>{activeCycleTimeline.formattedRange} · {activeCycle.durationWeeks} settimane</p>
                            <CycleStrategySummary strategy={activeCycle.strategy} />
                        </div>
                        <ContextMenu items={activeMenuItems} />
                    </header>

                    {nextScheduled && !nextScheduled.isCycleCompleted ? (
                        <div className="planning-next-session">
                            <span className="planning-next-icon" aria-hidden="true"><Dumbbell size={24} /></span>
                            <div>
                                <span>Prossima seduta nella rotazione</span>
                                <strong>{nextScheduled.nextRoutineName}</strong>
                                <span>Seduta #{nextScheduled.nextSessionIndex} · scheda {nextScheduled.positionInRotation} di {nextScheduled.totalRoutinesInCycle}</span>
                            </div>
                        </div>
                    ) : null}

                    <div className="planning-kpis" aria-label="Metriche ciclo attivo">
                        <div><strong>{cycleVolumeData.totalWorkoutsPerWeek}×</strong><span>Sedute / sett.</span></div>
                        <div><strong>{cycleVolumeData.totalSetsPerWeek}</strong><span>Serie / sett.</span></div>
                        <div><strong>{totalSessions}</strong><span>Sedute totali</span></div>
                    </div>

                    <div className="planning-progress-copy">
                        <span><strong>{activeCycleTimeline.statusLabel}</strong></span>
                        <span>{activeCycleTimeline.progressPercent}% completato</span>
                    </div>
                    <div
                        className="planning-progress"
                        role="progressbar"
                        aria-label="Avanzamento del ciclo"
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
                        <button type="button" className="btn btn-primary" onClick={onOpenSession} disabled={!onOpenSession}>
                            Apri sessione
                        </button>
                        <button type="button" className="btn" onClick={() => void handleDeactivateCycle(activeCycle.id)}>
                            Disattiva ciclo
                        </button>
                    </div>

                    <div className="planning-active-details" hidden={!isDetailsOpen}>
                        <div className="planning-routine-chips" aria-label="Sequenza schede del ciclo attivo">
                            {(activeCycle.routines ?? []).map((item, index) => {
                                const routine = routines.find(candidate => candidate.id === item.routineId);
                                return (
                                    <span key={`${item.routineId}-${index}`}>
                                        <b>{String.fromCharCode(65 + (index % 26))}</b> {routine?.name ?? 'Scheda'}
                                    </span>
                                );
                            })}
                        </div>
                        <CycleMuscleMap
                            title="Mappa muscolare del ciclo"
                            highlightedMuscles={cycleVolumeData.highlightedMuscles}
                            emptyMessage="Le schede di questo ciclo non contengono ancora muscoli associati."
                        />
                        <CycleVolumeAccordion items={macroVolume} />
                    </div>
                </article>
            ) : (
                <div className="planning-empty-state">
                    <strong>Nessun ciclo attivo</strong>
                    <span>Crea un nuovo ciclo oppure impostane uno salvato come attivo.</span>
                </div>
            )}

            <section className="planning-cycle-archive" aria-labelledby="planning-cycle-archive-title">
                <header className="planning-section-head">
                    <h2 id="planning-cycle-archive-title">I tuoi cicli</h2>
                    <span>{trainingCycles.length} {trainingCycles.length === 1 ? 'ciclo' : 'cicli'}</span>
                </header>

                {inactiveCycles.length === 0 ? (
                    <div className="planning-empty-inline">Nessun altro ciclo salvato.</div>
                ) : (
                    <div className="planning-cycle-list">
                        {inactiveCycles.map(cycle => (
                            <CycleCard
                                key={cycle.id}
                                cycle={cycle}
                                isActive={false}
                                routines={routines}
                                onSetActive={handleSetActiveCycle}
                                onDeactivate={handleDeactivateCycle}
                                onEdit={handleEditCycle}
                                onDuplicate={handleDuplicateCycle}
                                onDelete={handleDeleteCycle}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
