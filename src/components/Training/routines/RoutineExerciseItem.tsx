import React from 'react';
import { ExerciseLibraryItem } from '../../../types';

interface RoutineExerciseItemProps {
    exercise: any;
    index: number;
    totalExercises: number;
    libDef?: ExerciseLibraryItem;
    onMove: (index: number, direction: number) => void;
    onRemove: (index: number) => void;
    onUpdateSetsCount: (index: number, value: string) => void;
    onUpdateReps: (index: number, field: 'minReps' | 'maxReps', value: string) => void;
    onUpdateTechnique: (index: number, tech: 'dropset' | 'isometrics') => void;
}

export const RoutineExerciseItem: React.FC<RoutineExerciseItemProps> = ({
    exercise,
    index,
    totalExercises,
    libDef,
    onMove,
    onRemove,
    onUpdateSetsCount,
    onUpdateReps,
    onUpdateTechnique
}) => {
    return (
        <div className="flex-col bg-card-inner p-12 rounded-8 gap-10" style={{ border: '1px solid var(--glass-border)' }}>
            <div className="flex-between gap-10 items-center">
                <div className="text-md font-semibold flex-1">
                    {index + 1}. {libDef ? libDef.name : 'Esercizio rimosso'}
                </div>
                <div className="flex gap-4">
                    <button 
                        type="button"
                        className="btn-icon" 
                        disabled={index === 0} 
                        style={{ opacity: index === 0 ? 0.3 : 1 }} 
                        onClick={() => onMove(index, -1)}
                        aria-label="Sposta in alto"
                    >
                        ⬆️
                    </button>
                    <button 
                        type="button"
                        className="btn-icon" 
                        disabled={index === totalExercises - 1} 
                        style={{ opacity: index === totalExercises - 1 ? 0.3 : 1 }} 
                        onClick={() => onMove(index, 1)}
                        aria-label="Sposta in basso"
                    >
                        ⬇️
                    </button>
                    <button 
                        type="button"
                        className="btn-icon text-danger" 
                        onClick={() => onRemove(index)}
                        aria-label="Rimuovi esercizio"
                    >
                        ❌
                    </button>
                </div>
            </div>

            {/* Riga 1: Serie */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                    Serie:
                </label>
                <input 
                    type="number" min="1" max="20"
                    placeholder="3"
                    value={exercise.setsCount !== undefined && exercise.setsCount !== null ? exercise.setsCount : ''}
                    onChange={e => onUpdateSetsCount(index, e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ 
                        width: '90px', 
                        height: '42px', 
                        minHeight: '42px', 
                        margin: 0, 
                        padding: '8px 12px',
                        fontSize: '16px',
                        textAlign: 'center',
                        borderRadius: '8px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--text-main)',
                        boxSizing: 'border-box'
                    }}
                    onClick={e => e.stopPropagation()}
                />
            </div>

            {/* Riga 2: Rep min e Rep max */}
            {libDef?.trackingType !== 'time' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                        Ripetizioni:
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                        <input 
                            type="number" 
                            placeholder="Min (es. 8)" 
                            value={exercise.minReps || ''} 
                            onChange={e => onUpdateReps(index, 'minReps', e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ 
                                flex: 1, 
                                minWidth: 0, 
                                height: '42px', 
                                minHeight: '42px', 
                                margin: 0, 
                                padding: '8px 8px',
                                fontSize: '16px',
                                textAlign: 'center',
                                borderRadius: '8px',
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid var(--glass-border)',
                                color: 'var(--text-main)',
                                boxSizing: 'border-box'
                            }}
                        />
                        <span style={{ color: 'var(--text-muted)', fontWeight: 'bold', fontSize: '1rem' }}>-</span>
                        <input 
                            type="number" 
                            placeholder="Max (es. 12)" 
                            value={exercise.maxReps || ''} 
                            onChange={e => onUpdateReps(index, 'maxReps', e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ 
                                flex: 1, 
                                minWidth: 0, 
                                height: '42px', 
                                minHeight: '42px', 
                                margin: 0, 
                                padding: '8px 8px',
                                fontSize: '16px',
                                textAlign: 'center',
                                borderRadius: '8px',
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid var(--glass-border)',
                                color: 'var(--text-main)',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                        Tipo:
                    </label>
                    <span className="text-muted text-xs italic">Tracciamento a tempo</span>
                </div>
            )}

            {/* Riga 3: Tecniche speciali pre-attivate */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                    Tecnica:
                </span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
                    <button
                        type="button"
                        className={`btn btn-small ${exercise.defaultTechnique === 'dropset' ? 'btn-primary' : ''}`}
                        style={{ 
                            margin: 0, 
                            padding: '6px 12px', 
                            fontSize: '0.8rem',
                            background: exercise.defaultTechnique === 'dropset' ? 'var(--warning-color)' : 'rgba(255,255,255,0.08)',
                            color: exercise.defaultTechnique === 'dropset' ? '#000' : 'var(--text-main)',
                            fontWeight: exercise.defaultTechnique === 'dropset' ? 700 : 500,
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px'
                        }}
                        onClick={() => onUpdateTechnique(index, 'dropset')}
                    >
                        🔻 Dropset {exercise.defaultTechnique === 'dropset' ? '✓' : ''}
                    </button>
                    <button
                        type="button"
                        className={`btn btn-small ${exercise.defaultTechnique === 'isometrics' ? 'btn-primary' : ''}`}
                        style={{ 
                            margin: 0, 
                            padding: '6px 12px', 
                            fontSize: '0.8rem',
                            background: exercise.defaultTechnique === 'isometrics' ? 'var(--accent-color)' : 'rgba(255,255,255,0.08)',
                            color: exercise.defaultTechnique === 'isometrics' ? '#fff' : 'var(--text-main)',
                            fontWeight: exercise.defaultTechnique === 'isometrics' ? 700 : 500,
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px'
                        }}
                        onClick={() => onUpdateTechnique(index, 'isometrics')}
                    >
                        ⏱️ Isometria {exercise.defaultTechnique === 'isometrics' ? '✓' : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};
