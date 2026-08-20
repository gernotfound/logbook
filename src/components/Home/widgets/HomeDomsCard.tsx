import React, { useState, useMemo } from 'react';
import MuscleModel from '../../Training/MuscleModel';
import { Logic } from '../../../lib/logic';

interface HomeDomsCardProps {
    activePains: string[];
    painColors: Record<string, string>;
    onTogglePain: (muscleId: string) => void;
}

export const HomeDomsCard: React.FC<HomeDomsCardProps> = ({
    activePains = [],
    painColors,
    onTogglePain
}) => {
    const [searchQuery, setSearchQuery] = useState('');

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        return Logic.searchMuscles(searchQuery, 8);
    }, [searchQuery]);

    const activePainsSet = useMemo(() => new Set(activePains), [activePains]);

    return (
        <div className="card" id="home-doms-widget" style={{ marginBottom: '20px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>⚡</span>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Dolori muscolari (DOMS)</h2>
                </div>
                <span 
                    style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: activePains.length > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                        color: activePains.length > 0 ? '#ff4d6d' : 'var(--text-muted)',
                        border: activePains.length > 0 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)'
                    }}
                >
                    {activePains.length > 0 ? `${activePains.length} ${activePains.length === 1 ? 'attivo' : 'attivi'}` : '0 attivi'}
                </span>
            </div>

            {/* Muscle Search Input */}
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

            {/* Search Results Dropdown */}
            {searchQuery.trim() && (
                <div 
                    style={{ 
                        background: 'rgba(0, 0, 0, 0.45)', 
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        padding: '6px',
                        marginBottom: '14px',
                        maxHeight: '200px',
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
            {activePains.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
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
                                fontSize: '0.8rem',
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
            ) : (
                <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Nessun dolore muscolare registrato. Clicca sul manichino o cerca un muscolo per aggiungerlo.
                </p>
            )}

            {/* Interactive SVG Mannequin */}
            <div style={{ maxWidth: '280px', margin: '0 auto' }}>
                <MuscleModel 
                    muscleColors={painColors} 
                    interactive={true} 
                    onToggleMuscle={onTogglePain} 
                />
            </div>
        </div>
    );
};

export default HomeDomsCard;
