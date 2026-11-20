import { useMemo, useState } from 'react';
import { Logic } from '../../../lib/logic';

interface RecoveryPainSearchProps {
    activePains: string[];
    onTogglePain: (muscleId: string) => void;
}

export function RecoveryPainSearch({ activePains, onTogglePain }: RecoveryPainSearchProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        return Logic.searchMuscles(searchQuery, 8);
    }, [searchQuery]);
    const activePainsSet = useMemo(() => new Set(activePains), [activePains]);

    return (
        <>
        {/* Muscle Search Input */}
        <div style={{ position: 'relative' }}>
            <input
                type="text"
                placeholder="🔍 Cerca muscolo dolorante..."
                aria-label="Cerca muscolo dolorante"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                    width: '100%',
                    margin: 0,
                    paddingRight: searchQuery ? '52px' : '14px',
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
                        fontSize: 'var(--font-size-control)',
                        cursor: 'pointer',
                        padding: '6px',
                        minWidth: '44px',
                        minHeight: '44px',
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
                    background: 'var(--surface-light)',
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
                    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-meta)', padding: '10px', textAlign: 'center' }}>
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
                                aria-pressed={isPain}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    width: '100%',
                                    padding: '8px 12px',
                                    minHeight: '44px',
                                    borderRadius: '6px',
                                    fontSize: 'var(--font-size-meta)',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    background: isPain ? 'var(--danger-soft)' : 'var(--surface-light)',
                                    color: isPain ? 'var(--danger-color)' : 'var(--text-main)',
                                    border: isPain ? '1px solid var(--danger-color)' : '1px solid var(--border-color)',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                <span style={{ fontWeight: 600 }}>{m.name}</span>
                                <span style={{ fontSize: 'var(--font-size-micro)', fontWeight: 600, color: isPain ? 'var(--danger-color)' : 'var(--text-muted)' }}>
                                    {isPain ? '✓ Dolorante' : '+ Aggiungi'}
                                </span>
                            </button>
                        );
                    })
                )}
            </div>
        )}
        </>
    );
}
