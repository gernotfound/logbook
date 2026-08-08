import React, { useState } from 'react';
import { Logic } from '../../../lib/logic';
import { useDialogStore } from '../../../store/useDialogStore';
import type { TrainingCycle, WorkoutRoutine, TrainingCycleRoutineItem } from '../../../types';

interface CycleEditorProps {
    initialCycle?: TrainingCycle | null;
    routines: WorkoutRoutine[];
    onSave: (cycleData: TrainingCycle) => void;
    onCancel: () => void;
}

export const CycleEditor: React.FC<CycleEditorProps> = ({
    initialCycle,
    routines,
    onSave,
    onCancel
}) => {
    const showAlert = useDialogStore(state => state.showAlert);
    const [name, setName] = useState(initialCycle?.name || '');
    const [durationWeeks, setDurationWeeks] = useState(
        initialCycle?.durationWeeks !== undefined ? String(initialCycle.durationWeeks) : '6'
    );
    const [notes, setNotes] = useState(initialCycle?.notes || '');
    const [cycleRoutines, setCycleRoutines] = useState<TrainingCycleRoutineItem[]>(
        initialCycle?.routines ? JSON.parse(JSON.stringify(initialCycle.routines)) : []
    );
    const [selectedRoutineToAdd, setSelectedRoutineToAdd] = useState('');

    const handleAddRoutine = () => {
        if (!selectedRoutineToAdd) return;
        const exists = cycleRoutines.find(r => r.routineId === selectedRoutineToAdd);
        if (exists) {
            setCycleRoutines(prev =>
                prev.map(r => r.routineId === selectedRoutineToAdd ? { ...r, frequencyPerWeek: r.frequencyPerWeek + 1 } : r)
            );
        } else {
            setCycleRoutines(prev => [
                ...prev,
                { routineId: selectedRoutineToAdd, frequencyPerWeek: 1 }
            ]);
        }
        setSelectedRoutineToAdd('');
    };

    const handleUpdateFrequency = (routineId: string, delta: number) => {
        setCycleRoutines(prev =>
            prev.map(r => {
                if (r.routineId !== routineId) return r;
                const newFreq = Math.max(1, r.frequencyPerWeek + delta);
                return { ...r, frequencyPerWeek: newFreq };
            })
        );
    };

    const handleRemoveRoutine = (routineId: string) => {
        setCycleRoutines(prev => prev.filter(r => r.routineId !== routineId));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            await showAlert("Inserisci un nome per il ciclo di allenamento.");
            return;
        }

        const weeks = Math.max(1, parseInt(durationWeeks, 10) || 4);

        const cycle: TrainingCycle = {
            id: initialCycle?.id || Logic.generateId('cycle'),
            name: trimmedName,
            durationWeeks: weeks,
            notes: notes.trim(),
            routines: cycleRoutines,
            createdAt: initialCycle?.createdAt || Date.now(),
            isActive: initialCycle?.isActive ?? false
        };

        onSave(cycle);
    };

    const totalWorkouts = cycleRoutines.reduce((sum, r) => sum + (r.frequencyPerWeek || 1), 0);

    return (
        <form onSubmit={handleSubmit} className="card mb-20" style={{ border: '1px solid var(--primary-color)' }}>
            <div className="flex-between mb-15 items-center">
                <h3 className="m-0" style={{ color: 'var(--primary-color)' }}>
                    {initialCycle ? '✏️ Modifica ciclo' : '➕ Nuovo ciclo di allenamento'}
                </h3>
                <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={onCancel}
                    style={{ marginBottom: 0 }}
                >
                    ✕ Annulla
                </button>
            </div>

            <div className="grid-2 gap-15 mb-15">
                <div>
                    <label className="text-xs text-muted font-bold block mb-4">
                        Nome ciclo
                    </label>
                    <input
                        type="text"
                        placeholder="Es. Mesociclo ipertrofia 4 giorni"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onFocus={e => e.target.select()}
                        required
                        style={{ width: '100%', fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block' }}
                    />
                </div>

                <div>
                    <label className="text-xs text-muted font-bold block mb-4">
                        Durata (settimane)
                    </label>
                    <input
                        type="number"
                        min="1"
                        max="52"
                        value={durationWeeks}
                        onChange={e => setDurationWeeks(e.target.value)}
                        onFocus={e => e.target.select()}
                        required
                        style={{ width: '100%', fontSize: '16px', boxSizing: 'border-box', maxWidth: '100%', display: 'block' }}
                    />
                </div>
            </div>

            <div className="mb-15">
                <label className="text-xs text-muted font-bold block mb-4">
                    Note o obiettivo (opzionale)
                </label>
                <textarea
                    placeholder="Es. Focus deltoidi laterali e dorso, progressione carichi..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    style={{ width: '100%', fontSize: '16px', borderRadius: '8px', padding: '10px', boxSizing: 'border-box', maxWidth: '100%', display: 'block' }}
                />
            </div>

            {/* Schede nel ciclo */}
            <div className="mb-15">
                <div className="flex-between items-center mb-8">
                    <label className="text-xs text-muted font-bold block">
                        Schede incluse nel ciclo ({cycleRoutines.length})
                    </label>
                    <span className="text-xs text-primary font-bold">
                        Totale: {totalWorkouts} {totalWorkouts === 1 ? 'allenamento' : 'allenamenti'} / sett.
                    </span>
                </div>

                {cycleRoutines.length === 0 ? (
                    <div style={{ padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <p className="m-0 text-xs">Nessuna scheda aggiunta al ciclo. Seleziona una scheda qui sotto per iniziare.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {cycleRoutines.map(item => {
                            const routine = routines.find(r => r.id === item.routineId);
                            return (
                                <div
                                    key={item.routineId}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '10px 12px',
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid var(--glass-border)',
                                        borderRadius: '8px',
                                        gap: '10px',
                                        minWidth: 0
                                    }}
                                >
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: 'var(--text-main)' }}>
                                            {routine?.name || 'Scheda'}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {routine?.exercises?.length || 0} esercizi
                                        </div>
                                    </div>

                                    {/* Frequenza controller */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: '2px' }}>
                                            Frequenza:
                                        </span>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-small"
                                            style={{ padding: '4px 10px', minWidth: '32px', marginBottom: 0 }}
                                            onClick={() => handleUpdateFrequency(item.routineId, -1)}
                                            disabled={item.frequencyPerWeek <= 1}
                                        >
                                            -
                                        </button>
                                        <span style={{ fontWeight: 'bold', minWidth: '30px', textAlign: 'center', color: 'var(--primary-color)' }}>
                                            {item.frequencyPerWeek}x
                                        </span>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-small"
                                            style={{ padding: '4px 10px', minWidth: '32px', marginBottom: 0 }}
                                            onClick={() => handleUpdateFrequency(item.routineId, 1)}
                                        >
                                            +
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-icon"
                                            style={{ color: 'var(--danger-color)', marginLeft: '6px', fontSize: '0.9rem' }}
                                            onClick={() => handleRemoveRoutine(item.routineId)}
                                            title="Rimuovi scheda dal ciclo"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Aggiunta scheda */}
            <div className="flex gap-10 items-center mb-20" style={{ minWidth: 0 }}>
                <select
                    value={selectedRoutineToAdd}
                    onChange={e => setSelectedRoutineToAdd(e.target.value)}
                    style={{ flex: 1, minWidth: 0, fontSize: '16px', marginBottom: 0, boxSizing: 'border-box', maxWidth: '100%' }}
                >
                    <option value="">-- Seleziona una scheda da aggiungere --</option>
                    {routines.map(r => (
                        <option key={r.id} value={r.id}>
                            {r.name} ({r.exercises?.length || 0} es.)
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleAddRoutine}
                    disabled={!selectedRoutineToAdd}
                    style={{ flexShrink: 0, marginBottom: 0 }}
                >
                    + Aggiungi
                </button>
            </div>

            <div className="flex gap-10">
                <button type="submit" className="btn btn-primary" style={{ flex: 1, marginBottom: 0 }}>
                    💾 Salva ciclo
                </button>
                <button type="button" className="btn btn-secondary" onClick={onCancel} style={{ marginBottom: 0 }}>
                    Annulla
                </button>
            </div>
        </form>
    );
};
