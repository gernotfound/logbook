import { dispatchDurableOperation } from '../../../lib/sync/dispatchDurableOperation';
import { useMemo, useRef, useState } from 'react';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useDialogStore } from '../../../store/useDialogStore';
import { Logic } from '../../../lib/logic';
import { CycleEditor } from './CycleEditor';
import { CycleCard } from './CycleCard';
import { type ContextMenuItem } from '../../UI/ContextMenu';
import { ActiveCycleCard } from './ActiveCycleCard';
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
    const editorGenerationRef = useRef(0);
    const activeMutationRef = useRef(false);
    const [activeMutationPending, setActiveMutationPending] = useState(false);
    const activeCycle = useMemo(
        () => activeCycleId ? trainingCycles.find(cycle => cycle.id === activeCycleId) ?? null : null,
        [activeCycleId, trainingCycles]
    );
    const inactiveCycles = useMemo(
        () => trainingCycles.filter(cycle => cycle.id !== activeCycleId),
        [activeCycleId, trainingCycles]
    );


    const editingCycleHasRecordedSessions = useMemo(() => {
        if (!editingCycle) return false;
        const cycleId = editingCycle.id;
        return history.some(workout => workout.cycleId === cycleId)
            || localWorkout?.cycleId === cycleId
            || activeWorkout?.cycleId === cycleId;
    }, [activeWorkout, editingCycle, history, localWorkout]);

    const openEditorAtTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('view-training')?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCreateNew = () => {
        if (routines.length === 0) {
            void showAlert('Crea almeno una scheda prima di pianificare un ciclo di allenamento.');
            return;
        }
        editorGenerationRef.current += 1;
        setEditingCycle(null);
        setIsEditing(true);
        openEditorAtTop();
    };

    const handleCancelEditor = () => {
        editorGenerationRef.current += 1;
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

    const handleEditCycle = async (cycle: TrainingCycle) => {
        const generation = editorGenerationRef.current;
        if (isEditing) {
            if (editingCycle?.id === cycle.id) return;
            const confirmed = await showConfirm('L’editor attuale contiene modifiche che potrebbero non essere salvate. Vuoi abbandonarle e aprire un altro ciclo?');
            if (!confirmed || editorGenerationRef.current !== generation) return;
        }
        // A queued confirmation must not reopen a removed cycle or an outdated snapshot.
        const currentCycle = useAppStore.getState().userData?.trainingCycles?.find(item => item.id === cycle.id);
        if (!currentCycle) return;
        editorGenerationRef.current += 1;
        setEditingCycle(currentCycle);
        setIsEditing(true);
        openEditorAtTop();
    };

    const handleSaveCycle = async (savedCycle: TrainingCycle) => {
        const editorGeneration = editorGenerationRef.current;
        try {
            const isUpdate = trainingCycles.some(cycle => cycle.id === savedCycle.id);
            const operations: DomainOperation[] = [{ type: 'training-cycle.upsert', cycle: savedCycle }];
            if (activeCycleId === null && !isUpdate && trainingCycles.length === 0) {
                operations.push({ type: 'active-cycle.set', id: savedCycle.id });
            }
            await dispatchDurableOperation(dispatchDomainOperation, operations);
            // A different editor may have opened while IndexedDB/cloud settled.
            // The old completion cannot dismiss that newer unsaved draft.
            if (editorGenerationRef.current === editorGeneration) handleCancelEditor();
        } catch (error) {
            console.error('Errore salvataggio ciclo:', error);
            if (editorGenerationRef.current === editorGeneration) {
                await showAlert('Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.');
            }
        }
    };

    const handleSetActiveCycle = async (cycleId: string) => {
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'active-cycle.set', id: cycleId });
        } catch (error) {
            console.error('Errore attivazione ciclo:', error);
            await showAlert('Impossibile attivare il ciclo. Riprova.');
        }
    };

    const handleDeactivateCycle = async (cycleId: string) => {
        const confirmed = await showConfirm('Sei sicuro di voler disattivare il ciclo corrente?');
        if (!confirmed || useAppStore.getState().userData?.activeCycleId !== cycleId) return;
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'active-cycle.set', id: null });
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
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'training-cycle.upsert', cycle: duplicated });
        } catch (error) {
            console.error('Errore duplicazione ciclo:', error);
            await showAlert('Impossibile duplicare il ciclo. Riprova.');
        }
    };

    const handleDeleteCycle = async (cycle: TrainingCycle) => {
        const confirmed = await showConfirm(`Eliminare il ciclo “${cycle.name}”?`);
        if (!confirmed) return;
        try {
            const currentData = useAppStore.getState().userData;
            if (!currentData?.trainingCycles?.some(item => item.id === cycle.id)) return;
            const remaining = currentData.trainingCycles.filter(item => item.id !== cycle.id);
            const operations: DomainOperation[] = [{ type: 'training-cycle.delete', id: cycle.id }];
            if (currentData.activeCycleId === cycle.id) operations.push({ type: 'active-cycle.set', id: remaining[0]?.id ?? null });
            await dispatchDurableOperation(dispatchDomainOperation, operations);
        } catch (error) {
            console.error('Errore eliminazione ciclo:', error);
            await showAlert('Impossibile eliminare il ciclo. Riprova.');
        }
    };

    const runActiveMutation = async (action: () => void | Promise<void>) => {
        // Close the repeat-click window before React disables the active-cycle controls.
        if (activeMutationRef.current) return;
        activeMutationRef.current = true;
        setActiveMutationPending(true);
        try {
            await action();
        } catch (error) {
            console.error('Operazione sul ciclo attivo non completata:', error);
        } finally {
            activeMutationRef.current = false;
            setActiveMutationPending(false);
        }
    };

    const activeMenuItems: ContextMenuItem[] = activeCycle ? [
        { id: 'edit-active-cycle', label: 'Modifica', icon: <Pencil size={16} />, disabled: activeMutationPending, onClick: () => { void runActiveMutation(() => handleEditCycle(activeCycle)); } },
        { id: 'duplicate-active-cycle', label: 'Duplica', icon: <Copy size={16} />, disabled: activeMutationPending, onClick: () => { void runActiveMutation(() => handleDuplicateCycle(activeCycle)); } },
        { id: 'delete-active-cycle', label: 'Elimina', icon: <Trash2 size={16} />, variant: 'danger', disabled: activeMutationPending, onClick: () => { void runActiveMutation(() => handleDeleteCycle(activeCycle)); } }
    ] : [];

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
                    key={editingCycle?.id ?? 'new-cycle'}
                    initialCycle={editingCycle}
                    routines={routines}
                    library={library}
                    onSave={handleSaveCycle}
                    onCancel={handleCancelEditor}
                    hasRecordedSessions={editingCycleHasRecordedSessions}
                />
            ) : null}

            {activeCycle ? (
                <ActiveCycleCard
                    key={`active-cycle:${activeCycle.id}`}
                    activeCycle={activeCycle}
                    routines={routines}
                    library={library}
                    history={history}
                    activeMenuItems={activeMenuItems}
                    activeMutationPending={activeMutationPending}
                    onOpenSession={onOpenSession}
                    onDeactivate={() => { void runActiveMutation(() => handleDeactivateCycle(activeCycle.id)); }}
                />
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
