import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, X } from 'lucide-react';
import MuscleModel from '../../Training/MuscleModel';
import { Logic } from '../../../lib/logic';

interface RecoveryBentoCardProps {
    activePains: string[];
    painColors: Record<string, string>;
    muscleColors?: Record<string, string>;
    onTogglePain: (muscleId: string) => void;
}

const RecoveryBentoCard: React.FC<RecoveryBentoCardProps> = ({
    activePains = [],
    painColors,
    muscleColors = {},
    onTogglePain
}) => {
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
    const hasPains = activePains.length > 0;

    return (
        <div className="home-compact-widget home-recovery">
            <div className="home-recovery__heading">
                <h2 className="home-compact-heading">
                    <Activity size={18} aria-hidden="true" />
                    Recupero e dolori
                </h2>
                <button
                    type="button"
                    className={`pain-status ${hasPains ? 'is-active' : ''}`}
                    onClick={() => hasPains && setIsExpanded(value => !value)}
                    disabled={!hasPains}
                    aria-expanded={isExpanded}
                >
                    <span>{activePains.length} {activePains.length === 1 ? 'dolore' : 'dolori'}</span>
                    {hasPains && <ChevronDown size={15} aria-hidden="true" className={isExpanded ? 'is-open' : ''} />}
                </button>
            </div>

            <div className="pain-search">
                <input
                    type="text"
                    placeholder="Cerca muscolo dolorante..."
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    aria-label="Cerca muscolo dolorante"
                />
                {searchQuery && (
                    <button
                        type="button"
                        className="pain-search__clear"
                        onClick={() => setSearchQuery('')}
                        aria-label="Cancella ricerca"
                    >
                        <X size={17} aria-hidden="true" />
                    </button>
                )}
            </div>

            {searchQuery.trim() && (
                <div className="pain-search-results" role="listbox" aria-label="Muscoli trovati">
                    {searchResults.length === 0 ? (
                        <div className="pain-search-results__empty">Nessun muscolo trovato</div>
                    ) : (
                        searchResults.map(muscle => {
                            const isPain = activePainsSet.has(muscle.id);
                            return (
                                <button
                                    key={muscle.id}
                                    type="button"
                                    className={`pain-search-result ${isPain ? 'is-active' : ''}`}
                                    onClick={() => onTogglePain(muscle.id)}
                                    role="option"
                                    aria-selected={isPain}
                                >
                                    <span>{muscle.name}</span>
                                    <span>{isPain ? 'Dolorante' : 'Aggiungi'}</span>
                                </button>
                            );
                        })
                    )}
                </div>
            )}

            <div className={`pain-badges ${isExpanded && hasPains ? 'is-expanded' : ''}`} aria-hidden={!isExpanded}>
                {activePains.map(muscleId => (
                    <span key={muscleId} className="pain-badge">
                        {Logic.getMuscleName(muscleId)}
                        <button
                            type="button"
                            onClick={() => onTogglePain(muscleId)}
                            aria-label={`Rimuovi dolore ${Logic.getMuscleName(muscleId)}`}
                        >
                            <X size={14} aria-hidden="true" />
                        </button>
                    </span>
                ))}
            </div>

            <div className="home-recovery-map">
                <div className="home-recovery-map__model">
                    <MuscleModel muscleColors={combinedColors} interactive={false} />
                </div>
                <div className="home-recovery-legend" aria-label="Legenda recupero">
                    <span><i className="is-fatigued" /> Affaticato</span>
                    <span><i className="is-pain" /> Dolorante</span>
                </div>
            </div>
        </div>
    );
};

export default RecoveryBentoCard;
