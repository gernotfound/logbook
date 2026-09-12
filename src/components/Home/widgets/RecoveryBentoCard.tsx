import React, { useState, useMemo, useEffect } from 'react';
import MuscleModel from '../../Training/MuscleModel';
import { Activity, ChevronDown, X } from 'lucide-react';
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
    const hasPains = activePains.length > 0;

    return (
        <div className="home-card-stack">
            <div className="recovery-card__header">
                <h2 className="home-card-title">
                    <Activity size={18} className="text-danger" aria-hidden="true" />
                    Recupero e dolori
                </h2>
                <button
                    type="button"
                    className={`recovery-count ${hasPains ? 'is-active' : ''}`}
                    onClick={() => hasPains && setIsExpanded(value => !value)}
                    disabled={!hasPains}
                    aria-expanded={isExpanded}
                >
                    {hasPains ? `${activePains.length} dolori` : '0 dolori'}
                    {hasPains && (
                        <ChevronDown
                            size={14}
                            className={`recovery-count__chevron ${isExpanded ? 'is-open' : ''}`}
                            aria-hidden="true"
                        />
                    )}
                </button>
            </div>

            <div className="recovery-search">
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
                        className="btn-icon recovery-search__clear"
                        onClick={() => setSearchQuery('')}
                        aria-label="Cancella ricerca"
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                )}
            </div>

            {searchQuery.trim() && (
                <div className="recovery-results" aria-label="Risultati ricerca muscoli">
                    {searchResults.length === 0 ? (
                        <div className="recovery-empty">Nessun muscolo trovato</div>
                    ) : (
                        searchResults.map(muscle => {
                            const isPain = activePainsSet.has(muscle.id);
                            return (
                                <button
                                    key={muscle.id}
                                    type="button"
                                    className={`recovery-result ${isPain ? 'is-active' : ''}`}
                                    onClick={() => onTogglePain(muscle.id)}
                                    aria-pressed={isPain}
                                >
                                    <span className="recovery-result__name">{muscle.name}</span>
                                    <span className="recovery-result__action">
                                        {isPain ? 'Dolorante' : 'Aggiungi'}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            )}

            <div
                className={`recovery-active-list ${isExpanded && hasPains ? 'is-open' : 'is-closed'}`}
                aria-hidden={!isExpanded}
            >
                {hasPains && (
                    <div className="recovery-badges">
                        {activePains.map(muscleId => (
                            <span key={muscleId} className="recovery-badge">
                                {Logic.getMuscleName(muscleId)}
                                <button
                                    type="button"
                                    className="btn-icon"
                                    onClick={() => onTogglePain(muscleId)}
                                    aria-label={`Rimuovi dolore ${Logic.getMuscleName(muscleId)}`}
                                >
                                    <X size={13} aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="recovery-model">
                <div className="recovery-model__canvas">
                    <MuscleModel
                        muscleColors={combinedColors}
                        interactive={false}
                    />
                </div>
                <div className="recovery-legend" aria-label="Legenda recupero">
                    <div className="recovery-legend__item">
                        <span className="recovery-legend__dot recovery-legend__dot--fatigue" aria-hidden="true" />
                        <span>Affaticato</span>
                    </div>
                    <div className="recovery-legend__item">
                        <span className="recovery-legend__dot recovery-legend__dot--pain" aria-hidden="true" />
                        <span>Dolorante</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RecoveryBentoCard;
