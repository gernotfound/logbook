import { useState, useMemo } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useDialogStore } from '../../../store/useDialogStore';
import { Logic } from '../../../lib/logic';
import MuscleModel from '../MuscleModel';
import { CycleEditor } from './CycleEditor';
import { CycleCard } from './CycleCard';
import type { TrainingCycle, WorkoutRoutine, Exercise } from '../../../types';

export default function TrainingPlanning() {
    const userData = useAppStore(state => state.userData);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

    const routines: WorkoutRoutine[] = userData?.routines || [];
    const library: Exercise[] = userData?.library || [];
    const trainingCycles: TrainingCycle[] = userData?.trainingCycles || [];
    const activeCycleId = userData?.activeCycleId ?? null;

    const [isEditing, setIsEditing] = useState(false);
    const [editingCycle, setEditingCycle] = useState<TrainingCycle | null>(null);

    const activeCycle = useMemo(() => {
        if (!activeCycleId) return null;
        return trainingCycles.find(c => c.id === activeCycleId) || null;
    }, [trainingCycles, activeCycleId]);

    // Volume and muscle mapping for active cycle
    const cycleVolumeData = useMemo(() => {
        return Logic.calculateCycleVolume(activeCycle, routines, library);
    }, [activeCycle, routines, library]);

    const handleCreateNew = () => {
        if (routines.length === 0) {
            showAlert("Crea almeno una scheda prima di pianificare un ciclo di allenamento.");
            return;
        }
        setEditingCycle(null);
        setIsEditing(true);
    };

    const handleEditCycle = (cycle: TrainingCycle) => {
        setEditingCycle(cycle);
        setIsEditing(true);
    };

    const handleSaveCycle = async (savedCycle: TrainingCycle) => {
        if (!userData) return;

        let updatedCycles: TrainingCycle[];
        const exists = trainingCycles.some(c => c.id === savedCycle.id);

        if (exists) {
            updatedCycles = trainingCycles.map(c => c.id === savedCycle.id ? savedCycle : c);
        } else {
            updatedCycles = [...trainingCycles, savedCycle];
        }

        // Set as active if it's the only cycle or newly created and no active cycle set
        const newActiveId = activeCycleId || savedCycle.id;

        try {
            await saveUserData({
                ...userData,
                trainingCycles: updatedCycles,
                activeCycleId: newActiveId
            });
            setIsEditing(false);
            setEditingCycle(null);
            await showAlert(exists ? "Ciclo di allenamento aggiornato!" : "Nuovo ciclo salvato con successo!");
        } catch {
            await showAlert("Errore durante il salvataggio del ciclo.");
        }
    };

    const handleSetActiveCycle = async (cycleId: string) => {
        if (!userData) return;
        try {
            await saveUserData({
                ...userData,
                activeCycleId: cycleId
            });
            await showAlert("Ciclo impostato come attivo!");
        } catch {
            await showAlert("Errore durante l'attivazione del ciclo.");
        }
    };

    const handleDeactivateCycle = async () => {
        if (!userData) return;
        try {
            await saveUserData({
                ...userData,
                activeCycleId: null
            });
            await showAlert("Ciclo disattivato con successo.");
        } catch {
            await showAlert("Errore durante la disattivazione del ciclo.");
        }
    };

    const handleDuplicateCycle = async (cycle: TrainingCycle) => {
        if (!userData) return;
        const duplicated: TrainingCycle = {
            ...cycle,
            id: Logic.generateId('cycle'),
            name: `${cycle.name} (Copia)`,
            createdAt: Date.now(),
            isActive: false
        };

        const updatedCycles = [...trainingCycles, duplicated];
        try {
            await saveUserData({
                ...userData,
                trainingCycles: updatedCycles
            });
            await showAlert(`Ciclo "${duplicated.name}" duplicato con successo.`);
        } catch {
            await showAlert("Errore durante la duplicazione del ciclo.");
        }
    };

    const handleDeleteCycle = async (cycle: TrainingCycle) => {
        if (!userData) return;
        const confirmed = await showConfirm(`Sei sicuro di voler eliminare il ciclo "${cycle.name}"?`);
        if (!confirmed) return;

        const updatedCycles = trainingCycles.filter(c => c.id !== cycle.id);
        const nextActiveId = activeCycleId === cycle.id 
            ? (updatedCycles.length > 0 ? updatedCycles[0].id : null) 
            : activeCycleId;

        try {
            await saveUserData({
                ...userData,
                trainingCycles: updatedCycles,
                activeCycleId: nextActiveId
            });
            await showAlert("Ciclo eliminato con successo.");
        } catch {
            await showAlert("Errore durante l'eliminazione del ciclo.");
        }
    };

    return (
        <div>
            {/* Header */}
            <div className="card mb-15">
                <div className="flex-between items-center">
                    <div>
                        <h3 className="m-0" style={{ color: 'var(--primary-color)' }}>🎯 Pianificazione</h3>
                        <p className="text-muted text-xs m-0 mt-4">
                            Periodizzazione, split settimanale e volume di allenamento muscolare
                        </p>
                    </div>
                    {!isEditing && (
                        <button
                            type="button"
                            className="btn btn-primary btn-small"
                            onClick={handleCreateNew}
                            style={{ marginBottom: 0 }}
                        >
                            ➕ Nuovo ciclo
                        </button>
                    )}
                </div>
            </div>

            {/* Cycle Editor Form */}
            {isEditing && (
                <CycleEditor
                    initialCycle={editingCycle}
                    routines={routines}
                    onSave={handleSaveCycle}
                    onCancel={() => {
                        setIsEditing(false);
                        setEditingCycle(null);
                    }}
                />
            )}

            {/* Active Cycle Overview */}
            <div className="card mb-15">
                <div className="flex-between items-center mb-10 pb-10 border-b">
                    <div>
                        <span className="text-xs text-muted font-bold uppercase tracking-wider block">
                            Ciclo attivo
                        </span>
                        <h3 className="m-0 text-white" style={{ fontSize: '1.2rem' }}>
                            {activeCycle?.name || 'Nessun ciclo attivo'}
                        </h3>
                    </div>
                    {activeCycle && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--primary-color)', fontWeight: 'bold' }}>
                                    {activeCycle.durationWeeks} settimane
                                </span>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-small"
                                    style={{ padding: '3px 8px', fontSize: '0.75rem', marginBottom: 0, color: 'var(--text-muted)' }}
                                    onClick={handleDeactivateCycle}
                                    title="Disattiva ciclo attivo"
                                >
                                    ⏸️ Disattiva
                                </button>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {cycleVolumeData.totalWorkoutsPerWeek} sessioni • {cycleVolumeData.totalSetsPerWeek} serie / sett.
                            </div>
                        </div>
                    )}
                </div>

                {activeCycle?.notes && (
                    <p className="text-xs text-muted mb-15" style={{ fontStyle: 'italic' }}>
                        "{activeCycle.notes}"
                    </p>
                )}

                {/* Manichino Muscolare Vettoriale (Sempre visibile come da Regola 5) */}
                <div className="mb-15 flex-center w-full flex-col">
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold' }}>
                        Mappa muscolare del ciclo settimanale
                    </div>
                    <div style={{ width: '100%', maxWidth: '400px', display: 'flex', justifyContent: 'center' }}>
                        <MuscleModel
                            muscleColors={cycleVolumeData.muscleColors}
                            selectedMuscles={cycleVolumeData.highlightedMuscles}
                        />
                    </div>
                </div>

                {/* Dettaglio Volume Muscolare per Gruppo */}
                {activeCycle ? (
                    <div>
                        <h4 className="text-sm font-bold text-white mb-10" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>📊 Volume settimanale per muscolo</span>
                            <span className="text-xs text-muted font-normal">(serie a settimana)</span>
                        </h4>

                        {cycleVolumeData.muscleVolumes.length === 0 ? (
                            <p className="text-xs text-muted">
                                Nessun esercizio presente nelle schede di questo ciclo.
                            </p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {cycleVolumeData.muscleVolumes.map((item, idx) => (
                                    <div
                                        key={item.key || idx}
                                        style={{
                                            padding: '8px 12px',
                                            background: 'rgba(255,255,255,0.04)',
                                            borderRadius: '8px',
                                            border: '1px solid var(--glass-border)'
                                        }}
                                    >
                                        <div className="flex-between items-center mb-4">
                                            <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                                                {item.label}
                                            </span>
                                            <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--primary-color)' }}>
                                                {item.sets} {item.sets === 1 ? 'serie' : 'serie'} / sett.
                                            </span>
                                        </div>
                                        {/* Barra proporzionale */}
                                        <div
                                            style={{
                                                width: '100%',
                                                height: '6px',
                                                background: 'rgba(255,255,255,0.1)',
                                                borderRadius: '3px',
                                                overflow: 'hidden'
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: `${Math.min(100, Math.max(8, item.percentage * 2.5))}%`,
                                                    height: '100%',
                                                    background: 'linear-gradient(90deg, var(--primary-color), #38bdf8)',
                                                    borderRadius: '3px'
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Schede del ciclo attivo */}
                        <div className="mt-15 pt-15 border-t">
                            <span className="text-xs text-muted font-bold block mb-8">
                                Schede assegnate a questo ciclo
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {(activeCycle.routines || []).map(item => {
                                    const routine = routines.find(r => r.id === item.routineId);
                                    return (
                                        <div
                                            key={item.routineId}
                                            style={{
                                                padding: '6px 10px',
                                                borderRadius: '8px',
                                                background: 'rgba(255,255,255,0.05)',
                                                border: '1px solid var(--glass-border)',
                                                fontSize: '0.8rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px'
                                            }}
                                        >
                                            <span style={{ fontWeight: 'bold' }}>{routine?.name || 'Scheda'}</span>
                                            <span
                                                style={{
                                                    fontSize: '0.7rem',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    background: 'rgba(14, 165, 233, 0.15)',
                                                    color: 'var(--primary-color)',
                                                    fontWeight: 'bold'
                                                }}
                                            >
                                                {item.frequencyPerWeek}x / sett.
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', padding: '15px 10px', color: 'var(--text-muted)' }}>
                        <p className="m-0 text-sm font-semibold text-white">Nessun ciclo di allenamento attivo</p>
                        <p className="m-0 text-xs text-muted mt-4">
                            Utilizza il pulsante &quot;+ Nuovo ciclo&quot; in alto per impostare la tua prima programmazione.
                        </p>
                    </div>
                )}
            </div>

            {/* Cycles Archive */}
            <div className="card">
                <div className="flex-between mb-10 pb-10 border-b items-center">
                    <span className="text-sm font-bold text-muted">
                        I tuoi cicli di allenamento ({trainingCycles.length})
                    </span>
                </div>

                {trainingCycles.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '25px 10px', color: 'var(--text-muted)' }}>
                        <p className="m-0 text-xs">Nessun ciclo salvato nell'archivio.</p>
                    </div>
                ) : (
                    trainingCycles.map(cycle => (
                        <CycleCard
                            key={cycle.id}
                            cycle={cycle}
                            isActive={cycle.id === activeCycleId}
                            routines={routines}
                            onSetActive={handleSetActiveCycle}
                            onDeactivate={handleDeactivateCycle}
                            onEdit={handleEditCycle}
                            onDuplicate={handleDuplicateCycle}
                            onDelete={handleDeleteCycle}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
