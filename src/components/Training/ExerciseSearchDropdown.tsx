import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { X, Plus, Search, Activity, Timer } from 'lucide-react';
import { ExerciseLibraryItem } from '../../types';
import { Logic, getDetailedMuscleCategory } from '../../lib/logic';

export interface ExerciseSearchDropdownProps {
    library: ExerciseLibraryItem[];
    onSelectExercise: (exId: string) => void;
    placeholder?: string;
    excludeIds?: string[];
    style?: React.CSSProperties;
    containerClassName?: string;
    autoFocus?: boolean;
}

export const ExerciseSearchDropdown: React.FC<ExerciseSearchDropdownProps> = ({
    library = [],
    onSelectExercise,
    placeholder = '🔍 Cerca esercizio da aggiungere...',
    excludeIds,
    style,
    containerClassName = '',
    autoFocus = false
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Compute search results
    const filteredExercises = useMemo(() => {
        let list = Array.isArray(library) ? library : [];
        if (excludeIds && excludeIds.length > 0) {
            const excludeSet = new Set(excludeIds);
            list = list.filter(item => item && !excludeSet.has(item.id));
        }
        if (typeof Logic.searchExerciseLibrary === 'function') {
            return Logic.searchExerciseLibrary(list, searchTerm);
        }
        return Logic.filterItems(list, searchTerm, ['name']) as ExerciseLibraryItem[];
    }, [library, excludeIds, searchTerm]);

    // Handle outside clicks/touches
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setHighlightedIndex(-1);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        document.addEventListener('touchstart', handleOutsideClick);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            document.removeEventListener('touchstart', handleOutsideClick);
        };
    }, []);

    // Ensure highlighted item stays visible during keyboard scrolling
    useEffect(() => {
        if (isOpen && highlightedIndex >= 0 && dropdownRef.current) {
            const items = dropdownRef.current.querySelectorAll('.exercise-dropdown-item');
            if (items[highlightedIndex] && typeof (items[highlightedIndex] as any).scrollIntoView === 'function') {
                (items[highlightedIndex] as HTMLElement).scrollIntoView({
                    block: 'nearest',
                    behavior: 'smooth'
                });
            }
        }
    }, [highlightedIndex, isOpen]);

    const handleSelect = useCallback((id: string) => {
        if (!id) return;
        onSelectExercise(id);
        setSearchTerm('');
        setIsOpen(false);
        setHighlightedIndex(-1);
    }, [onSelectExercise]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
                setIsOpen(true);
                return;
            }
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev < filteredExercises.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev > 0 ? prev - 1 : filteredExercises.length - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex >= 0 && highlightedIndex < filteredExercises.length) {
                handleSelect(filteredExercises[highlightedIndex].id);
            } else if (filteredExercises.length === 1) {
                handleSelect(filteredExercises[0].id);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setIsOpen(false);
            setHighlightedIndex(-1);
            inputRef.current?.blur();
        }
    };

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        setSearchTerm('');
        setHighlightedIndex(-1);
        inputRef.current?.focus();
    };

    const renderBadges = (ex: ExerciseLibraryItem) => {
        const primaryMuscleId = ex.muscles && ex.muscles.length > 0 ? ex.muscles[0] : null;
        const muscleCategory = primaryMuscleId ? getDetailedMuscleCategory(primaryMuscleId).label : null;

        return (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '3px' }}>
                {muscleCategory && (
                    <span 
                        style={{ 
                            fontSize: '0.75rem', 
                            padding: '2px 6px', 
                            borderRadius: '4px', 
                            background: 'rgba(0, 229, 255, 0.15)', 
                            color: 'var(--primary-color)',
                            fontWeight: 500
                        }}
                    >
                        {muscleCategory}
                    </span>
                )}
                {ex.trackingType === 'cardio' && (
                    <span 
                        style={{ 
                            fontSize: '0.75rem', 
                            padding: '2px 6px', 
                            borderRadius: '4px', 
                            background: 'rgba(46, 204, 113, 0.15)', 
                            color: 'var(--success-color, #2ecc71)',
                            fontWeight: 500
                        }}
                    >
                        <Activity size={12} aria-hidden="true" style={{ marginRight: '2px', display: 'inline-block', verticalAlign: 'middle' }} /> Cardio
                    </span>
                )}
                {ex.trackingType === 'time' && (
                    <span 
                        style={{ 
                            fontSize: '0.75rem', 
                            padding: '2px 6px', 
                            borderRadius: '4px', 
                            background: 'rgba(255, 183, 3, 0.15)', 
                            color: 'var(--warning-color, #ffb703)',
                            fontWeight: 500
                        }}
                    >
                        <Timer size={12} aria-hidden="true" style={{ marginRight: '2px', display: 'inline-block', verticalAlign: 'middle' }} /> Tempo
                    </span>
                )}
            </div>
        );
    };

    return (
        <div 
            ref={containerRef}
            className={`exercise-search-container ${containerClassName}`}
            style={{ position: 'relative', width: '100%', ...style }}
        >
            <div style={{ position: 'relative', width: '100%' }}>
                <input
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-autocomplete="list"
                    aria-controls="exercise-dropdown-list"
                    value={searchTerm}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    onChange={e => {
                        setSearchTerm(e.target.value);
                        if (!isOpen) setIsOpen(true);
                        setHighlightedIndex(-1);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onClick={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    style={{
                        width: '100%',
                        padding: '10px 38px 10px 14px',
                        fontSize: '16px',
                        borderRadius: '8px',
                        background: 'var(--surface-color, #0d0d0d)',
                        color: 'var(--text-main, #f0f0f0)',
                        border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.1))',
                        boxSizing: 'border-box'
                    }}
                />

                {searchTerm ? (
                    <button
                        type="button"
                        aria-label="Cancella ricerca"
                        onClick={handleClear}
                        style={{
                            position: 'absolute',
                            right: '10px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted, #9ba3af)',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '50%'
                        }}
                    >
                        <X size={16} />
                    </button>
                ) : (
                    <div
                        style={{
                            position: 'absolute',
                            right: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            pointerEvents: 'none',
                            color: 'var(--text-muted, #9ba3af)',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <Search size={16} />
                    </div>
                )}
            </div>

            {isOpen && (
                <div
                    ref={dropdownRef}
                    id="exercise-dropdown-list"
                    role="listbox"
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        right: 0,
                        width: '100%',
                        maxHeight: '260px',
                        overflowY: 'auto',
                        background: 'var(--surface-color, #0d0d0d)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.15))',
                        borderRadius: '12px',
                        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
                        zIndex: 100,
                        boxSizing: 'border-box',
                        touchAction: 'manipulation'
                    }}
                >
                    {filteredExercises.length === 0 ? (
                        <div 
                            style={{ 
                                padding: '16px', 
                                textAlign: 'center', 
                                color: 'var(--text-muted, #9ba3af)', 
                                fontSize: '0.85rem' 
                            }}
                        >
                            Nessun esercizio trovato
                        </div>
                    ) : (
                        filteredExercises.map((ex, idx) => {
                            const isHighlighted = highlightedIndex === idx;
                            return (
                                <div
                                    key={ex.id || idx}
                                    role="option"
                                    aria-selected={isHighlighted}
                                    className="exercise-dropdown-item"
                                    onClick={() => handleSelect(ex.id)}
                                    onMouseEnter={() => setHighlightedIndex(idx)}
                                    style={{
                                        padding: '10px 14px',
                                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        background: isHighlighted ? 'rgba(0, 229, 255, 0.12)' : 'transparent',
                                        borderLeft: isHighlighted ? '3px solid var(--primary-color)' : '3px solid transparent',
                                        transition: 'background 0.15s ease, border-left 0.15s ease'
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0, paddingRight: '10px' }}>
                                        <div 
                                            style={{ 
                                                fontWeight: 600, 
                                                color: 'var(--text-main, #f0f0f0)', 
                                                fontSize: '0.95rem',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {ex.name}
                                        </div>
                                        {renderBadges(ex)}
                                    </div>
                                    <div 
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'center',
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '6px',
                                            background: isHighlighted ? 'var(--primary-color)' : 'rgba(255, 255, 255, 0.08)',
                                            color: isHighlighted ? '#000000' : 'var(--text-main, #f0f0f0)',
                                            flexShrink: 0
                                        }}
                                    >
                                        <Plus size={16} />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};

export default ExerciseSearchDropdown;
