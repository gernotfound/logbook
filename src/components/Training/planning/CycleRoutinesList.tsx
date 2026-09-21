// Responsabilità: mostrare la lista delle schede nel ciclo, permettendo di aggiungerle, riordinarle o rimuoverle.
// Props: cycleRoutines, routines, onAdd, onMove, onRemove.
// Effetti: puro componente visivo (memoizzato) che emette eventi.

import React, { memo } from 'react';
import { Trash2 } from 'lucide-react';
import type { TrainingCycleRoutineItem, WorkoutRoutine } from '../../../types';

interface CycleRoutinesListProps {
    cycleRoutines: TrainingCycleRoutineItem[];
    routines: WorkoutRoutine[];
    onAdd: (routineId: string) => void;
    onMove: (index: number, direction: -1 | 1) => void;
    onRemove: (index: number) => void;
}

export const CycleRoutinesList: React.FC<CycleRoutinesListProps> = memo(({
    cycleRoutines,
    routines,
    onAdd,
    onMove,
    onRemove
}) => {
    return (
        <div className="mb-15">
            <div className="flex-between items-center mb-8">
                <div>
                    <label className="text-xs text-muted font-bold block">
                        Sequenza rotazione schede ({cycleRoutines.length})
                    </label>
                    <span className="text-xs text-muted">
                        Ordine di esecuzione continua da una seduta alla successiva
                    </span>
                </div>
            </div>

            <div className="mb-12">
                <select
                    onChange={e => {
                        if (e.target.value) {
                            onAdd(e.target.value);
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
                        background: 'var(--surface-light)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        color: 'var(--text-main)'
                    }}
                >
                    <option value="">+ Aggiungi scheda alla sequenza</option>
                    {routines.map(r => (
                        <option key={r.id} value={r.id}>
                            {r.name} ({r.exercises?.length || 0} es.)
                        </option>
                    ))}
                </select>
            </div>

            {cycleRoutines.length === 0 ? (
                <div style={{ padding: '15px', background: 'var(--surface-light)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <p className="m-0 text-xs">Nessuna scheda aggiunta al ciclo. Seleziona una scheda dal menu in alto per iniziare la sequenza.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {cycleRoutines.map((item, idx) => {
                        const routine = routines.find(r => r.id === item.routineId);
                        const letterIndex = String.fromCharCode(65 + (idx % 26));
                        return (
                            <div
                                key={`${item.routineId}-${idx}`}
                                style={{
                                    padding: '10px 12px',
                                    background: 'var(--surface-light)',
                                    border: '1px solid var(--glass-border)',
                                    borderRadius: '8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '10px'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                                    <div
                                        style={{
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '50%',
                                            background: 'rgba(14, 165, 233, 0.15)',
                                            border: '1px solid var(--primary-color)',
                                            color: 'var(--primary-color)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontWeight: 'bold',
                                            fontSize: '0.85rem',
                                            flexShrink: 0
                                        }}
                                    >
                                        {letterIndex}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {routine?.name || 'Scheda'}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            Posizione {idx + 1} di {cycleRoutines.length} • {routine?.exercises?.length || 0} esercizi
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-small"
                                        style={{ padding: '4px 8px', marginBottom: 0, fontSize: '0.85rem' }}
                                        onClick={() => onMove(idx, -1)}
                                        disabled={idx === 0}
                                        aria-label="Sposta su nella sequenza"
                                        title="Sposta su nella sequenza"
                                    >
                                        ▲
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-small"
                                        style={{ padding: '4px 8px', marginBottom: 0, fontSize: '0.85rem' }}
                                        onClick={() => onMove(idx, 1)}
                                        disabled={idx === cycleRoutines.length - 1}
                                        aria-label="Sposta giù nella sequenza"
                                        title="Sposta giù nella sequenza"
                                    >
                                        ▼
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-icon"
                                        style={{ color: 'var(--danger-color)', fontSize: '1rem', padding: '4px', marginLeft: '4px' }}
                                        onClick={() => onRemove(idx)}
                                        aria-label="Rimuovi scheda dalla sequenza"
                                        title="Rimuovi scheda dalla sequenza"
                                    >
                                        <Trash2 size={16} aria-hidden="true" />

                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
CycleRoutinesList.displayName = 'CycleRoutinesList';
