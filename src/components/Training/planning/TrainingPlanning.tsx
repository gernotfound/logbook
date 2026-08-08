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

    const activeCycleTimeline = useMemo(() => {
        return Logic.calculateCycleTimeline(activeCycle);
    }, [activeCycle]);

    const handleCreateNew = () => {
        if (routines.length === 0) {
            showAlert("Crea almeno una scheda prima di pianificare un ciclo di allenamento.");
            return;
        }
        setEditingCycle(null);
        setIsEditing(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('view-training')?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleEditCycle = (cycle: TrainingCycle) => {
        setEditingCycle(cycle);
        setIsEditing(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('view-training')?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSaveCycle = async (savedCycle: TrainingCycle) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return null;
                const currentCycles = prev.trainingCycles || [];
                const isUpdate = currentCycles.some(c => c.id === savedCycle.id);
                const updatedCycles = isUpdate
                    ? currentCycles.map(c => c.id === savedCycle.id ? savedCycle : c)
                    : [...currentCycles, savedCycle];
                const newActiveId = prev.activeCycleId !== undefined && prev.activeCycleId !== null
                    ? prev.activeCycleId
                    : (updatedCycles.length === 1 ? savedCycle.id : null);
                return {
                    ...prev,
                    trainingCycles: updatedCycles,
                    activeCycleId: newActiveId
                };
            });
            setIsEditing(false);
            setEditingCycle(null);
        } catch (e) {
            console.error("Errore salvataggio ciclo:", e);
        }
    };

    const handleSetActiveCycle = async (cycleId: string) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return null;
                return {
                    ...prev,
                    activeCycleId: cycleId
                };
            });
        } catch (e) {
            console.error("Errore attivazione ciclo:", e);
        }
    };

    const handleDeactivateCycle = async () => {
        try {
            await saveUserData((prev) => {
                if (!prev) return null;
                return {
                    ...prev,
                    activeCycleId: null
                };
            });
        } catch (e) {
            console.error("Errore disattivazione ciclo:", e);
        }
    };

    const handleDuplicateCycle = async (cycle: TrainingCycle) => {
        const duplicated: TrainingCycle = {
            ...cycle,
            id: Logic.generateId('cycle'),
            name: `${cycle.name} (Copia)`,
            createdAt: Date.now(),
            isActive: false
        };

        try {
            await saveUserData((prev) => {
                if (!prev) return null;
                const currentCycles = prev.trainingCycles || [];
                return {
                    ...prev,
                    trainingCycles: [...currentCycles, duplicated]
                };
            });
        } catch (e) {
            console.error("Errore duplicazione ciclo:", e);
        }
    };

    const handleDeleteCycle = async (cycle: TrainingCycle) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return null;
                const currentCycles = prev.trainingCycles || [];
                const updatedCycles = currentCycles.filter(c => c.id !== cycle.id);
                const nextActiveId = prev.activeCycleId === cycle.id 
                    ? (updatedCycles.length > 0 ? updatedCycles[0].id : null) 
                    : prev.activeCycleId;
                return {
                    ...prev,
                    trainingCycles: updatedCycles,
                    activeCycleId: nextActiveId
                };
            });
        } catch (e) {
            console.error("Errore eliminazione ciclo:", e);
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

                {activeCycle?.startDate && (
                    <div style={{ marginBottom: '15px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                        <div className="flex-between text-xs mb-6">
                            <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>
                                📅 {activeCycleTimeline.formattedRange}
                            </span>
                            <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>
                                {activeCycleTimeline.statusLabel} ({activeCycleTimeline.progressPercent}%)
                            </span>
                        </div>
                        <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div
                                style={{
                                    height: '100%',
                                    width: `${activeCycleTimeline.progressPercent}%`,
                                    background: 'var(--primary-color)',
                                    transition: 'width 0.3s ease'
                                }}
                            />
                        </div>
                    </div>
                )}

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
                                {(activeCycle.routines || []).map((item, idx) => {
                                    const routine = routines.find(r => r.id === item.routineId);
                                    const letterIndex = String.fromCharCode(65 + (idx % 26));
                                    return (
                                        <div
                                            key={`${item.routineId}-${idx}`}
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
                                            <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{letterIndex}.</span>
                                            <span style={{ fontWeight: 'bold' }}>{routine?.name || 'Scheda'}</span>
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
