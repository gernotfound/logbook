import React, { useState, useRef, useEffect, useMemo, useCallback, useId } from 'react';
import { X, Search } from 'lucide-react';
import type { ExerciseLibraryItem } from '../../types';
import { ExerciseSearchOption } from './ExerciseSearchOption';
import { createExerciseLibrarySearcher } from '../../lib/calc/workout';

export interface ExerciseSearchDropdownProps {
    library: ExerciseLibraryItem[];
    onSelectExercise: (exId: string) => void;
    inputId?: string;
    placeholder?: string;
    excludeIds?: string[];
    style?: React.CSSProperties;
    containerClassName?: string;
    autoFocus?: boolean;
}

const EXERCISE_PAGE_SIZE = 40;

export const ExerciseSearchDropdown: React.FC<ExerciseSearchDropdownProps> = ({
    library = [],
    onSelectExercise,
    inputId,
    placeholder = '🔍 Cerca esercizio da aggiungere...',
    excludeIds,
    style,
    containerClassName = '',
    autoFocus = false
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [visibleCount, setVisibleCount] = useState(EXERCISE_PAGE_SIZE);
    const listboxId = useId();

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const exclusionKey = excludeIds?.join('\u0000') ?? '';
    const searcher = useMemo(() => {
        let list = Array.isArray(library) ? library : [];
        if (exclusionKey) {
            const excludeSet = new Set(exclusionKey.split('\u0000'));
            list = list.filter(item => item && !excludeSet.has(item.id));
        }
        return createExerciseLibrarySearcher(list);
    }, [library, exclusionKey]);
    const filteredExercises = useMemo(() => isOpen ? searcher(searchTerm) : [], [isOpen, searcher, searchTerm]);
    const visibleExercises = filteredExercises.slice(0, visibleCount);

    // Handle outside clicks/touches
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setHighlightedIndex(-1);
                setVisibleCount(EXERCISE_PAGE_SIZE);
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
        setVisibleCount(EXERCISE_PAGE_SIZE);
    }, [onSelectExercise]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
                setIsOpen(true);
                return;
            }
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!filteredExercises.length) return;
            const next = e.key === 'ArrowDown'
                ? (highlightedIndex < filteredExercises.length - 1 ? highlightedIndex + 1 : 0)
                : (highlightedIndex > 0 ? highlightedIndex - 1 : filteredExercises.length - 1);
            setVisibleCount(count => Math.max(count, Math.ceil((next + 1) / EXERCISE_PAGE_SIZE) * EXERCISE_PAGE_SIZE));
            setHighlightedIndex(next);
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
            setVisibleCount(EXERCISE_PAGE_SIZE);
            inputRef.current?.blur();
        }
    };

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        setSearchTerm('');
        setHighlightedIndex(-1);
        setVisibleCount(EXERCISE_PAGE_SIZE);
        inputRef.current?.focus();
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
                    id={inputId}
                    type="text"
                    role="combobox"
                    aria-label={inputId ? undefined : 'Cerca esercizio'}
                    aria-expanded={isOpen}
                    aria-autocomplete="list"
                    aria-controls={isOpen ? listboxId : undefined}
                    aria-activedescendant={isOpen && highlightedIndex >= 0 && highlightedIndex < filteredExercises.length ? `${listboxId}-option-${highlightedIndex}` : undefined}
                    value={searchTerm}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    onChange={e => {
                        setSearchTerm(e.target.value);
                        if (!isOpen) setIsOpen(true);
                        setHighlightedIndex(-1);
                        setVisibleCount(EXERCISE_PAGE_SIZE);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onClick={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    style={{
                        width: '100%',
                        padding: '10px 38px 10px 14px',
                        fontSize: '16px',
                        borderRadius: '8px',
                        background: 'var(--surface-color)',
                        color: 'var(--text-main)',
                        border: '1px solid var(--glass-border)',
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
                            color: 'var(--text-muted)',
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
                            color: 'var(--text-muted)',
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
                    id={listboxId}
                    role="listbox"
                    onScroll={event => {
                        const list = event.currentTarget;
                        if (filteredExercises.length > visibleCount
                            && list.scrollTop + list.clientHeight >= list.scrollHeight - 40) {
                            setVisibleCount(count => Math.min(filteredExercises.length, count + EXERCISE_PAGE_SIZE));
                        }
                    }}
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        right: 0,
                        width: '100%',
                        maxHeight: '260px',
                        overflowY: 'auto',
                        background: 'var(--surface-color)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        border: '1px solid var(--glass-border)',
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
                                color: 'var(--text-muted)', 
                                fontSize: 'var(--font-size-meta)' 
                            }}
                        >
                            Nessun esercizio trovato
                        </div>
                    ) : (
                        visibleExercises.map((ex, idx) => (
                            <ExerciseSearchOption
                                key={ex.id || idx}
                                exercise={ex}
                                index={idx}
                                listboxId={listboxId}
                                resultCount={filteredExercises.length}
                                highlighted={highlightedIndex === idx}
                                onSelect={() => handleSelect(ex.id)}
                                onHover={() => setHighlightedIndex(idx)}
                            />
                        })
                    )}
                </div>
            )}
        </div>
    );
};

export default ExerciseSearchDropdown;
