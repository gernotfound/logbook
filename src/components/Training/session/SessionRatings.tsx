import React, { useState, useMemo, useCallback } from 'react';
import { Zap, X, Check, Plus, ChevronUp, ChevronDown, Droplets } from 'lucide-react';
import MuscleModel from '../MuscleModel';
import { Logic } from '../../../lib/logic';
import { BufferedInput } from '../../UI/BufferedInput';

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
        const DANGER_COLOR = 'var(--danger-color)';
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
            <div style={{ margin: '20px 0', padding: '15px', background: 'var(--primary-soft)', borderRadius: '12px', border: '1px solid var(--primary-color)' }}>
                <label htmlFor="water-intake" style={{  color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }} className="text-sm">
                    <Droplets size={16} aria-hidden="true" /> Acqua bevuta (litri)
                </label>
                <BufferedInput
                    id="water-intake"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    placeholder="es. 1.5"
                    value={water}
                    onChange={setWater}
                    onFocus={e => e.target.select()}
                    style={{ margin: 0, width: '100%', borderColor: 'var(--primary-color)' }}
                 className="text-base"/>
            </div>

            <div style={{ margin: '20px 0', padding: '15px', background: 'var(--surface-light)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <h3 style={{marginTop: 0, marginBottom: '12px'}}>Valuta sessione (1-10)</h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label htmlFor="mood-rating" style={{  color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }} className="text-sm">
                            Umore
                        </label>
                        <BufferedInput
                            id="mood-rating"
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="1"
                            max="10"
                            value={mood}
                            onChange={setMood}
                            onFocus={e => e.target.select()}
                            style={{ margin: 0, textAlign: 'center' }}
                         className="text-base"/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label htmlFor="pump-rating" style={{  color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }} className="text-sm">
                            Pump
                        </label>
                        <BufferedInput
                            id="pump-rating"
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="1"
                            max="10"
                            value={pump}
                            onChange={setPump}
                            onFocus={e => e.target.select()}
                            style={{ margin: 0, textAlign: 'center' }}
                         className="text-base"/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label htmlFor="fatigue-rating" style={{  color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }} className="text-sm">
                            Stanchezza
                        </label>
                        <BufferedInput
                            id="fatigue-rating"
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="1"
                            max="10"
                            value={fatigue}
                            onChange={setFatigue}
                            onFocus={e => e.target.select()}
                            style={{ margin: 0, textAlign: 'center' }}
                         className="text-base"/>
                    </div>
                </div>
            </div>

            {/* DOMS Muscle Pain Tracking Accordion */}
            <div style={{ margin: '20px 0', background: 'var(--surface-light)', borderRadius: '12px', border: '1px solid var(--glass-border)', overflow: 'hidden' }}>
                <button
                    type="button"
                    onClick={() => setIsDomsOpen(prev => !prev)}
                    className={`accordion-btn ${isDomsOpen ? 'expanded' : ''}`}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Zap size={18} aria-hidden="true" style={{ color: 'var(--warning-color)' }} />
                        <span>Dolori muscolari</span>
                        <span
                            style={{

                                padding: '2px 8px',
                                borderRadius: '6px',
                                background: pains.length > 0 ? 'var(--danger-soft)' : 'var(--surface-light)',
                                color: pains.length > 0 ? 'var(--danger-color)' : 'var(--text-muted)',
                                border: pains.length > 0 ? '1px solid var(--danger-color)' : 'none'
                            }}
                         className="text-sm">
                            {pains.length > 0 ? `${pains.length} selezionati` : 'Opzionale'}
                        </span>
                    </div>
                    <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                        {isDomsOpen ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                    </span>
                </button>

                {isDomsOpen && (
                    <div style={{ padding: '16px', borderTop: '1px solid var(--glass-border)' }}>
                        <p style={{ margin: '0 0 12px 0',  color: 'var(--text-muted)' }} className="text-sm">
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

                                    boxSizing: 'border-box'
                                }}
                             className="text-base"/>
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="btn-link"
                                    style={{
                                        position: 'absolute',
                                        right: '8px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--text-muted)',
                                        padding: '4px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    aria-label="Cancella ricerca"
                                >
                                    <X size={16} aria-hidden="true" />
                                </button>
                            )}
                        </div>

                        {/* Search Suggestions */}
                        {searchQuery.trim() && (
                            <div
                                style={{
                                    background: 'var(--surface-light)',
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
                                    <div style={{ color: 'var(--text-muted)',  padding: '10px', textAlign: 'center' }} className="text-sm">
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

                                                    cursor: 'pointer',
                                                    textAlign: 'left',
                                                    background: isPain ? 'var(--danger-soft)' : 'var(--surface-light, #1a1a1a)',
                                                    color: isPain ? 'var(--danger-color)' : 'var(--text-main)',
                                                    border: isPain ? '1px solid var(--danger-color)' : '1px solid var(--glass-border)',
                                                    transition: 'all 0.2s ease'
                                                }}
                                             className="text-sm">
                                                <span style={{ fontWeight: 600 }}>{m.name}</span>
                                                <span style={{  fontWeight: 600, color: isPain ? 'var(--danger-color)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }} className="text-sm">
                                                    {isPain ? <><Check size={14} aria-hidden="true" /> Dolorante</> : <><Plus size={14} aria-hidden="true" /> Aggiungi</>}
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
                                            background: 'var(--danger-soft)',
                                            border: '1px solid var(--danger-color)',
                                            color: 'var(--danger-color)',
                                            padding: '4px 10px',
                                            borderRadius: '8px',

                                            fontWeight: 600
                                        }}
                                     className="text-sm">
                                        {Logic.getMuscleName(mId)}
                                        <button
                                            type="button"
                                            onClick={() => handleToggleMuscle(mId)}
                                            className="btn-link"
                                            style={{
                                                color: 'var(--danger-color)',
                                                padding: '0 2px',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                lineHeight: 1
                                            }}
                                            aria-label={`Rimuovi dolore ${Logic.getMuscleName(mId)}`}
                                        >
                                            <X size={14} aria-hidden="true" />
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

