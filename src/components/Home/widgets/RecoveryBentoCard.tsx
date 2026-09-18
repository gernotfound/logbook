import { useState, useMemo, useEffect, useId } from 'react';
import { Activity, ChevronDown, Search, X, Check, Plus } from 'lucide-react';
import MuscleModel from '../../Training/MuscleModel';
import { Logic } from '../../../lib/logic';

interface RecoveryBentoCardProps {
    activePains: string[]; painColors: Record<string, string>; muscleColors?: Record<string, string>;
    onTogglePain: (muscleId: string) => void;
}
const EMPTY_COLORS: Record<string, string> = {};

export default function RecoveryBentoCard({ activePains, painColors, muscleColors = EMPTY_COLORS, onTogglePain }: RecoveryBentoCardProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);
    const searchId = useId();
    const painsId = useId();
    const combinedColors = useMemo(() => {
        const colors: Record<string, string> = {};
        for (const id of Object.keys(muscleColors)) colors[id] = 'var(--warning-color)';
        for (const id of Object.keys(painColors)) colors[id] = 'var(--danger-color)';
        return colors;
    }, [muscleColors, painColors]);
    const searchResults = useMemo(() => searchQuery.trim() ? Logic.searchMuscles(searchQuery, 8) : [], [searchQuery]);
    const activePainsSet = useMemo(() => new Set(activePains), [activePains]);
    useEffect(() => { if (activePains.length === 0) setIsExpanded(false); }, [activePains.length]);

    return (
        <section className="home-recovery">
            <div className="home-section-heading">
                <h2><Activity size={22} aria-hidden="true" />Recupero e dolori</h2>
                <button type="button" className="home-pain-count" onClick={() => setIsExpanded(v => !v)}
                    disabled={!activePains.length} aria-expanded={isExpanded} aria-controls={painsId}>
                    {activePains.length} dolori attivi<ChevronDown size={16} aria-hidden="true" />
                </button>
            </div>
            <div className="home-muscle-search">
                <label className="text-sm home-muted" htmlFor={searchId}>Muscolo dolorante</label>
                <div className="home-search-field"><Search size={20} aria-hidden="true" />
                    <input id={searchId} type="search" placeholder="Cerca muscolo dolorante..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                    {searchQuery && <button type="button" className="btn-icon" aria-label="Cancella ricerca" onClick={() => setSearchQuery('')}><X size={20} aria-hidden="true" /></button>}
                </div>
            </div>
            {searchQuery.trim() && <div className="home-muscle-results">
                {!searchResults.length ? <p className="text-sm home-muted" role="status">Nessun muscolo trovato</p> : searchResults.map(m => (
                    <button key={m.id} type="button" aria-pressed={activePainsSet.has(m.id)} onClick={() => onTogglePain(m.id)}>
                        <span>{m.name}</span><span className="text-sm">{activePainsSet.has(m.id) ? <><Check size={16} aria-hidden="true" />Dolorante</> : <><Plus size={16} aria-hidden="true" />Aggiungi</>}</span>
                    </button>
                ))}
            </div>}
            <div id={painsId} className="home-pain-list" style={{ display: isExpanded ? 'flex' : 'none' }}>
                {activePains.map(id => <button key={id} type="button" onClick={() => onTogglePain(id)} aria-label={`Rimuovi dolore ${Logic.getMuscleName(id)}`}>
                    {Logic.getMuscleName(id)}<X size={18} aria-hidden="true" />
                </button>)}
            </div>
            <div className="home-muscle-model"><MuscleModel muscleColors={combinedColors} interactive={false} /></div>
            <div className="home-muscle-legend"><span><i className="fatigue" aria-hidden="true" />Affaticato</span><span><i className="pain" aria-hidden="true" />Dolorante</span></div>
        </section>
    );
}
