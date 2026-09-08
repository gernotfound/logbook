import React, { useState, useMemo, useEffect } from 'react';
import MuscleModel from '../../Training/MuscleModel';
import { Activity, ChevronDown } from 'lucide-react';
import { Logic } from '../../../lib/logic';

interface RecoveryBentoCardProps {
    activePains: string[];
    painColors: Record<string, string>;
    muscleColors?: Record<string, string>;
    onTogglePain: (muscleId: string) => void;
}

const RecoveryBentoCard: React.FC<RecoveryBentoCardProps> = ({ activePains = [], painColors, muscleColors = {}, onTogglePain }) => {
    const combinedColors = { ...muscleColors, ...painColors };
    const [searchQuery, setSearchQuery] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        if (activePains.length === 0) setIsExpanded(false);
    }, [activePains.length]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        return Logic.searchMuscles(searchQuery, 8);
    }, [searchQuery]);

    const activePainsSet = useMemo(() => new Set(activePains), [activePains]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{margin: 0, display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Activity size={18} color="#ff4d6d" />
                    Recupero e Dolori
                </h2>
                <button
                    type="button"
                    onClick={() => activePains.length > 0 && setIsExpanded(v => !v)}
                    disabled={activePains.length === 0}
                    aria-expanded={isExpanded}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: activePains.length > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                        color: activePains.length > 0 ? '#ff4d6d' : 'var(--text-muted)',
                        border: activePains.length > 0 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                        cursor: activePains.length > 0 ? 'pointer' : 'default',
                        transition: 'all 0.2s ease'
                    }}
                >
                    {activePains.length > 0 ? `${activePains.length} dolori attivi` : '0 dolori attivi'}
                    {activePains.length > 0 && (
                        <ChevronDown 
                            size={14} 
                            style={{ 
                                transition: 'transform 0.25s ease',
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                            }} 
                        />
                    )}
                </button>
            </div>

            {/* Muscle Search Input */}
            <div style={{ position: 'relative' }}>
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

            {/* Search Results Dropdown */}
            {searchQuery.trim() && (
                <div 
                    style={{ 
                        background: 'rgba(0, 0, 0, 0.45)', 
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        padding: '6px',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                    }}
                >
                    {searchResults.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '10px', textAlign: 'center' }}>
                            Nessun muscolo trovato
                        </div>
                    ) : (
                        searchResults.map(m => {
                            const isPain = activePainsSet.has(m.id);
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => onTogglePain(m.id)}
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

            {/* Active Pain Badges */}
            <div 
                style={{
                    overflow: 'hidden',
                    transition: 'max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease',
                    maxHeight: isExpanded && activePains.length > 0 ? '500px' : '0',
                    opacity: isExpanded && activePains.length > 0 ? 1 : 0,
                    visibility: isExpanded && activePains.length > 0 ? 'visible' : 'hidden',
                    marginTop: isExpanded && activePains.length > 0 ? '5px' : '0',
                    marginBottom: isExpanded && activePains.length > 0 ? '5px' : '0'
                }}
                aria-hidden={!isExpanded}
            >
                {activePains.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {activePains.map(mId => (
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
                                    fontSize: '0.85rem',
                                    fontWeight: 600
                                }}
                            >
                                {Logic.getMuscleName(mId)}
                                <button
                                    type="button"
                                    onClick={() => onTogglePain(mId)}
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
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '12px' }}>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                    <MuscleModel 
                        muscleColors={combinedColors} 
                        interactive={false} 
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '12px', fontSize: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f97316' }}></div>
                        <span style={{ color: 'var(--text-muted)' }}>Affaticato</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }}></div>
                        <span style={{ color: 'var(--text-muted)' }}>Dolorante</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RecoveryBentoCard;
