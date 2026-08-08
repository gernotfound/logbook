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

    const handleAddRoutineById = (routineId: string) => {
        if (!routineId) return;
        const exists = cycleRoutines.find(r => r.routineId === routineId);
        if (exists) {
            setCycleRoutines(prev =>
                prev.map(r => r.routineId === routineId ? { ...r, frequencyPerWeek: r.frequencyPerWeek + 1 } : r)
            );
        } else {
            setCycleRoutines(prev => [
                ...prev,
                { routineId, frequencyPerWeek: 1 }
            ]);
        }
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
                    ✕ Chiudi
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

                {/* Selettore schede rapido ed ordinato */}
                <div className="mb-12">
                    <select
                        onChange={e => {
                            if (e.target.value) {
                                handleAddRoutineById(e.target.value);
                                e.target.value = '';
                            }
                        }}
                        style={{
                            width: '100%',
                            fontSize: '16px',
                            boxSizing: 'border-box',
                            maxWidth: '100%',
                            display: 'block',
                            padding: '10px 12px',
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '8px',
                            color: '#fff'
                        }}
                    >
                        <option value="">+ Aggiungi scheda al ciclo</option>
                        {routines.map(r => (
                            <option key={r.id} value={r.id}>
                                {r.name} ({r.exercises?.length || 0} es.)
                            </option>
                        ))}
                    </select>
                </div>

                {cycleRoutines.length === 0 ? (
                    <div style={{ padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <p className="m-0 text-xs">Nessuna scheda aggiunta al ciclo. Seleziona una scheda dal menu in alto per iniziare.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {cycleRoutines.map(item => {
                            const routine = routines.find(r => r.id === item.routineId);
                            return (
                                <div
                                    key={item.routineId}
                                    style={{
                                        padding: '10px 12px',
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid var(--glass-border)',
                                        borderRadius: '8px'
                                    }}
                                >
                                    <div className="flex-between items-center mb-6">
                                        <div>
                                            <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: 'var(--text-main)' }}>
                                                {routine?.name || 'Scheda'}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                {routine?.exercises?.length || 0} esercizi
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn-icon"
                                            style={{ color: 'var(--danger-color)', fontSize: '1rem', padding: '4px' }}
                                            onClick={() => handleRemoveRoutine(item.routineId)}
                                            title="Rimuovi scheda dal ciclo"
                                        >
                                            🗑️
                                        </button>
                                    </div>

                                    <div className="flex-between items-center pt-6 border-t" style={{ fontSize: '0.8rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>
                                            Frequenza settimanale:
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-small"
                                                style={{ padding: '3px 10px', minWidth: '32px', marginBottom: 0, fontSize: '0.85rem' }}
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
                                                style={{ padding: '3px 10px', minWidth: '32px', marginBottom: 0, fontSize: '0.85rem' }}
                                                onClick={() => handleUpdateFrequency(item.routineId, 1)}
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Pulsanti di azione ordinati e bilanciati */}
            <div className="flex gap-10 mt-20" style={{ width: '100%', minWidth: 0 }}>
                <button
                    type="button"
                    className="btn flex-1"
                    style={{ background: 'rgba(255,255,255,0.08)', marginBottom: 0 }}
                    onClick={onCancel}
                >
                    Annulla
                </button>
                <button
                    type="submit"
                    className="btn btn-primary flex-2"
                    style={{ marginBottom: 0 }}
                >
                    {initialCycle ? '💾 Salva modifiche' : '💾 Salva ciclo'}
                </button>
            </div>
        </form>
    );
};
