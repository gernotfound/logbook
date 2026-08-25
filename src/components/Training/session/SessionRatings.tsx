import React, { useState, useMemo, useCallback } from 'react';
import MuscleModel from '../MuscleModel';
import { Logic } from '../../../lib/logic';

interface SessionRatingsProps {
    water: string | number;
    setWater: (val: string) => void;
    mood: string | number;
    setMood: (val: string) => void;
    pump: string | number;
    setPump: (val: string) => void;
    fatigue: string | number;
    setFatigue: (val: string) => void;
    pains?: string[];
    onTogglePain?: (muscleId: string) => void;
    onSetPains?: (pains: string[]) => void;
}

export const SessionRatings: React.FC<SessionRatingsProps> = ({
    water,
    setWater,
    mood,
    setMood,
    pump,
    setPump,
    fatigue,
    setFatigue,
    pains = [],
    onTogglePain,
    onSetPains
}) => {
    const [isDomsOpen, setIsDomsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        return Logic.searchMuscles(searchQuery, 8);
    }, [searchQuery]);

    const activePainsSet = useMemo(() => new Set(pains), [pains]);

    const painColors = useMemo(() => {
        const colors: Record<string, string> = {};
        const DANGER_COLOR = '#ef4444';
        (pains || []).forEach(mId => {
            if (!mId || typeof mId !== 'string') return;
            colors[mId] = DANGER_COLOR;
            const atomicPaths = (Logic.GROUP_MAP as any)[mId];
            if (Array.isArray(atomicPaths)) {
                atomicPaths.forEach((path: string) => {
                    colors[path] = DANGER_COLOR;
                });
            }
        });
        return colors;
    }, [pains]);

    const handleToggleMuscle = useCallback((muscleId: string) => {
        if (!muscleId || typeof muscleId !== 'string') return;
        if (onTogglePain) {
            onTogglePain(muscleId);
        } else if (onSetPains) {
            const nextPains = activePainsSet.has(muscleId)
                ? pains.filter(p => p !== muscleId)
                : [...pains, muscleId];
            onSetPains(nextPains);
        }
    }, [onTogglePain, onSetPains, activePainsSet, pains]);

    return (
        <>
            <div style={{ margin: '20px 0', padding: '15px', background: 'rgba(14, 165, 233, 0.1)', borderRadius: '12px', border: '1px solid var(--primary-color)' }}>
                <label htmlFor="water-intake" style={{ fontSize: '0.85rem', color: 'var(--primary-color)', display: 'block', marginBottom: '8px' }}>
                    💧 Acqua bevuta (litri)
                </label>
                <input 
                    id="water-intake" 
                    type="number" 
                    inputMode="decimal"
                    step="0.1" 
                    placeholder="es. 1.5" 
                    value={water} 
                    onChange={e => setWater(e.target.value)} 
                    onFocus={e => e.target.select()}
                    style={{ margin: 0, width: '100%', borderColor: 'var(--primary-color)', fontSize: '16px' }} 
                />
            </div>

            <div style={{ margin: '20px 0', padding: '15px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '0.95rem' }}>Valuta sessione (1-10) — opzionale</h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label htmlFor="mood-rating" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                            Umore
                        </label>
                        <input 
                            id="mood-rating" 
                            type="number" 
                            inputMode="decimal"
                            step="0.1"
                            min="1" 
                            max="10" 
                            value={mood} 
                            onChange={e => setMood(e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ margin: 0, textAlign: 'center', fontSize: '16px' }} 
                        />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label htmlFor="pump-rating" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                            Pump
                        </label>
                        <input 
                            id="pump-rating" 
                            type="number" 
                            inputMode="decimal"
                            step="0.1"
                            min="1" 
                            max="10" 
                            value={pump} 
                            onChange={e => setPump(e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ margin: 0, textAlign: 'center', fontSize: '16px' }} 
                        />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label htmlFor="fatigue-rating" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                            Stanchezza
                        </label>
                        <input 
                            id="fatigue-rating" 
                            type="number" 
                            inputMode="decimal"
                            step="0.1"
                            min="1" 
                            max="10" 
                            value={fatigue} 
                            onChange={e => setFatigue(e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ margin: 0, textAlign: 'center', fontSize: '16px' }} 
                        />
                    </div>
                </div>
            </div>

            {/* DOMS Muscle Pain Tracking Accordion */}
            <div style={{ margin: '20px 0', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', border: '1px solid var(--glass-border)', overflow: 'hidden' }}>
                <button
                    type="button"
                    onClick={() => setIsDomsOpen(prev => !prev)}
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        width: '100%',
                        padding: '14px 16px',
                        background: isDomsOpen ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                        border: 'none',
                        color: 'var(--text-main)',
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>⚡</span>
                        <span>Dolori muscolari</span>
                        <span 
                            style={{
                                fontSize: '0.75rem',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                background: pains.length > 0 ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                                color: pains.length > 0 ? '#ff4d6d' : 'var(--text-muted)',
                                border: pains.length > 0 ? '1px solid rgba(239, 68, 68, 0.4)' : 'none'
                            }}
                        >
                            {pains.length > 0 ? `${pains.length} selezionati` : 'Opzionale'}
                        </span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {isDomsOpen ? '▲' : '▼'}
                    </span>
                </button>

                {isDomsOpen && (
                    <div style={{ padding: '16px', borderTop: '1px solid var(--glass-border)' }}>
                        <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            Seleziona i muscoli doloranti dopo l&apos;allenamento. I muscoli primari allenati non selezionati guariranno automaticamente.
                        </p>

                        {/* Search Input */}
                        <div style={{ position: 'relative', marginBottom: '12px' }}>
                            <input
                                type="text"
                                placeholder="🔍 Cerca muscolo dolorante..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                style={{
                                    width: '100%',
                                    margin: 0,
                                    paddingRight: searchQuery ? '36px' : '14px',
                                    fontSize: '16px',
                                    boxSizing: 'border-box'
                                }}
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    style={{
                                        position: 'absolute',
                                        right: '8px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--text-muted)',
                                        fontSize: '1rem',
                                        cursor: 'pointer',
                                        padding: '6px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    aria-label="Cancella ricerca"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {/* Search Suggestions */}
                        {searchQuery.trim() && (
                            <div 
                                style={{ 
                                    background: 'rgba(0, 0, 0, 0.45)', 
                                    border: '1px solid var(--glass-border)',
                                    borderRadius: '8px',
                                    padding: '6px',
                                    marginBottom: '14px',
                                    maxHeight: '180px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '6px'
                                }}
                            >
                                {searchResults.length === 0 ? (
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '10px', textAlign: 'center' }}>
                                        Nessun muscolo trovato
                                    </div>
                                ) : (
                                    searchResults.map(m => {
                                        const isPain = activePainsSet.has(m.id);
                                        return (
                                            <button
                                                key={m.id}
                                                type="button"
                                                onClick={() => handleToggleMuscle(m.id)}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    width: '100%',
                                                    padding: '8px 12px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.85rem',
                                                    cursor: 'pointer',
                                                    textAlign: 'left',
                                                    background: isPain ? 'rgba(239, 68, 68, 0.25)' : 'var(--surface-light, #1a1a1a)',
                                                    color: isPain ? '#ff6b81' : '#ffffff',
                                                    border: isPain ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.08)',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                <span style={{ fontWeight: 600 }}>{m.name}</span>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isPain ? '#ff4d6d' : 'var(--text-muted)' }}>
                                                    {isPain ? '✓ Dolorante' : '+ Aggiungi'}
                                                </span>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        )}

                        {/* Selected Pain Badges */}
                        {pains.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                                {pains.map(mId => (
                                    <span 
                                        key={mId} 
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            background: 'rgba(239, 68, 68, 0.15)',
                                            border: '1px solid rgba(239, 68, 68, 0.5)',
                                            color: '#ff6b81',
                                            padding: '4px 10px',
                                            borderRadius: '8px',
                                            fontSize: '0.8rem',
                                            fontWeight: 600
                                        }}
                                    >
                                        {Logic.getMuscleName(mId)}
                                        <button
                                            type="button"
                                            onClick={() => handleToggleMuscle(mId)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: '#ff4d6d',
                                                fontWeight: 'bold',
                                                fontSize: '0.85rem',
                                                cursor: 'pointer',
                                                padding: '0 2px',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                lineHeight: 1
                                            }}
                                            aria-label={`Rimuovi dolore ${Logic.getMuscleName(mId)}`}
                                        >
                                            ✕
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Interactive SVG Mannequin */}
                        <div style={{ maxWidth: '280px', margin: '0 auto' }}>
                            <MuscleModel 
                                muscleColors={painColors} 
                                interactive={true} 
                                onToggleMuscle={handleToggleMuscle} 
                            />
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default SessionRatings;

